import { defineConfig } from "electron-vite";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    entry: resolve(__dirname, "src/main/index.ts"),
    build: {
      outDir: resolve(__dirname, "dist/main")
    }
  },
  preload: {
    entry: resolve(__dirname, "src/preload/index.ts"),
    build: {
      outDir: resolve(__dirname, "dist/preload")
    }
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    build: {
      outDir: resolve(__dirname, "dist/renderer")
    }
  }
});
