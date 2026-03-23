import { z } from "zod";

export const setupConfigSchema = z.object({
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
  workspaceName: z.string().min(2),
  dbProvider: z.enum(["postgresql", "sqlite"]),
  databaseUrl: z.string().min(1),
  serverCheckoutRoot: z.string().optional(),
  redisUrl: z.string().optional(),
  githubClientId: z.string().optional(),
  githubAppId: z.string().optional(),
  githubAppKeyPath: z.string().optional(),
  openrouterApiKey: z.string().optional(),
  openrouterBaseUrl: z.string().optional(),
  openrouterModel: z.string().optional(),
  openrouterSiteUrl: z.string().optional(),
  openrouterAppName: z.string().optional(),
  tlsCertPath: z.string().optional(),
  tlsKeyPath: z.string().optional()
});

export type SetupConfig = z.infer<typeof setupConfigSchema>;

export const agentProviderSchema = z.enum(["codex", "cursor", "gemini", "openrouter"]);

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

export const agentToolCallSchema = z.object({
  name: z.string().min(1),
  input: z.string().min(1).optional(),
  output: z.string().min(1).optional(),
  durationMs: z.number().int().nonnegative().optional()
});

export const agentCommandEventSchema = z.object({
  command: z.string().min(1),
  status: z.enum(["running", "completed", "failed"]),
  output: z.string(),
  exitCode: z.number().int().nullable().optional()
});

export const agentCommitReplyRequestSchema = agentReplyRequestSchema.extend({
  assistantContent: z.string().min(1),
  toolCalls: z.array(agentToolCallSchema).optional(),
  commandEvents: z.array(agentCommandEventSchema).optional()
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
export type AgentToolCall = z.infer<typeof agentToolCallSchema>;
export type AgentCommandEvent = z.infer<typeof agentCommandEventSchema>;
export type AgentReplyRequest = z.infer<typeof agentReplyRequestSchema>;
export type AgentCommitReplyRequest = z.infer<typeof agentCommitReplyRequestSchema>;
export type AgentReplyResponse = z.infer<typeof agentReplyResponseSchema>;
