import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        app: resolve(process.cwd(), "index.html"),
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    watch: {
      ignored: ["**/data/**", "**/dist/**"],
    },
    proxy: {
      "/api": "http://127.0.0.1:5174",
    },
  },
});
