import { BrowserWindow, Updater, ApplicationMenu, BrowserView } from "electrobun/bun";
const { setApplicationMenu, on } = ApplicationMenu;
import { createTerminalForWorkspace, writeToTty, resizePty, destroyTerminal } from "./terminal";
import * as git from "./git";

// Save the initial CWD before it can change
process.env.INITIAL_CWD = process.cwd();

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
      /** Start a run command as a child process */
      "run:start": { command: string; workspaceId: string; cwd?: string };
      /** Stop the running process for a workspace */
      "run:stop": { workspaceId: string };
      /** Set workspace root path for auto-cd on terminal creation */
      "workspace:setRootPath": { workspaceId: string; path: string };
      /** Get current working directory */
      "get-cwd": Record<string, never>;
      /** Open native folder picker dialog */
      "folder:pick": { workspaceId: string };
      /** Git operations */
      "git:open": { path: string };
      "git:status": { path: string };
      "git:diff": { path: string; filePath: string };
      "git:log": { path: string; maxCount?: number };
      "git:stage": { path: string; filePath?: string };
      "git:commit": { path: string; message: string };
    };
  };
  webview: {
    requests: Record<string, never>;
    messages: {
      /** Raw PTY output, base64-encoded */
      "terminal:output": { data: string; workspaceId: string };
      /** Shell process exited (e.g. user typed 'exit') */
      "terminal:exited": { workspaceId: string };
      /** Run process output chunk */
      "run:output": { data: string; workspaceId: string; stream: "stdout" | "stderr" };
      /** Run process ended */
      "run:ended": { workspaceId: string; exitCode: number | null };
      "menu:open-settings": Record<string, never>;
      "menu:new-file": Record<string, never>;
      "menu:open-file": { path: string };
      "menu:save-file": Record<string, never>;
      "get-cwd": { cwd: string };
      "git:status": { isRepo: boolean; branch: string; changes: git.GitChange[]; rootPath: string };
      "git:diff": { filePath: string; diff: string };
      "git:log": { commits: git.GitCommit[] };
      "git:error": { message: string };
      "folder:picked": { workspaceId: string; path: string; name: string; cancelled: boolean };
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

// Store running processes per workspace
const runningProcesses = new Map<string, ReturnType<typeof Bun.spawn>>();

// Store git root per workspace
let currentGitRoot: string | null = null;

// Store root path per workspace for auto-cd when terminal is created
// Key is the workspace ID (without _t suffix)
const workspaceRootPaths = new Map<string, string>();

// Helper to extract base workspace ID from terminal ID (e.g., "uuid_t0" -> "uuid")
function getBaseWorkspaceId(terminalId: string): string {
  return terminalId.split('_t')[0];
}

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
          // Auto-cd to workspace root path if set
          const baseId = getBaseWorkspaceId(workspaceId);
          const rootPath = workspaceRootPaths.get(baseId);
          if (rootPath) {
            console.log(`[index.ts] Auto-cd for terminal ${workspaceId} (base: ${baseId}) to ${rootPath}`);
            setTimeout(() => {
              const b64 = Buffer.from(`cd "${rootPath}"` + "\n").toString("base64");
              writeToTty(workspaceId, b64);
            }, 500);
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
      "run:start": ({ command, workspaceId, cwd }) => {
        console.log(`[index.ts] run:start received for ${workspaceId}: ${command}`);
        // Kill any existing process for this workspace
        const existing = runningProcesses.get(workspaceId);
        if (existing) {
          try { existing.kill(); } catch {}
          runningProcesses.delete(workspaceId);
        }

        const parts = command.trim().split(/\s+/);
        const runCwd = cwd ?? workspaceRootPaths.get(workspaceId) ?? process.cwd();

        let proc: ReturnType<typeof Bun.spawn>;
        try {
          proc = Bun.spawn(parts, {
            cwd: runCwd,
            stdout: "pipe",
            stderr: "pipe",
            env: { ...process.env },
          });
        } catch (err) {
          sendToWebview("run:output", { data: `Error: ${String(err)}\n`, workspaceId, stream: "stderr" });
          sendToWebview("run:ended", { workspaceId, exitCode: null });
          return;
        }

        runningProcesses.set(workspaceId, proc);

        // Stream stdout
        (async () => {
          const reader = proc.stdout.getReader();
          const dec = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sendToWebview("run:output", { data: dec.decode(value), workspaceId, stream: "stdout" });
          }
        })();

        // Stream stderr
        (async () => {
          const reader = proc.stderr.getReader();
          const dec = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sendToWebview("run:output", { data: dec.decode(value), workspaceId, stream: "stderr" });
          }
        })();

        // Wait for exit
        proc.exited.then((exitCode) => {
          runningProcesses.delete(workspaceId);
          sendToWebview("run:ended", { workspaceId, exitCode });
        });
      },
      "run:stop": ({ workspaceId }) => {
        console.log(`[index.ts] run:stop received for ${workspaceId}`);
        const proc = runningProcesses.get(workspaceId);
        if (proc) {
          try { proc.kill(); } catch {}
          runningProcesses.delete(workspaceId);
          sendToWebview("run:ended", { workspaceId, exitCode: null });
        }
      },
      "workspace:setRootPath": ({ workspaceId, path }) => {
        console.log(`[index.ts] workspace:setRootPath received: ${workspaceId} -> ${path}`);
        const baseId = getBaseWorkspaceId(workspaceId);
        workspaceRootPaths.set(baseId, path);
        // If any terminal for this workspace is already ready, cd to all of them
        for (const [termId, isReady] of workspaceReady.entries()) {
          if (isReady && getBaseWorkspaceId(termId) === baseId) {
            console.log(`[index.ts] Terminal ${termId} already ready, executing cd to ${path}`);
            setTimeout(() => {
              const b64 = Buffer.from(`cd "${path}"` + "\n").toString("base64");
              writeToTty(termId, b64);
            }, 500);
          }
        }
      },
      "get-cwd": () => {
        const cwd = process.cwd();
        console.log(`[index.ts] get-cwd: ${cwd}`);
        sendToWebview("get-cwd", { cwd });
      },
      "git:open": async ({ path }) => {
        console.log(`[index.ts] git:open received for ${path}`);
        const gitRoot = await git.openRepository(path);
        if (!gitRoot) {
          sendToWebview("git:error", { message: "Not a git repository" });
          return;
        }
        currentGitRoot = gitRoot;
        console.log(`[index.ts] currentGitRoot set to: ${currentGitRoot}`);
        const [status, commits] = await Promise.all([
          git.getStatus(gitRoot),
          git.getLog(gitRoot, 50),
        ]);
        // Send folder:picked with resolved absolute path
        sendToWebview("folder:picked", { workspaceId: "", path: gitRoot, name: path, cancelled: false });
        sendToWebview("git:status", status);
        sendToWebview("git:log", { commits });
      },
      "git:status": async ({ path }) => {
        console.log(`[index.ts] git:status received for ${path}`);
        const repoPath = currentGitRoot || path;
        try {
          const [status, commits] = await Promise.all([
            git.getStatus(repoPath),
            git.getLog(repoPath, 50),
          ]);
          sendToWebview("git:status", status);
          sendToWebview("git:log", { commits });
        } catch (e) {
          sendToWebview("git:error", { message: String(e) });
        }
      },
      "git:diff": async ({ path, filePath }) => {
        console.log(`[index.ts] git:diff received for ${filePath}`);
        const repoPath = currentGitRoot || path;
        try {
          const diff = await git.getDiff(repoPath, filePath);
          console.log(`[index.ts] git:diff result length: ${diff.length}`);
          sendToWebview("git:diff", { filePath, diff });
        } catch (e) {
          console.error(`[index.ts] git:diff error:`, e);
          sendToWebview("git:error", { message: String(e) });
        }
      },
      "git:log": async ({ path, maxCount }) => {
        console.log(`[index.ts] git:log received for ${path}`);
        const repoPath = currentGitRoot || path;
        try {
          const commits = await git.getLog(repoPath, maxCount ?? 50);
          sendToWebview("git:log", { commits });
        } catch (e) {
          sendToWebview("git:error", { message: String(e) });
        }
      },
      "git:stage": async ({ path, filePath }) => {
        console.log(`[index.ts] git:stage received for ${filePath || "all"}`);
        try {
          if (filePath) {
            await git.stageFile(path, filePath);
          } else {
            await git.stageAll(path);
          }
          const status = await git.getStatus(path);
          sendToWebview("git:status", status);
        } catch (e) {
          sendToWebview("git:error", { message: String(e) });
        }
      },
      "git:commit": async ({ path, message }) => {
        console.log(`[index.ts] git:commit received for ${path}`);
        try {
          await git.commit(path, message);
          const status = await git.getStatus(path);
          sendToWebview("git:status", status);
          const commits = await git.getLog(path, 50);
          sendToWebview("git:log", { commits });
        } catch (e) {
          sendToWebview("git:error", { message: String(e) });
        }
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
    case "open-file":     sendToWebview("menu:open-file", { path: process.cwd() });     break;
    case "save-file":     sendToWebview("menu:save-file", {});     break;
  }
});

console.log("Svelte app started!");
