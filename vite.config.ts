import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    // Tauri uses Chromium on Windows/Linux and WebKit on macOS — both support ES2021.
    target: "es2021",
    // Produce smaller output for a desktop app (no sourcemaps in production).
    sourcemap: false,
    // Single-page app with small bundle; avoid unnecessary chunk splitting.
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        // Keep the bundle compact — one JS file for this tiny app.
        manualChunks: undefined,
      },
    },
  },
});
