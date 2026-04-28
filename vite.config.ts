import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Tauri expects a fixed port; fail fast if it's already in use.
const HOST = process.env.TAURI_DEV_HOST;

function gitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

function appVersion(): string {
  const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8"));
  return pkg.version as string;
}

export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
    __GIT_HASH__: JSON.stringify(gitHash()),
    __BUILD_AT__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 1421,
    strictPort: true,
    host: HOST || false,
    hmr: HOST
      ? { protocol: "ws", host: HOST, port: 1422 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
