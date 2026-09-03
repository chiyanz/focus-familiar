import { resolve } from "node:path";
import { defineConfig } from "vite";

const repositoryRoot = resolve(__dirname);

/**
 * The lab is deliberately a separate Vite entry point. It can import the
 * renderer's pure presentation code and bundled art while staying completely
 * independent from Electron and the preload bridge.
 */
export default defineConfig({
  root: resolve(repositoryRoot, "src/lab"),
  server: {
    host: "127.0.0.1",
    fs: {
      allow: [repositoryRoot],
    },
  },
  build: {
    outDir: resolve(repositoryRoot, "dist/lab"),
    emptyOutDir: true,
  },
});
