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
 * • Buffer reutilizable por sesión: un Buffer de 64 KB por instancia evita
 *   allocaciones frecuentes y colisiones entre sesiones.
 * • Sin logging en el hot path: los console.error bloqueaban el event loop.
 *
 * ── Deferred shell spawn ────────────────────────────────────────────────────
 * createTerminalForWorkspace() solo crea el PTY y almacena la función de
 * envío. El shell NO se lanza hasta que resizePty() recibe el tamaño real
 * del webview. Esto evita que zsh genere output formateado para 80x24 cuando
 * el panel real puede ser mucho más pequeño.
 *
 * ── Multi-workspace support ──────────────────────────────────────────────────
 * Each workspace gets its own PTY session, keyed by workspaceId.
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
function ensureZdotdir(workspaceId: string): string {
  const dir = join(tmpdir(), `ult-zsh-${workspaceId}`);
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

  // .zshrc: source user config, then disable PROMPT_SP (removes the '%'
  // marker that zsh prints for partial lines) and clear the screen so the
  // first prompt appears cleanly at row 0 with no gaps.
  const zshrcContent = [
    wrapFile(".zshrc"),
    // Disable p10k instant prompt to avoid alternate-screen conflicts
    `unset POWERLEVEL9K_INSTANT_PROMPT`,
    `typeset -g POWERLEVEL9K_INSTANT_PROMPT=off 2>/dev/null`,
    // Remove the '%' partial-line marker
    `unsetopt PROMPT_SP 2>/dev/null`,
    // Clear screen after all init so first prompt starts at row 0
    `clear`,
  ].join("\n");
  writeFileSync(join(dir, ".zshrc"), zshrcContent + "\n");

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
    `add_newline = true\n${starshipContent}`,
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

// ── Per-workspace session state ───────────────────────────────────────────────
interface PtySession {
  masterFd: number;
  slaveFd: number;
  shellSpawned: boolean;
  sendFn: (b64: string) => void;
}

const sessions = new Map<string, PtySession>();

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

/** Lanza zsh para una sesión y empieza el read loop. Solo se llama una vez por sesión. */
function spawnShell(workspaceId: string): void {
  const session = sessions.get(workspaceId);
  if (!session || session.shellSpawned || session.slaveFd < 0) return;
  session.shellSpawned = true;

  const zdotdir = ensureZdotdir(workspaceId);

  nodeSpawn("/bin/zsh", ["-i"], {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stdio: [session.slaveFd, session.slaveFd, session.slaveFd] as any,
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

  closeSync(session.slaveFd);
  session.slaveFd = -1;

  // ── Batching de output ─────────────────────────────────────────────────
  const send = session.sendFn;
  const masterFd = session.masterFd;
  // Each session gets its own read buffer to avoid sharing issues
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
 * Crea el PTY para un workspace pero NO lanza el shell todavía. El shell se
 * lanza en la primera llamada a resizePty(), cuando ya conocemos el tamaño
 * real del viewport.
 */
export function createTerminalForWorkspace(workspaceId: string, send: (b64: string) => void): void {
  // Destroy any existing session for this workspace first
  destroyTerminal(workspaceId);

  const pty = createPty();
  sessions.set(workspaceId, {
    masterFd: pty.masterFd,
    slaveFd:  pty.slaveFd,
    shellSpawned: false,
    sendFn: send,
  });
}

/** Escribe bytes de entrada del usuario (base64) al PTY master de un workspace. */
export function writeToTty(workspaceId: string, b64: string): void {
  const session = sessions.get(workspaceId);
  if (!session || session.masterFd < 0 || !session.shellSpawned) return;
  try {
    writeSync(session.masterFd, Buffer.from(b64, "base64"));
  } catch {
    // Ignorar si el proceso ya terminó
  }
}

/**
 * Redimensiona el PTY de un workspace. En la primera llamada, también lanza
 * el shell, ya que es el primer momento en que conocemos el tamaño real del
 * terminal.
 */
export function resizePty(workspaceId: string, cols: number, rows: number): void {
  const session = sessions.get(workspaceId);
  if (!session || session.masterFd < 0) return;
  setWinSize(session.masterFd, cols, rows);

  // Primera llamada → arrancar el shell con el tamaño correcto
  if (!session.shellSpawned) {
    spawnShell(workspaceId);
  }
}

/**
 * Cierra el PTY master y elimina la sesión del workspace.
 */
export function destroyTerminal(workspaceId: string): void {
  const session = sessions.get(workspaceId);
  if (!session) return;
  try {
    if (session.masterFd >= 0) closeSync(session.masterFd);
  } catch {}
  try {
    if (session.slaveFd >= 0) closeSync(session.slaveFd);
  } catch {}
  sessions.delete(workspaceId);
}
