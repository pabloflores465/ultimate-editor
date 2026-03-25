import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import Pages from "vite-plugin-pages";

// Removes `crossorigin` from script/link tags so views:// protocol can load modules
function removeCrossorigin(): Plugin {
  return {
    name: "remove-crossorigin",
    transformIndexHtml(html) {
      return html.replace(/ crossorigin(?:="[^"]*")?/g, "");
    },
  };
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    svelte(),
    Pages({
      dirs: "pages",
      extensions: ["svelte"],
      importMode: "sync",
    }),
    removeCrossorigin(),
  ],
  root: "src/mainview",
  base: "./",
  resolve: {
    alias: {
      // Map the "electrobun/view" export to the browser API bundle
      "electrobun/view": new URL(
        "./node_modules/electrobun/dist/api/browser/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  optimizeDeps: {
    exclude: ["svelte-spa-router"],
    include: [],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
