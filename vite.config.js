import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";

/** @type {{ env?: { TAURI_DEV_HOST?: string } }} */
const nodeProcess = Reflect.get(globalThis, "process") ?? {};
const host = nodeProcess.env?.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [sveltekit(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/@lucide/")) return "vendor-icons";
          if (id.includes("/@shikijs/langs/")) return undefined;
          if (id.includes("/shiki") || id.includes("/@shikijs/core/") || id.includes("/@shikijs/engine-")) return "vendor-highlighting";
          if (id.includes("/@shikijs/themes/")) return "vendor-highlighting-themes";
          if (id.includes("/prosemirror-")) return "vendor-editor";
          if (id.includes("/@tauri-apps/")) return "vendor-tauri";
          return "vendor";
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : false,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
});
