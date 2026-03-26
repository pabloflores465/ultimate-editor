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
 */

import { dlopen, FFIType, ptr } from "bun:ffi";
import { read, writeSync, closeSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { spawn as nodeSpawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

// ── Constantes ioctl en macOS ─────────────────────────────────────────────────
const TIOCSWINSZ = 0x80087467n;

// ── ZDOTDIR wrapper ───────────────────────────────────────────────────────────
// Crea un directorio temporal con un .zshrc y .zshenv que:
//   1. Deshacen ZDOTDIR temporalmente para que zsh cargue el ~/.zshrc del usuario
//   2. Vuelven a poner ZDOTDIR (por si el usuario lo usa)
//   3. Sobreescriben PROMPT_ADD_NEWLINE=false DESPUÉS de que el tema se haya cargado
//
// Esto evita que oh-my-zsh / powerlevel10k sobreescriban la variable.
function ensureZdotdir(): string {
  const dir = join(tmpdir(), `ult-zsh-${process.env.USER ?? "user"}`);
  // Siempre regenerar los wrappers para que los cambios de configuración se apliquen
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  // Genera un wrapper que desactiva ZDOTDIR → source original → restaura ZDOTDIR
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
      "# p10k copies POWERLEVEL9K_* → _POWERLEVEL9K_* at init, so override both",
      "PROMPT_ADD_NEWLINE=false",
      "POWERLEVEL9K_PROMPT_ADD_NEWLINE=0",
      "_POWERLEVEL9K_PROMPT_ADD_NEWLINE=0",
      "SPACESHIP_PROMPT_ADD_NEWLINE=false",
      "",
      "# precmd hook prepended so it runs before p10k's precmd",
      "_ue_no_newline() {",
      "  POWERLEVEL9K_PROMPT_ADD_NEWLINE=0",
      "  _POWERLEVEL9K_PROMPT_ADD_NEWLINE=0",
      "  PROMPT_ADD_NEWLINE=false",
      "  SPACESHIP_PROMPT_ADD_NEWLINE=false",
      "}",
      "precmd_functions=(_ue_no_newline ${precmd_functions[@]})",
      "",
      "# If p10k is loaded, also patch its internal newline function directly",
      "if (( ${+functions[_p9k_precmd]} )); then",
      "  _p9k_add_newline() { : }",
      "fi",
    ].join("\n") + "\n",
  );

  // ── Starship config override ──────────────────────────────────────────────
  // Starship usa add_newline = true por defecto. Creamos un config que lo
  // deshabilita, preservando el resto de la config del usuario si existe.
  const userStarship = join(homedir(), ".config", "starship.toml");
  let starshipContent = "";
  if (existsSync(userStarship)) {
    try {
      starshipContent = readFileSync(userStarship, "utf-8");
      // Eliminar cualquier add_newline existente para evitar duplicados
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

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Crea el PTY, lanza zsh y empieza a reenviar los datos al webview.
 * @param send  función que recibe cada chunk de salida como string base64.
 */
export function initPty(send: (b64: string) => void): void {
  const { masterFd: mfd, slaveFd: sfd } = createPty();
  masterFd = mfd;

  setWinSize(masterFd, 80, 24);

  const zdotdir = ensureZdotdir();

  // Spawn zsh con slave PTY como stdin/stdout/stderr.
  // child_process.spawn acepta números de fd en stdio[].
  nodeSpawn("/bin/zsh", ["-i"], {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stdio: [sfd, sfd, sfd] as any,
    env: {
      ...process.env,
      TERM:                "xterm-256color",
      COLORTERM:           "truecolor",
      FORCE_COLOR:         "3",
      CLICOLOR_FORCE:      "1",
      // ZDOTDIR hace que zsh cargue nuestros wrappers en lugar de ~/.zshrc
      // Los wrappers sourcean el original y luego sobreescriben las vars de spacing
      ZDOTDIR:             zdotdir,
      // Starship: apuntar a nuestro config que fuerza add_newline = false
      STARSHIP_CONFIG:     join(zdotdir, "starship.toml"),
      PROMPT_ADD_NEWLINE:  "false",
      POWERLEVEL9K_PROMPT_ADD_NEWLINE: "false",
    },
    detached: false,
  });

  closeSync(sfd);

  // ── Batching de output ───────────────────────────────────────────────────
  // Los chunks que llegan en el mismo tick del event loop se acumulan y se
  // envían juntos en una sola llamada RPC. Esto reduce drásticamente el
  // overhead cuando el shell produce output en ráfagas (ej: ls, cat, npm run).
  //
  // Si el siguiente read llega antes de que setImmediate haya disparado
  // (mismo tick), se concatena al buffer pendiente → un solo mensaje RPC.
  // Si llega en un tick distinto, setImmediate ya flusheó y se crea uno nuevo.
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
          // Primer chunk del batch: copiar y programar flush
          pending = Buffer.from(readBuf.subarray(0, n));
          setImmediate(flush);
        } else {
          // Chunk adicional del mismo tick: concatenar al batch actual
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

/** Escribe bytes de entrada del usuario (base64) al PTY master. */
export function writeToTty(b64: string): void {
  if (masterFd < 0) return;
  try {
    writeSync(masterFd, Buffer.from(b64, "base64"));
  } catch {
    // Ignorar si el proceso ya terminó
  }
}

/** Redimensiona el PTY y envía SIGWINCH al shell. */
export function resizePty(cols: number, rows: number): void {
  if (masterFd < 0) return;
  setWinSize(masterFd, cols, rows);
}
