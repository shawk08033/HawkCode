import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CONFIG_FILENAME = "hawkcode.config.json";

function resolveConfigPath() {
  let current = process.cwd();
  let lastFound = null;

  while (true) {
    const candidate = path.resolve(current, CONFIG_FILENAME);
    if (fs.existsSync(candidate)) {
      lastFound = candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return lastFound ?? path.resolve(process.cwd(), CONFIG_FILENAME);
    }
    current = parent;
  }
}

function main() {
  const configPath = resolveConfigPath();
  const env = { ...process.env };
  let hasDatabaseUrl = false;

  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);

    if (typeof parsed.databaseUrl === "string" && parsed.databaseUrl.length > 0) {
      env.DATABASE_URL = parsed.databaseUrl;
      hasDatabaseUrl = true;
    }

    if (typeof parsed.dbProvider === "string" && parsed.dbProvider.length > 0) {
      env.DATABASE_PROVIDER = parsed.dbProvider;
    }
  }

  if (!hasDatabaseUrl) {
    console.error(
      'databaseUrl is not configured in hawkcode.config.json. Run "pnpm setup" first or update the config file before running Prisma.'
    );
    process.exit(1);
  }

  const prismaBin = path.resolve(process.cwd(), "node_modules/.bin/prisma");
  const result = spawnSync(prismaBin, process.argv.slice(2), {
    stdio: "inherit",
    env
  });

  process.exit(result.status ?? 1);
}

main();
