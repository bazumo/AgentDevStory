import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: ".",
  publicDir: false,
  server: {
    port: 5173,
    fs: {
      allow: [path.resolve(__dirname, "..")]
    },
    proxy: {
      "/api": "http://127.0.0.1:4317"
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
