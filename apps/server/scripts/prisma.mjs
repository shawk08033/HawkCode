import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CONFIG_FILENAME = "hawkcode.config.json";

function resolveConfigPath() {
  const cwd = process.cwd();
  const direct = path.resolve(cwd, CONFIG_FILENAME);
  if (fs.existsSync(direct)) {
    return direct;
  }
  const parent = path.resolve(cwd, "..", CONFIG_FILENAME);
  if (fs.existsSync(parent)) {
    return parent;
  }
  return parent;
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
