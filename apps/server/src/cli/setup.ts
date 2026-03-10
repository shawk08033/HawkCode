import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import bcrypt from "bcryptjs";
import prompts from "prompts";
import { Prisma } from "@prisma/client";
import { setupConfigSchema } from "@hawkcode/shared";
import { getSetupComplete, setSetupComplete } from "../lib/setup-status.js";
import { resolveConfigPath } from "../lib/runtime-config.js";

type SetupArgs = {
  nonInteractive: boolean;
  writeEnv: boolean;
  writeConfig: boolean;
};

const DEFAULT_ENV_PATH = path.resolve(process.cwd(), ".env");

function parseArgs(argv: string[]): SetupArgs {
  const nonInteractive = argv.includes("--non-interactive") ||
    process.env.HAWKCODE_NONINTERACTIVE === "1";
  const writeEnv = argv.includes("--write-env") || process.env.HAWKCODE_WRITE_ENV === "1";
  const writeConfig = !argv.includes("--no-config");
  return { nonInteractive, writeEnv, writeConfig };
}

function getEnvValue(key: string): string | undefined {
  const value = process.env[key];
  return value && value.length > 0 ? value : undefined;
}

function cleanValue(value?: string) {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function promptForConfig(nonInteractive: boolean) {
  if (nonInteractive) {
    return setupConfigSchema.parse({
      adminEmail: cleanValue(getEnvValue("HAWKCODE_ADMIN_EMAIL")),
      adminPassword: cleanValue(getEnvValue("HAWKCODE_ADMIN_PASSWORD")),
      workspaceName: cleanValue(getEnvValue("HAWKCODE_WORKSPACE_NAME")),
      dbProvider: (getEnvValue("DATABASE_PROVIDER") ?? "postgresql"),
      databaseUrl: cleanValue(getEnvValue("DATABASE_URL")),
      redisUrl: cleanValue(getEnvValue("REDIS_URL")),
      githubAppId: cleanValue(getEnvValue("GITHUB_APP_ID")),
      githubAppKeyPath: cleanValue(getEnvValue("GITHUB_APP_KEY_PATH")),
      codexPath: undefined,
      codexModel: undefined,
      openrouterApiKey: undefined,
      openrouterBaseUrl: undefined,
      openrouterModel: undefined,
      openrouterSiteUrl: undefined,
      openrouterAppName: undefined
    });
  }

  const response = await prompts([
    {
      type: "text",
      name: "adminEmail",
      message: "Admin email",
      initial: getEnvValue("HAWKCODE_ADMIN_EMAIL")
    },
    {
      type: "password",
      name: "adminPassword",
      message: "Admin password",
      initial: undefined
    },
    {
      type: "text",
      name: "workspaceName",
      message: "Workspace name",
      initial: getEnvValue("HAWKCODE_WORKSPACE_NAME") ?? "HawkCode"
    },
    {
      type: "select",
      name: "dbProvider",
      message: "Database provider",
      choices: [
        { title: "Postgres", value: "postgresql" },
        { title: "SQLite", value: "sqlite" }
      ],
      initial: 0
    },
    {
      type: "text",
      name: "databaseUrl",
      message: "Database URL",
      initial: getEnvValue("DATABASE_URL") ?? "postgresql://user:pass@localhost:5432/hawkcode"
    },
    {
      type: "text",
      name: "redisUrl",
      message: "Redis URL (optional)",
      initial: getEnvValue("REDIS_URL") ?? ""
    },
    {
      type: "text",
      name: "githubAppId",
      message: "GitHub App ID (optional)",
      initial: getEnvValue("GITHUB_APP_ID") ?? ""
    },
    {
      type: "text",
      name: "githubAppKeyPath",
      message: "GitHub App private key path (optional)",
      initial: getEnvValue("GITHUB_APP_KEY_PATH") ?? ""
    },
    {
      type: "text",
      name: "codexPath",
      message: "Codex CLI path (optional)",
      initial: "codex"
    },
    {
      type: "text",
      name: "codexModel",
      message: "Codex default model (optional)",
      initial: "gpt-5"
    },
    {
      type: "text",
      name: "openrouterApiKey",
      message: "OpenRouter API key (optional)",
      initial: ""
    },
    {
      type: "text",
      name: "openrouterModel",
      message: "OpenRouter default model (optional)",
      initial: "openai/gpt-5"
    },
    {
      type: "text",
      name: "openrouterSiteUrl",
      message: "OpenRouter site URL (optional)",
      initial: ""
    },
    {
      type: "text",
      name: "openrouterAppName",
      message: "OpenRouter app name (optional)",
      initial: ""
    },
    {
      type: "text",
      name: "tlsCertPath",
      message: "TLS certificate path (optional)",
      initial: getEnvValue("HAWKCODE_TLS_CERT_PATH") ?? ""
    },
    {
      type: "text",
      name: "tlsKeyPath",
      message: "TLS key path (optional)",
      initial: getEnvValue("HAWKCODE_TLS_KEY_PATH") ?? ""
    }
  ]);

  return setupConfigSchema.parse({
    ...response,
    adminEmail: cleanValue(response.adminEmail),
    adminPassword: cleanValue(response.adminPassword),
    workspaceName: cleanValue(response.workspaceName),
    databaseUrl: cleanValue(response.databaseUrl),
    redisUrl: cleanValue(response.redisUrl),
    githubAppId: cleanValue(response.githubAppId),
    githubAppKeyPath: cleanValue(response.githubAppKeyPath),
    codexPath: cleanValue(response.codexPath),
    codexModel: cleanValue(response.codexModel),
    openrouterApiKey: cleanValue(response.openrouterApiKey),
    openrouterModel: cleanValue(response.openrouterModel),
    openrouterSiteUrl: cleanValue(response.openrouterSiteUrl),
    openrouterAppName: cleanValue(response.openrouterAppName),
    tlsCertPath: cleanValue(response.tlsCertPath),
    tlsKeyPath: cleanValue(response.tlsKeyPath)
  });
}

async function promptForRuntimeConfig(nonInteractive: boolean) {
  if (nonInteractive) {
    return {
      dbProvider: (getEnvValue("DATABASE_PROVIDER") ?? "postgresql") as
        | "postgresql"
        | "sqlite",
      databaseUrl: cleanValue(getEnvValue("DATABASE_URL")),
      redisUrl: cleanValue(getEnvValue("REDIS_URL"))
    };
  }

  const response = await prompts([
    {
      type: "select",
      name: "dbProvider",
      message: "Database provider",
      choices: [
        { title: "Postgres", value: "postgresql" },
        { title: "SQLite", value: "sqlite" }
      ],
      initial: 0
    },
    {
      type: "text",
      name: "databaseUrl",
      message: "Database URL",
      initial: getEnvValue("DATABASE_URL") ?? "postgresql://user:pass@localhost:5432/hawkcode"
    },
    {
      type: "text",
      name: "redisUrl",
      message: "Redis URL (optional)",
      initial: getEnvValue("REDIS_URL") ?? ""
    }
  ]);

  return {
    dbProvider: response.dbProvider as "postgresql" | "sqlite",
    databaseUrl: cleanValue(response.databaseUrl) as string,
    redisUrl: cleanValue(response.redisUrl)
  };
}

function resolvePrismaBin() {
  const prismaBin = path.resolve(process.cwd(), "node_modules/.bin/prisma");
  if (!fs.existsSync(prismaBin)) {
    throw new Error("Prisma CLI not found. Run pnpm install first.");
  }
  return prismaBin;
}

function runPrismaCommand(args: string[]) {
  const prismaBin = resolvePrismaBin();
  const result = spawnSync(prismaBin, args, {
    stdio: "inherit",
    env: process.env
  });
  if (result.status !== 0) {
    throw new Error(`Prisma command failed: ${args.join(" ")}`);
  }
}

async function initializeDatabase(dbProvider: "postgresql" | "sqlite") {
  if (dbProvider === "sqlite") {
    runPrismaCommand(["db", "push", "--schema", "prisma/schema.sqlite.prisma"]);
    runPrismaCommand(["generate", "--schema", "prisma/schema.sqlite.prisma"]);
    return;
  }

  runPrismaCommand(["migrate", "dev", "--name", "init"]);
  runPrismaCommand(["generate"]);
}

function buildEnvContent(config: {
  dbProvider: string;
  databaseUrl: string;
  redisUrl?: string;
  githubAppId?: string;
  githubAppKeyPath?: string;
  codexPath?: string;
  codexModel?: string;
  openrouterApiKey?: string;
  openrouterBaseUrl?: string;
  openrouterModel?: string;
  openrouterSiteUrl?: string;
  openrouterAppName?: string;
}) {
  const lines = [
    `DATABASE_PROVIDER=${config.dbProvider}`,
    `DATABASE_URL=${config.databaseUrl}`
  ];
  if (config.redisUrl) {
    lines.push(`REDIS_URL=${config.redisUrl}`);
  }
  if (config.githubAppId) {
    lines.push(`GITHUB_APP_ID=${config.githubAppId}`);
  }
  if (config.githubAppKeyPath) {
    lines.push(`GITHUB_APP_KEY_PATH=${config.githubAppKeyPath}`);
  }
  return lines.join("\n");
}

async function writeEnvFile(content: string) {
  fs.writeFileSync(DEFAULT_ENV_PATH, `${content}\n`, "utf8");
}

function writeConfigFile(config: {
  dbProvider: string;
  databaseUrl: string;
  redisUrl?: string;
  codexPath?: string;
  codexModel?: string;
  openrouterApiKey?: string;
  openrouterBaseUrl?: string;
  openrouterModel?: string;
  openrouterSiteUrl?: string;
  openrouterAppName?: string;
  tlsCertPath?: string;
  tlsKeyPath?: string;
}) {
  const configPath = resolveConfigPath();
  const payload = {
    dbProvider: config.dbProvider,
    databaseUrl: config.databaseUrl,
    ...(config.redisUrl ? { redisUrl: config.redisUrl } : {}),
    ...(config.codexPath ? { codexPath: config.codexPath } : {}),
    ...(config.codexModel ? { codexModel: config.codexModel } : {}),
    ...(config.openrouterApiKey ? { openrouterApiKey: config.openrouterApiKey } : {}),
    ...(config.openrouterBaseUrl ? { openrouterBaseUrl: config.openrouterBaseUrl } : {}),
    ...(config.openrouterModel ? { openrouterModel: config.openrouterModel } : {}),
    ...(config.openrouterSiteUrl ? { openrouterSiteUrl: config.openrouterSiteUrl } : {}),
    ...(config.openrouterAppName ? { openrouterAppName: config.openrouterAppName } : {}),
    ...(config.tlsCertPath ? { tlsCertPath: config.tlsCertPath } : {}),
    ...(config.tlsKeyPath ? { tlsKeyPath: config.tlsKeyPath } : {})
  };
  fs.writeFileSync(configPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const alreadySetup = await getSetupComplete();
  const configPath = resolveConfigPath();
  const hasConfig = fs.existsSync(configPath);
  if (alreadySetup && hasConfig) {
    console.log("Setup already completed.");
    process.exit(0);
  }

  if (alreadySetup && !hasConfig) {
    const runtimeConfig = await promptForRuntimeConfig(args.nonInteractive);
    if (!runtimeConfig.databaseUrl) {
      console.error("Database URL is required.");
      process.exit(1);
    }
    writeConfigFile({
      dbProvider: runtimeConfig.dbProvider,
      databaseUrl: runtimeConfig.databaseUrl,
      redisUrl: runtimeConfig.redisUrl
    });
    console.log(`Config written to ${configPath}`);
    process.exit(0);
  }

  const config = await promptForConfig(args.nonInteractive);

  process.env.DATABASE_URL = config.databaseUrl;
  process.env.DATABASE_PROVIDER = config.dbProvider;

  const { initDb } = args.nonInteractive
    ? { initDb: true }
    : await prompts({
        type: "confirm",
        name: "initDb",
        message: "Initialize database now?",
        initial: true
      });

  if (initDb) {
    await initializeDatabase(config.dbProvider);
  }

  const { prisma } = await import("../lib/prisma.js");
  await prisma.$connect();

  const passwordHash = await bcrypt.hash(config.adminPassword, 12);

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    let user = await tx.user.findUnique({ where: { email: config.adminEmail } });
    if (!user) {
      user = await tx.user.create({
        data: {
          email: config.adminEmail,
          passwordHash
        }
      });
    }

    let workspace = await tx.workspace.findFirst({
      where: { name: config.workspaceName }
    });
    if (!workspace) {
      workspace = await tx.workspace.create({
        data: { name: config.workspaceName }
      });
    }

    const existingMembership = await tx.membership.findFirst({
      where: { userId: user.id, workspaceId: workspace.id }
    });
    if (!existingMembership) {
      await tx.membership.create({
        data: {
          role: "owner",
          userId: user.id,
          workspaceId: workspace.id
        }
      });
    }
    await tx.systemSetting.upsert({
      where: { key: "dbProvider" },
      update: { value: config.dbProvider },
      create: { key: "dbProvider", value: config.dbProvider }
    });
    await tx.systemSetting.upsert({
      where: { key: "redisMode" },
      update: { value: config.redisUrl ? "enabled" : "degraded" },
      create: { key: "redisMode", value: config.redisUrl ? "enabled" : "degraded" }
    });
    return { user, workspace };
  });

  await setSetupComplete(true);

  if (args.writeEnv) {
    const envContent = buildEnvContent({
      dbProvider: config.dbProvider,
      databaseUrl: config.databaseUrl,
      redisUrl: config.redisUrl,
      githubAppId: config.githubAppId,
      githubAppKeyPath: config.githubAppKeyPath,
      codexPath: config.codexPath,
      codexModel: config.codexModel,
      openrouterApiKey: config.openrouterApiKey,
      openrouterBaseUrl: config.openrouterBaseUrl,
      openrouterModel: config.openrouterModel,
      openrouterSiteUrl: config.openrouterSiteUrl,
      openrouterAppName: config.openrouterAppName
    });
    await writeEnvFile(envContent);
  }

  if (args.writeConfig) {
    writeConfigFile({
      dbProvider: config.dbProvider,
      databaseUrl: config.databaseUrl,
      redisUrl: config.redisUrl,
      codexPath: config.codexPath,
      codexModel: config.codexModel,
      openrouterApiKey: config.openrouterApiKey,
      openrouterBaseUrl: config.openrouterBaseUrl,
      openrouterModel: config.openrouterModel,
      openrouterSiteUrl: config.openrouterSiteUrl,
      openrouterAppName: config.openrouterAppName,
      tlsCertPath: config.tlsCertPath,
      tlsKeyPath: config.tlsKeyPath
    });
  }

  console.log(`Setup complete. Admin user: ${result.user.email}`);
  console.log(`Workspace: ${result.workspace.name}`);
  if (!config.redisUrl) {
    console.log("Redis not configured. Running in degraded mode.");
  }
}

main().catch((error) => {
  console.error("Setup failed:", error);
  process.exit(1);
});
