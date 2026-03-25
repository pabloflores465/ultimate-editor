import { BrowserWindow, Updater, WGPUView } from "electrobun/bun";
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

console.log("Svelte app started!");
