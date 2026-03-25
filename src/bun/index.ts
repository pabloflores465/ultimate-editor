import { BrowserWindow, Updater, WGPUView, ApplicationMenu } from "electrobun/bun";
const { setApplicationMenu, on } = ApplicationMenu;
import { renderTriangle } from "./webgpu-renderer";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

// Check if Vite dev server is running for HMR, retrying up to 5s
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
		console.log(
			"Vite dev server not running after 5s. Run 'bun run dev:hmr' for HMR support.",
		);
	}
	return "views://mainview/index.html";
}

// Create the main application window
const url = await getMainViewUrl();

const mainWindow = new BrowserWindow({
	title: "Svelte App",
	url,
	frame: {
		width: 900,
		height: 700,
		x: 200,
		y: 200,
	},
});

// Detect new WGPUViews created by <electrobun-wgpu> elements and start rendering on them.
// The preload handles wgpuTagInit internally, so we poll for newly created views here.
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

// ── Menu Bar ──────────────────────────────────────────────────────────────
setApplicationMenu([
  {
    label: "Svelte App",
    submenu: [
      { role: "about" },
      { type: "separator" },
      {
        label: "Settings...",
        accelerator: "Cmd+,",
        action: "open-settings",
      },
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
      {
        label: "New File",
        accelerator: "Cmd+N",
        action: "new-file",
      },
      {
        label: "Open...",
        accelerator: "Cmd+O",
        action: "open-file",
      },
      { type: "separator" },
      {
        label: "Save",
        accelerator: "Cmd+S",
        action: "save-file",
      },
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
  {
    label: "View",
    submenu: [
      { role: "toggleFullScreen" },
    ],
  },
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

// ── Manejar clicks del menú ────────────────────────────────────────────────
on("application-menu-clicked", ({ action }: { action: string }) => {
  switch (action) {
    case "open-settings":
      // TODO: abrir ventana de settings
      console.log("Abrir Settings");
      mainWindow.webContents.send({ name: "menu:open-settings", data: {} });
      break;
    case "new-file":
      mainWindow.webContents.send({ name: "menu:new-file", data: {} });
      break;
    case "open-file":
      mainWindow.webContents.send({ name: "menu:open-file", data: {} });
      break;
    case "save-file":
      mainWindow.webContents.send({ name: "menu:save-file", data: {} });
      break;
  }
});

console.log("Svelte app started!");
