import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import Pages from "vite-plugin-pages";

export default defineConfig({
  plugins: [
    tailwindcss(),
    svelte(),
    Pages({
      dirs: "pages",
      extensions: ["svelte"],
    }),
  ],
  root: "src/mainview",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  optimizeDeps: {
    exclude: ["svelte-spa-router"],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
