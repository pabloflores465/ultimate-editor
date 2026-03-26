/**
 * terminal.ts — PTY backend usando Bun FFI + libSystem del sistema macOS.
 *
 * Se evita node-pty porque Electrobun empaqueta el proceso Bun en un único
 * index.js y los módulos nativos (.node) no pueden resolverse desde ese bundle.
 *
 * ── Por qué child_process.spawn en lugar de Bun.spawn ───────────────────────
 * Bun.spawn puede ignorar silenciosamente fd numéricos en stdio dependiendo
 * de la versión. Node.js child_process.spawn tiene soporte explícito y
 * documentado para números de fd (posix_spawn_file_actions_adddup2).
 *
 * ── Por qué fs.read en lugar de net.Socket ──────────────────────────────────
 * net.Socket({ fd }) en Bun está diseñado para sockets TCP/Unix. Con fds de
 * caracteres (PTY master) puede no emitir eventos "data" en macOS/ARM64.
 * fs.read con callback usa libuv que sí maneja PTY master fds correctamente.
 *
 * ── Optimizaciones de rendimiento ───────────────────────────────────────────
 * • Batching de output: los chunks que llegan en el mismo tick del event loop
 *   se fusionan en un solo mensaje RPC, reduciendo overhead de serialización.
 * • Buffer reutilizable: un único Buffer de 64 KB evita allocaciones frecuentes.
 * • Sin logging en el hot path: los console.error bloqueaban el event loop.
 *
 * ── Deferred shell spawn ────────────────────────────────────────────────────
 * initPty() solo crea el PTY y almacena la función de envío. El shell NO se
 * lanza hasta que resizePty() recibe el tamaño real del webview. Esto evita
 * que zsh genere output formateado para 80x24 cuando el panel real puede ser
 * mucho más pequeño, lo que causaba un gap enorme antes del primer prompt.
 */

import { dlopen, FFIType, ptr } from "bun:ffi";
import { read, writeSync, closeSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { spawn as nodeSpawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

// ── Constantes ioctl en macOS ─────────────────────────────────────────────────
const TIOCSWINSZ = 0x80087467n;

// ── ZDOTDIR + Starship wrapper ────────────────────────────────────────────────
// Crea un directorio temporal con:
//   • .zshenv / .zshrc wrappers que sourcean los originales del usuario y luego
//     sobreescriben variables de spacing de temas (p10k, spaceship, oh-my-zsh)
//   • starship.toml con add_newline = false (preserva el resto del config)
function ensureZdotdir(): string {
  const dir = join(tmpdir(), `ult-zsh-${process.env.USER ?? "user"}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const wrapFile = (file: string): string => [
    `_ue_saved_zdotdir="\${ZDOTDIR}"`,
    `unset ZDOTDIR`,
    `[ -f "\${HOME}/${file}" ] && source "\${HOME}/${file}"`,
    `export ZDOTDIR="\${_ue_saved_zdotdir}"`,
    `unset _ue_saved_zdotdir`,
  ].join("\n");

  writeFileSync(join(dir, ".zshenv"), wrapFile(".zshenv") + "\n");
  writeFileSync(
    join(dir, ".zshrc"),
    [
      wrapFile(".zshrc"),
      "",
      "# Ultimate Editor: suppress blank lines added by themes",
      "PROMPT_ADD_NEWLINE=false",
      "POWERLEVEL9K_PROMPT_ADD_NEWLINE=0",
      "_POWERLEVEL9K_PROMPT_ADD_NEWLINE=0",
      "SPACESHIP_PROMPT_ADD_NEWLINE=false",
      "",
      "_ue_no_newline() {",
      "  POWERLEVEL9K_PROMPT_ADD_NEWLINE=0",
      "  _POWERLEVEL9K_PROMPT_ADD_NEWLINE=0",
      "  PROMPT_ADD_NEWLINE=false",
      "  SPACESHIP_PROMPT_ADD_NEWLINE=false",
      "}",
      "precmd_functions=(_ue_no_newline ${precmd_functions[@]})",
      "",
      "if (( ${+functions[_p9k_precmd]} )); then",
      "  _p9k_add_newline() { : }",
      "fi",
    ].join("\n") + "\n",
  );

  // Starship config override
  const userStarship = join(homedir(), ".config", "starship.toml");
  let starshipContent = "";
  if (existsSync(userStarship)) {
    try {
      starshipContent = readFileSync(userStarship, "utf-8");
      starshipContent = starshipContent.replace(/^\s*add_newline\s*=.*$/m, "");
    } catch {}
  }
  writeFileSync(
    join(dir, "starship.toml"),
    `add_newline = false\n${starshipContent}`,
  );

  return dir;
}

// ── FFI: openpty + ioctl ──────────────────────────────────────────────────────
const { symbols: { openpty, ioctl } } = dlopen("libSystem.B.dylib", {
  openpty: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.int32_t,
  },
  ioctl: {
    args: [FFIType.int32_t, FFIType.uint64_t, FFIType.ptr],
    returns: FFIType.int32_t,
  },
});

// ── Estado ────────────────────────────────────────────────────────────────────
let masterFd = -1;
let slaveFd  = -1;
let shellSpawned = false;
let sendFn: ((b64: string) => void) | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function createPty(): { masterFd: number; slaveFd: number } {
  const masterBuf = new Int32Array(1);
  const slaveBuf  = new Int32Array(1);
  const ret = openpty(ptr(masterBuf), ptr(slaveBuf), null, null, null);
  if (ret !== 0) throw new Error(`openpty falló con código ${ret}`);
  return { masterFd: masterBuf[0], slaveFd: slaveBuf[0] };
}

function setWinSize(fd: number, cols: number, rows: number): void {
  const ws = new Uint16Array([rows, cols, 0, 0]);
  ioctl(fd, TIOCSWINSZ, ptr(ws));
}

/** Lanza zsh y empieza el read loop. Solo se llama una vez. */
function spawnShell(): void {
  if (shellSpawned || slaveFd < 0 || !sendFn) return;
  shellSpawned = true;

  const zdotdir = ensureZdotdir();

  nodeSpawn("/bin/zsh", ["-i"], {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stdio: [slaveFd, slaveFd, slaveFd] as any,
    env: {
      ...process.env,
      TERM:                "xterm-256color",
      COLORTERM:           "truecolor",
      FORCE_COLOR:         "3",
      CLICOLOR_FORCE:      "1",
      ZDOTDIR:             zdotdir,
      STARSHIP_CONFIG:     join(zdotdir, "starship.toml"),
      PROMPT_ADD_NEWLINE:  "false",
      POWERLEVEL9K_PROMPT_ADD_NEWLINE: "false",
    },
    detached: false,
  });

  closeSync(slaveFd);
  slaveFd = -1;

  // ── Batching de output ─────────────────────────────────────────────────
  const send = sendFn;
  const readBuf = Buffer.allocUnsafe(65536);
  let pending: Buffer | null = null;

  function flush(): void {
    if (pending !== null) {
      send(pending.toString("base64"));
      pending = null;
    }
  }

  function readLoop(): void {
    read(masterFd, readBuf, 0, readBuf.length, null, (err, n) => {
      if (err) return; // EIO cuando el shell termina

      if (n > 0) {
        if (pending === null) {
          pending = Buffer.from(readBuf.subarray(0, n));
          setImmediate(flush);
        } else {
          const merged = Buffer.allocUnsafe(pending.length + n);
          pending.copy(merged);
          readBuf.copy(merged, pending.length, 0, n);
          pending = merged;
        }
      }

      readLoop();
    });
  }

  readLoop();
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Crea el PTY pero NO lanza el shell todavía. El shell se lanza en la primera
 * llamada a resizePty(), cuando ya conocemos el tamaño real del viewport.
 */
export function initPty(send: (b64: string) => void): void {
  const pty = createPty();
  masterFd = pty.masterFd;
  slaveFd  = pty.slaveFd;
  sendFn   = send;
}

/** Escribe bytes de entrada del usuario (base64) al PTY master. */
export function writeToTty(b64: string): void {
  if (masterFd < 0 || !shellSpawned) return;
  try {
    writeSync(masterFd, Buffer.from(b64, "base64"));
  } catch {
    // Ignorar si el proceso ya terminó
  }
}

/**
 * Redimensiona el PTY. En la primera llamada, también lanza el shell, ya que
 * es el primer momento en que conocemos el tamaño real del terminal.
 */
export function resizePty(cols: number, rows: number): void {
  if (masterFd < 0) return;
  setWinSize(masterFd, cols, rows);

  // Primera llamada → arrancar el shell con el tamaño correcto
  if (!shellSpawned) {
    spawnShell();
  }
}
