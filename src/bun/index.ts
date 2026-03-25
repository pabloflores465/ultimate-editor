import { BrowserWindow, Updater, WGPUView, ApplicationMenu, BrowserView } from "electrobun/bun";
const { setApplicationMenu, on } = ApplicationMenu;
import { renderTriangle } from "./webgpu-renderer";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

// ── Terminal RPC Schema ────────────────────────────────────────────────────
// Schema.bun.messages   = messages BUN *receives* from the webview
// Schema.webview.messages = messages the WEBVIEW *receives* from bun
type AppSchema = {
  bun: {
    requests: Record<string, never>;
    messages: {
      "terminal:input": { data: string };
    };
  };
  webview: {
    requests: Record<string, never>;
    messages: {
      "terminal:output": { data: string };
      "menu:open-settings": Record<string, never>;
      "menu:new-file": Record<string, never>;
      "menu:open-file": Record<string, never>;
      "menu:save-file": Record<string, never>;
    };
  };
};

// ── Shell state ────────────────────────────────────────────────────────────
const SENTINEL = "__TERM_DONE__";
const decoder = new TextDecoder();
let outputBuffer = "";
let currentDir = process.env.HOME ?? "/";

function stripAnsi(s: string) {
  // Remove ANSI escape codes (colors, cursor moves, etc.)
  return s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
          .replace(/\x1b\][^\x07]*\x07/g, "")
          .replace(/\x1b[()][AB012]/g, "")
          .replace(/\r/g, "");
}

// Spawn a persistent, non-interactive zsh that reads from stdin
const shell = Bun.spawn(["/bin/zsh", "--no-rcs", "-s"], {
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
  cwd: currentDir,
  env: { ...process.env, TERM: "dumb", PS1: "", PS2: "" },
});

// ── RPC ─────────────────────────────────────────────────────────────────────
const rpc = BrowserView.defineRPC<AppSchema>({
  handlers: {
    messages: {
      "terminal:input": ({ data }) => {
        const cmd = data.trim();
        if (!cmd) {
          // empty Enter → re-show prompt (mainWindow is defined by the time any input arrives)
          sendToWebview("terminal:output", { data: `\x00PROMPT:${currentDir}\x00` });
          return;
        }
        // Wrap command so we get a sentinel line with the new cwd and exit code
        const wrapped = `{ ${cmd}; }; echo "${SENTINEL}:$(pwd):$?"\n`;
        shell.stdin.write(wrapped);
      },
    },
  },
});

// ── Window ──────────────────────────────────────────────────────────────────
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

// ── Helper: safely send to webview ──────────────────────────────────────────
function sendToWebview(name: keyof AppSchema["webview"]["messages"], payload: Record<string, unknown>) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mainWindow.webview.rpc?.send as any)?.[name]?.(payload);
  } catch {}
}

// ── Stream shell stdout ──────────────────────────────────────────────────────
(async () => {
  for await (const chunk of shell.stdout) {
    outputBuffer += decoder.decode(chunk);
    flushBuffer();
  }
})();

// ── Stream shell stderr ──────────────────────────────────────────────────────
(async () => {
  for await (const chunk of shell.stderr) {
    const text = stripAnsi(decoder.decode(chunk));
    if (text) sendToWebview("terminal:output", { data: text });
  }
})();

function flushBuffer() {
  const sentinelPattern = new RegExp(`${SENTINEL}:([^\\n]*?):(\\d+)\\n`);
  let match: RegExpExecArray | null;

  while ((match = sentinelPattern.exec(outputBuffer)) !== null) {
    const beforeSentinel = outputBuffer.slice(0, match.index);
    const newDir = match[1] ?? currentDir;
    outputBuffer = outputBuffer.slice(match.index + match[0].length);

    // Send any output that appeared before the sentinel
    const cleaned = stripAnsi(beforeSentinel);
    if (cleaned) sendToWebview("terminal:output", { data: cleaned });

    currentDir = newDir;
    sendToWebview("terminal:output", { data: `\x00PROMPT:${currentDir}\x00` });
  }

  // Forward partial output that is definitely not part of a sentinel yet
  const partialSentinelStart = outputBuffer.indexOf(SENTINEL);
  const safeEnd = partialSentinelStart === -1 ? outputBuffer.length : partialSentinelStart;
  if (safeEnd > 0) {
    const cleaned = stripAnsi(outputBuffer.slice(0, safeEnd));
    if (cleaned) sendToWebview("terminal:output", { data: cleaned });
    outputBuffer = outputBuffer.slice(safeEnd);
  }
}

// ── Send initial prompt once UI is ready ────────────────────────────────────
setTimeout(() => {
  sendToWebview("terminal:output", { data: `\x00PROMPT:${currentDir}\x00` });
}, 1500);

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

// ── Menu Bar ──────────────────────────────────────────────────────────────────
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

// ── Menu click handler ───────────────────────────────────────────────────────
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
