import { BrowserWindow, Updater, WGPUView, ApplicationMenu, BrowserView } from "electrobun/bun";
const { setApplicationMenu, on } = ApplicationMenu;
import { renderTriangle } from "./webgpu-renderer";
import { initPty, writeToTty, resizePty } from "./terminal";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

// ── RPC Schema ───────────────────────────────────────────────────────────────
// bun.messages   = messages the BUN process *receives* from the webview
// webview.messages = messages the WEBVIEW *receives* from bun
type AppSchema = {
  bun: {
    requests: Record<string, never>;
    messages: {
      /** Raw PTY input, base64-encoded */
      "terminal:input": { data: string };
      /** Terminal viewport dimensions */
      "terminal:resize": { cols: number; rows: number };
      /** Webview listo para recibir output del terminal */
      "terminal:ready": Record<string, never>;
    };
  };
  webview: {
    requests: Record<string, never>;
    messages: {
      /** Raw PTY output, base64-encoded */
      "terminal:output": { data: string };
      "menu:open-settings": Record<string, never>;
      "menu:new-file": Record<string, never>;
      "menu:open-file": Record<string, never>;
      "menu:save-file": Record<string, never>;
    };
  };
};

// ── Buffer de output del PTY hasta que el webview esté listo ─────────────────
// El PTY se inicia inmediatamente pero el webview puede tardar en conectarse.
// Sin este buffer, el prompt inicial (y cualquier output temprano) se pierde.
let webviewReady = false;
const outputBuffer: string[] = [];

function sendOrBuffer(b64: string): void {
  if (webviewReady) {
    sendToWebview("terminal:output", { data: b64 });
  } else {
    outputBuffer.push(b64);
  }
}

function flushBuffer(): void {
  webviewReady = true;
  for (const chunk of outputBuffer) {
    sendToWebview("terminal:output", { data: chunk });
  }
  outputBuffer.length = 0;
}

// ── RPC ──────────────────────────────────────────────────────────────────────
const rpc = BrowserView.defineRPC<AppSchema>({
  handlers: {
    messages: {
      "terminal:input": ({ data }) => {
        writeToTty(data);
      },
      "terminal:resize": ({ cols, rows }) => {
        resizePty(cols, rows);
      },
      "terminal:ready": () => {
        flushBuffer();
      },
    },
  },
});

// ── Window ───────────────────────────────────────────────────────────────────
async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        await fetch(DEV_SERVER_URL, { method: "HEAD" });
        console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
        return DEV_SERVER_URL;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    console.log("Vite dev server not running after 5s. Run 'bun run dev:hmr' for HMR support.");
  }
  return "views://mainview/index.html";
}

const url = await getMainViewUrl();

const mainWindow = new BrowserWindow({
  title: "Svelte App",
  url,
  rpc,
  frame: { width: 900, height: 700, x: 200, y: 200 },
});

// ── Helper: safely send to webview ───────────────────────────────────────────
function sendToWebview(
  name: keyof AppSchema["webview"]["messages"],
  payload: Record<string, unknown>,
) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mainWindow.webview.rpc?.send as any)?.[name]?.(payload);
  } catch {}
}

// ── Boot PTY (after the window helper is defined) ────────────────────────────
// El output se bufferiza hasta que el webview envíe "terminal:ready"
initPty((b64) => sendOrBuffer(b64));

// ── WebGPU polling ───────────────────────────────────────────────────────────
const renderedViews = new Set<number>();
setInterval(() => {
  for (const view of WGPUView.getAll()) {
    if (!renderedViews.has(view.id) && view.ptr) {
      renderedViews.add(view.id);
      console.log(`[WebGPU] New WGPUView ${view.id} detected — starting renderer`);
      renderTriangle(view).catch((err) =>
        console.error(`[WebGPU] Renderer error on view ${view.id}:`, err),
      );
    }
  }
}, 200);

// ── Menu Bar ─────────────────────────────────────────────────────────────────
setApplicationMenu([
  {
    label: "Svelte App",
    submenu: [
      { role: "about" },
      { type: "separator" },
      { label: "Settings...", accelerator: "Cmd+,", action: "open-settings" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "showAll" },
      { type: "separator" },
      { role: "quit" },
    ],
  },
  {
    label: "File",
    submenu: [
      { label: "New File",  accelerator: "Cmd+N", action: "new-file" },
      { label: "Open...",   accelerator: "Cmd+O", action: "open-file" },
      { type: "separator" },
      { label: "Save",      accelerator: "Cmd+S", action: "save-file" },
      { type: "separator" },
      { role: "close" },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  },
  { label: "View",   submenu: [{ role: "toggleFullScreen" }] },
  {
    label: "Window",
    submenu: [
      { role: "minimize" },
      { role: "zoom" },
      { type: "separator" },
      { role: "bringAllToFront" },
    ],
  },
]);

// ── Menu click handler ────────────────────────────────────────────────────────
on("application-menu-clicked", (event: unknown) => {
  const { action } = event as { action: string };
  switch (action) {
    case "open-settings": sendToWebview("menu:open-settings", {}); break;
    case "new-file":      sendToWebview("menu:new-file", {});      break;
    case "open-file":     sendToWebview("menu:open-file", {});     break;
    case "save-file":     sendToWebview("menu:save-file", {});     break;
  }
});

console.log("Svelte app started!");
