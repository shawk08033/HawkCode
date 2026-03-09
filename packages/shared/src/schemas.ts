import { z } from "zod";

export const setupConfigSchema = z.object({
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
  workspaceName: z.string().min(2),
  dbProvider: z.enum(["postgresql", "sqlite"]),
  databaseUrl: z.string().min(1),
  redisUrl: z.string().optional(),
  githubAppId: z.string().optional(),
  githubAppKeyPath: z.string().optional(),
  tlsCertPath: z.string().optional(),
  tlsKeyPath: z.string().optional()
});

export type SetupConfig = z.infer<typeof setupConfigSchema>;
