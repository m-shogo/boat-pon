import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  optimizeDeps: {
    entries: ["public-dashboard.html"],
  },
  build: {
    outDir: "dist-public-dashboard",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: resolve(process.cwd(), "public-dashboard.html"),
    },
  },
});
