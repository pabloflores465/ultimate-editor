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

  writeFileSync(join(dir, ".zshenv"), wrapFile(".zshenv") + "\nexport TERMINFO=/usr/share/terminfo\nexport TERMINFO_DIRS=/usr/share/terminfo\n");

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
    // Unset TERMINFO so ncurses uses its compiled-in default search path.
    // Kitty's shell integration overrides TERMINFO to its own dir (only has
    // xterm-kitty), which breaks all other terminal types (top, htop, vim…).
    `export TERMINFO=/usr/share/terminfo`,
    `export TERMINFO_DIRS=/usr/share/terminfo`,
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

// ── FFI: openpty (libSystem) + pty_helpers (non-variadic ioctl wrappers) ──────
// ioctl() is variadic — on ARM64 Apple Silicon, variadic args go on the stack
// while Bun FFI passes them in registers. This silently corrupts the winsize
// struct, giving the PTY garbage dimensions (e.g. 45444×1786). We use a tiny
// compiled .dylib with fixed-signature wrappers instead.
const { symbols: { openpty } } = dlopen("libSystem.B.dylib", {
  openpty: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.int32_t,
  },
});

// Resolve pty_helpers.dylib — check multiple locations for dev vs production
const _candidates = [
  join(import.meta.dir || __dirname, "..", "native", "pty_helpers.dylib"),
  join(import.meta.dir || __dirname, "pty_helpers.dylib"),
  join(process.argv0, "..", "pty_helpers.dylib"),
];
const ptyHelpersPath = _candidates.find(p => existsSync(p))
  || (() => { throw new Error(`pty_helpers.dylib not found, tried: ${_candidates.join(", ")}`); })();
const { symbols: { pty_set_winsize } } = dlopen(ptyHelpersPath, {
  pty_set_winsize: {
    args: [FFIType.int32_t, FFIType.u16, FFIType.u16],
    returns: FFIType.int32_t,
  },
});

// ── Per-workspace session state ───────────────────────────────────────────────
interface PtySession {
  masterFd: number;
  slaveFd: number;
  shellSpawned: boolean;
  sendFn: (b64: string) => void;
  exitFn: () => void;
  childProcess: ReturnType<typeof nodeSpawn> | null;
  destroyed: boolean;
}

const sessions = new Map<string, PtySession>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function createPty(): { masterFd: number; slaveFd: number } {
  const masterBuf = new Int32Array(1);
  const slaveBuf  = new Int32Array(1);
  const ret = openpty(ptr(masterBuf), ptr(slaveBuf), null, null, null);
  if (ret !== 0) throw new Error(`openpty falló con código ${ret}`);
  // Set a sane default size using our non-variadic wrapper
  const masterFd = masterBuf[0];
  pty_set_winsize(masterFd, 24, 80);
  return { masterFd, slaveFd: slaveBuf[0] };
}

function setWinSize(fd: number, cols: number, rows: number): void {
  if (cols <= 0 || rows <= 0 || cols > 1000 || rows > 1000) {
    console.warn(`[terminal.ts] setWinSize: ignoring invalid size ${cols}x${rows}`);
    return;
  }
  const ret = pty_set_winsize(fd, rows, cols);
  console.log(`[terminal.ts] setWinSize(fd=${fd}, ${cols}x${rows}) ret=${ret}`);
}

/** Lanza zsh para una sesión y empieza el read loop. Solo se llama una vez por sesión. */
function spawnShell(workspaceId: string): void {
  const session = sessions.get(workspaceId);
  if (!session || session.shellSpawned || session.slaveFd < 0 || session.destroyed) return;
  session.shellSpawned = true;

  const zdotdir = ensureZdotdir(workspaceId);

  // ── PTY session setup via Python launcher ───────────────────────────────────
  // Node.js child_process.spawn() dup2's the slave fd to 0/1/2 but does NOT
  // call setsid() + TIOCSCTTY, so the slave never becomes the controlling
  // terminal. Without a controlling terminal, curses apps that use job-control
  // (top, htop, …) fail inside initscr() even though simpler apps (vim) work.
  //
  // Fix: spawn Python as the launcher. Python:
  //   1. os.ttyname(0)  → gets slave PTY path while slave is still fd 0
  //   2. os.setsid()    → creates a new session (Python is now session leader)
  //   3. os.open(path)  → opening a TTY as session leader with no controlling
  //                       terminal makes it the controlling terminal (POSIX/BSD)
  //   4. os.dup2 + exec → replaces itself with zsh; PID stays the same
  const pyLauncher = [
    "import os,sys",
    "path=os.ttyname(0)",
    "os.setsid()",
    "fd=os.open(path,os.O_RDWR)",
    "[os.dup2(fd,i)for i in(0,1,2)]",
    "fd>2 and os.close(fd)",
    "os.execv('/bin/zsh',['/bin/zsh','-i'])",
  ].join(";");

  const child = nodeSpawn("/usr/bin/python3", ["-c", pyLauncher], {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stdio: [session.slaveFd, session.slaveFd, session.slaveFd] as any,
    env: {
      ...process.env,
      TERM:                "xterm-256color",
      TERMINFO:            "/usr/share/terminfo",
      TERMINFO_DIRS:       "/usr/share/terminfo",
      COLORTERM:           "truecolor",
      FORCE_COLOR:         "3",
      CLICOLOR_FORCE:      "1",
      ZDOTDIR:             zdotdir,
      STARSHIP_CONFIG:     join(zdotdir, "starship.toml"),
      PROMPT_ADD_NEWLINE:  "false",
      POWERLEVEL9K_PROMPT_ADD_NEWLINE: "false",
      KITTY_INSTALLATION_DIR: undefined,
      KITTY_PID:              undefined,
      KITTY_WINDOW_ID:        undefined,
      KITTY_LISTEN_ON:        undefined,
    },
    detached: false,
    cwd: homedir(), // Start in home directory, not app bundle
  });

  session.childProcess = child;

  // Unref the child so it does NOT hold Bun's libuv event loop open.
  child.unref();

  closeSync(session.slaveFd);
  session.slaveFd = -1;

  // ── Exit detection ─────────────────────────────────────────────────────
  const send   = session.sendFn;
  const onExit = session.exitFn;
  const masterFd = session.masterFd;
  const sessionRef = session;
  let exited = false;

  function notifyExit(): void {
    if (exited) return;
    exited = true;
    if (!sessionRef.destroyed) {
      onExit();
    }
  }

  // Primary: poll child.exitCode every 100ms — reliable on macOS regardless
  // of PTY EIO timing.  The interval is unref'd so it never keeps Bun alive.
  const exitPoll = setInterval(() => {
    if (child.exitCode !== null) {
      clearInterval(exitPoll);
      notifyExit();
    }
  }, 100);
  try { (exitPoll as NodeJS.Timeout & { unref?: () => void }).unref?.(); } catch {}

  // ── Batching de output ─────────────────────────────────────────────────
  // Each session gets its own read buffer to avoid sharing issues
  const readBuf = Buffer.allocUnsafe(65536);
  let pending: Buffer | null = null;

  function flush(): void {
    if (pending !== null && !sessionRef.destroyed) {
      console.log(`[terminal.ts] flush output for ${workspaceId}, ${pending.length} bytes`);
      send(pending.toString("base64"));
      pending = null;
    }
  }

  function readLoop(): void {
    if (sessionRef.destroyed) return;
    read(masterFd, readBuf, 0, readBuf.length, null, (err, n) => {
      if (err || sessionRef.destroyed) {
        // EIO = shell exited (backup path, child 'close' is the primary).
        notifyExit();
        return;
      }

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

  console.log(`[terminal.ts] Starting readLoop for ${workspaceId}`);
  readLoop();
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Crea el PTY para un workspace pero NO lanza el shell todavía. El shell se
 * lanza en la primera llamada a resizePty(), cuando ya conocemos el tamaño
 * real del viewport.
 */
export function createTerminalForWorkspace(
  workspaceId: string,
  send: (b64: string) => void,
  onExit: () => void,
): void {
  console.log(`[terminal.ts] createTerminalForWorkspace for ${workspaceId}`);
  // Destroy any existing session for this workspace first
  destroyTerminal(workspaceId);

  const pty = createPty();
  sessions.set(workspaceId, {
    masterFd: pty.masterFd,
    slaveFd: pty.slaveFd,
    shellSpawned: false,
    sendFn: send,
    exitFn: onExit,
    childProcess: null,
    destroyed: false,
  });
  console.log(`[terminal.ts] Created session for ${workspaceId}, total sessions: ${sessions.size}`);
}

/** Escribe bytes de entrada del usuario (base64) al PTY master de un workspace. */
export function writeToTty(workspaceId: string, b64: string): void {
  const session = sessions.get(workspaceId);
  if (!session || session.masterFd < 0 || !session.shellSpawned || session.destroyed) return;
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
  console.log(`[terminal.ts] resizePty for ${workspaceId} to ${cols}x${rows}, session exists: ${!!session}`);
  if (!session || session.masterFd < 0 || session.destroyed) return;
  setWinSize(session.masterFd, cols, rows);

  // Primera llamada → arrancar el shell con el tamaño correcto
  if (!session.shellSpawned) {
    spawnShell(workspaceId);
  }
}

/**
 * Cierra el PTY master y elimina la sesión del workspace.
 * Mata el proceso hijo si está corriendo.
 */
export function destroyTerminal(workspaceId: string): void {
  const session = sessions.get(workspaceId);
  if (!session) {
    console.log(`[terminal.ts] destroyTerminal for ${workspaceId} - no session found`);
    return;
  }

  console.log(`[terminal.ts] destroyTerminal for ${workspaceId}, NOT closing fds, just marking destroyed`);
  session.destroyed = true;

  if (session.childProcess && session.childProcess.pid) {
    try {
      process.kill(session.childProcess.pid, "SIGTERM");
      setTimeout(() => {
        try {
          if (session.childProcess?.pid) {
            process.kill(session.childProcess.pid, "SIGKILL");
          }
        } catch {}
      }, 100);
    } catch {}
  }

  // DON'T close file descriptors - this might be breaking RPC
  // try {
  //   if (session.masterFd >= 0) closeSync(session.masterFd);
  // } catch {}
  // try {
  //   if (session.slaveFd >= 0) closeSync(session.slaveFd);
  // } catch {}

  sessions.delete(workspaceId);
  console.log(`[terminal.ts] destroyTerminal done, sessions now: ${sessions.size}, keys: ${Array.from(sessions.keys()).join(', ')}`);
}
