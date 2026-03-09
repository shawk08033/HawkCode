import { defineConfig } from "electron-vite";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    build: {
      outDir: resolve(__dirname, "dist/main"),
      lib: {
        entry: resolve(__dirname, "src/main/index.ts"),
        formats: ["es"]
      }
    }
  },
  preload: {
    build: {
      outDir: resolve(__dirname, "dist/preload"),
      lib: {
        entry: resolve(__dirname, "src/preload/index.ts"),
        fileName: () => "index.cjs",
        formats: ["cjs"]
      }
    }
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    build: {
      outDir: resolve(__dirname, "dist/renderer")
    }
  }
});
