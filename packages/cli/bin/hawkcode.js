#!/usr/bin/env node
const { spawnSync } = require("node:child_process");

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "help" || command === "--help" || command === "-h") {
  console.log("hawkcode setup [--non-interactive] [--write-env]");
  process.exit(0);
}

if (command !== "setup") {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

const result = spawnSync("pnpm", ["-C", "apps/server", "setup", ...args.slice(1)], {
  stdio: "inherit",
  env: process.env
});

process.exit(result.status ?? 1);
