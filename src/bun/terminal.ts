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
import { read, writeSync, closeSync } from "node:fs";
import { spawn as nodeSpawn } from "node:child_process";

// ── Constantes ioctl en macOS ─────────────────────────────────────────────────
const TIOCSWINSZ = 0x80087467n;

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

  // Spawn zsh con slave PTY como stdin/stdout/stderr.
  // child_process.spawn acepta números de fd en stdio[].
  nodeSpawn("/bin/zsh", ["-i"], {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stdio: [sfd, sfd, sfd] as any,
    env: {
      ...process.env,
      TERM:           "xterm-256color",
      COLORTERM:      "truecolor",
      FORCE_COLOR:    "3",
      CLICOLOR_FORCE: "1",
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
