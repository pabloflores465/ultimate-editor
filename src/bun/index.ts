import { BrowserWindow, Updater, WGPUView, ApplicationMenu, BrowserView } from "electrobun/bun";
const { setApplicationMenu, on } = ApplicationMenu;
import { renderTriangle } from "./webgpu-renderer";
import { createTerminalForWorkspace, writeToTty, resizePty, destroyTerminal } from "./terminal";

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
      "terminal:input": { data: string; workspaceId: string };
      /** Terminal viewport dimensions */
      "terminal:resize": { cols: number; rows: number; workspaceId: string };
      /** Webview listo para recibir output del terminal */
      "terminal:ready": { workspaceId: string };
      /** Destroy terminal session when user closes a pane */
      "terminal:destroy": { workspaceId: string };
    };
  };
  webview: {
    requests: Record<string, never>;
    messages: {
      /** Raw PTY output, base64-encoded */
      "terminal:output": { data: string; workspaceId: string };
      /** Shell process exited (e.g. user typed 'exit') */
      "terminal:exited": { workspaceId: string };
      "menu:open-settings": Record<string, never>;
      "menu:new-file": Record<string, never>;
      "menu:open-file": Record<string, never>;
      "menu:save-file": Record<string, never>;
    };
  };
};

// ── Per-workspace output buffering ────────────────────────────────────────────
// Each workspace buffers PTY output until its webview signals ready.
const workspaceReady = new Map<string, boolean>();
const workspaceBuffers = new Map<string, string[]>();

// Saves the last resize dimensions received per workspace.
// terminal:resize arrives BEFORE terminal:ready (Terminal.svelte fires
// onResize then onMounted in the same onMount), so the session doesn't exist
// yet when the first resize comes in.  We store it here and replay it once
// the session is created in the terminal:ready handler.
const pendingResize = new Map<string, { cols: number; rows: number }>();

function sendOrBuffer(workspaceId: string, b64: string): void {
  if (workspaceReady.get(workspaceId)) {
    sendToWebview("terminal:output", { data: b64, workspaceId });
  } else {
    if (!workspaceBuffers.has(workspaceId)) {
      workspaceBuffers.set(workspaceId, []);
    }
    workspaceBuffers.get(workspaceId)!.push(b64);
  }
}

function flushWorkspaceBuffer(workspaceId: string): void {
  workspaceReady.set(workspaceId, true);
  const buf = workspaceBuffers.get(workspaceId);
  if (buf) {
    for (const chunk of buf) {
      sendToWebview("terminal:output", { data: chunk, workspaceId });
    }
    workspaceBuffers.delete(workspaceId);
  }
}

// ── RPC ──────────────────────────────────────────────────────────────────────
const rpc = BrowserView.defineRPC<AppSchema>({
  handlers: {
    messages: {
      "terminal:input": ({ data, workspaceId }) => {
        console.log(`[index.ts] terminal:input received for ${workspaceId}`);
        writeToTty(workspaceId, data);
      },
      "terminal:resize": ({ cols, rows, workspaceId }) => {
        console.log(`[index.ts] terminal:resize received for ${workspaceId}`);
        // Always save the latest dimensions so terminal:ready can replay them
        // if the session doesn't exist yet.
        pendingResize.set(workspaceId, { cols, rows });
        resizePty(workspaceId, cols, rows);
      },
      "terminal:ready": ({ workspaceId }) => {
        // Ensure the terminal exists for this workspace
        if (!workspaceReady.has(workspaceId)) {
          createTerminalForWorkspace(
            workspaceId,
            (b64) => sendOrBuffer(workspaceId, b64),
            () => {
              // Shell exited: clean up server-side state and notify frontend
              workspaceReady.delete(workspaceId);
              workspaceBuffers.delete(workspaceId);
              pendingResize.delete(workspaceId);
              sendToWebview("terminal:exited", { workspaceId });
            },
          );
          // Replay the last resize so spawnShell() is triggered.
          // terminal:resize always arrives before terminal:ready (fired in the
          // same onMount in Terminal.svelte), meaning the session didn't exist
          // when the first resize came in and resizePty() silently returned.
          const size = pendingResize.get(workspaceId);
          if (size) {
            resizePty(workspaceId, size.cols, size.rows);
          }
        }
        flushWorkspaceBuffer(workspaceId);
      },
      "terminal:destroy": ({ workspaceId }) => {
        console.log(`[index.ts] terminal:destroy received for ${workspaceId}`);
        // Clean up terminal session when user closes a pane
        workspaceReady.delete(workspaceId);
        workspaceBuffers.delete(workspaceId);
        pendingResize.delete(workspaceId);
        destroyTerminal(workspaceId);
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
  title: "ultimate_editor",
  url,
  rpc,
  frame: { width: 900, height: 700, x: 200, y: 200 },
  titleBarStyle: "hiddenInset",
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
