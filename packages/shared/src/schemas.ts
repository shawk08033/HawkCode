import { z } from "zod";

export const setupConfigSchema = z.object({
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
  workspaceName: z.string().min(2),
  dbProvider: z.enum(["postgresql", "sqlite"]),
  databaseUrl: z.string().min(1),
  redisUrl: z.string().optional(),
  githubClientId: z.string().optional(),
  githubAppId: z.string().optional(),
  githubAppKeyPath: z.string().optional(),
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

export type SetupConfig = z.infer<typeof setupConfigSchema>;

export const agentProviderSchema = z.enum(["codex", "openrouter"]);

export const agentChatRoleSchema = z.enum(["system", "user", "assistant"]);

export const agentChatMessageSchema = z.object({
  role: agentChatRoleSchema,
  content: z.string().min(1)
});

export const agentProviderInfoSchema = z.object({
  name: agentProviderSchema,
  label: z.string().min(1),
  defaultModel: z.string().min(1)
});

export const agentReplyRequestSchema = z.object({
  provider: agentProviderSchema,
  model: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  message: z.string().min(1),
  systemPrompt: z.string().min(1).optional()
});

export const agentCommitReplyRequestSchema = agentReplyRequestSchema.extend({
  assistantContent: z.string().min(1)
});

export const agentReplyResponseSchema = z.object({
  sessionId: z.string().min(1),
  agentRunId: z.string().min(1),
  provider: agentProviderSchema,
  model: z.string().min(1),
  message: agentChatMessageSchema.extend({
    id: z.string().min(1),
    createdAt: z.string().datetime()
  })
});

export type AgentProvider = z.infer<typeof agentProviderSchema>;
export type AgentChatRole = z.infer<typeof agentChatRoleSchema>;
export type AgentChatMessage = z.infer<typeof agentChatMessageSchema>;
export type AgentProviderInfo = z.infer<typeof agentProviderInfoSchema>;
export type AgentReplyRequest = z.infer<typeof agentReplyRequestSchema>;
export type AgentCommitReplyRequest = z.infer<typeof agentCommitReplyRequestSchema>;
export type AgentReplyResponse = z.infer<typeof agentReplyResponseSchema>;
