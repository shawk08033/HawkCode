import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const configSchema = z.object({
  databaseUrl: z.string().min(1),
  dbProvider: z.enum(["postgresql", "sqlite"]),
  redisUrl: z.string().optional(),
  codexPath: z.string().optional(),
  codexModel: z.string().optional(),
  openrouterApiKey: z.string().optional(),
  openrouterBaseUrl: z.string().optional(),
  openrouterModel: z.string().optional(),
  openrouterSiteUrl: z.string().optional(),
  openrouterAppName: z.string().optional(),
  tlsCertPath: z.string().optional(),
  tlsKeyPath: z.string().optional()
});

export type RuntimeConfig = z.infer<typeof configSchema>;

const CONFIG_FILENAME = "hawkcode.config.json";
const LEGACY_PROVIDER_ENV_VARS = [
  "CODEX_PATH",
  "CODEX_MODEL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "OPENROUTER_MODEL",
  "OPENROUTER_SITE_URL",
  "OPENROUTER_APP_NAME"
] as const;
let warnedLegacyProviderEnvVars = false;

export function resolveConfigPath() {
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

export function loadRuntimeConfig(): RuntimeConfig | null {
  const configPath = resolveConfigPath();
  if (!fs.existsSync(configPath)) {
    return null;
  }
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const config = configSchema.parse(parsed);
  const baseDir = path.dirname(configPath);
  const resolveMaybe = (value?: string) => {
    if (!value) return undefined;
    return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
  };
  return {
    ...config,
    tlsCertPath: resolveMaybe(config.tlsCertPath),
    tlsKeyPath: resolveMaybe(config.tlsKeyPath)
  };
}

export function findLegacyProviderEnvVars(env: NodeJS.ProcessEnv = process.env) {
  return LEGACY_PROVIDER_ENV_VARS.filter((name) => {
    const value = env[name];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function warnOnLegacyProviderEnvVars(logger: Pick<Console, "warn"> = console) {
  if (warnedLegacyProviderEnvVars) {
    return;
  }

  const legacyVars = findLegacyProviderEnvVars();
  if (legacyVars.length === 0) {
    return;
  }

  warnedLegacyProviderEnvVars = true;
  logger.warn(
    `Ignoring legacy provider env vars: ${legacyVars.join(", ")}. Move provider settings into ${CONFIG_FILENAME}.`
  );
}
