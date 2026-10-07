import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

// Feishu H5 front-end. Built into web/dist, which nginx serves directly, so the
// relay process never touches static files.
export default defineConfig({
  root: dir,
  plugins: [react()],
  resolve: {
    alias: { "@shared": path.resolve(dir, "../src/shared") },
  },
  build: {
    outDir: path.resolve(dir, "dist"),
    emptyOutDir: true,
  },
});
