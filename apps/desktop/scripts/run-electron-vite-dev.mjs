import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const env = { ...process.env };

delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(pnpmCommand, ["exec", "electron-vite", "dev", ...process.argv.slice(2)], {
  cwd: desktopDir,
  env,
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error("Failed to launch electron-vite dev:", error);
  process.exit(1);
});
