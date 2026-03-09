import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getSessionUser } from "../lib/auth-session.js";

const createSessionBodySchema = z.object({
  workspaceId: z.string().min(1).optional(),
  title: z.string().min(1).max(120).optional()
});

function formatRelativeTime(value: Date) {
  const diffMs = Date.now() - value.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function parseToolCallInput(raw?: string | null) {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as {
      provider?: string;
      model?: string;
    };
    return parsed;
  } catch {
    return null;
  }
}

function buildSessionRecord(session: {
  id: string;
  title: string | null;
  createdAt: Date;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt: Date;
  }>;
  project: {
    name: string;
  } | null;
  agentRuns: Array<{
    status: string;
    toolCalls: Array<{
      input: string;
    }>;
  }>;
}) {
  const lastMessage = session.messages[session.messages.length - 1];
  const lastActivity = lastMessage?.createdAt ?? session.createdAt;
  const latestRun = session.agentRuns[0];
  const latestToolCall = latestRun?.toolCalls[0];
  const providerInfo = parseToolCallInput(latestToolCall?.input);
  const providerLabel =
    providerInfo?.provider === "codex"
      ? "Codex"
      : providerInfo?.provider === "openrouter"
        ? "OpenRouter"
        : "Agent";

  return {
    id: session.id,
    title: session.title ?? "New session",
    updated: formatRelativeTime(lastActivity),
    model: providerLabel,
    branch: session.project?.name ?? "main",
    status:
      latestRun?.status === "running"
        ? "Live"
        : latestRun?.status === "failed"
          ? "Failed"
          : "Idle",
    contextCount: 0,
    messages: session.messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        timestamp: message.createdAt.toISOString()
      }))
  };
}

export async function registerWorkspaceRoutes(server: FastifyInstance) {
  server.get("/workspaces/tree", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const workspaces = await prisma.workspace.findMany({
      where: {
        memberships: {
          some: {
            userId: user.id
          }
        }
      },
      orderBy: {
        createdAt: "asc"
      },
      include: {
        sessions: {
          orderBy: {
            createdAt: "desc"
          },
          include: {
            project: {
              select: {
                name: true
              }
            },
            messages: {
              orderBy: {
                createdAt: "asc"
              }
            },
            agentRuns: {
              orderBy: {
                createdAt: "desc"
              },
              take: 1,
              include: {
                toolCalls: true
              }
            }
          }
        },
        projects: {
          orderBy: {
            createdAt: "asc"
          },
          include: {
            schedules: {
              orderBy: {
                createdAt: "asc"
              }
            }
          }
        }
      }
    });

    return reply.send({
      workspaces: workspaces.map((workspace: (typeof workspaces)[number]) => ({
        id: workspace.id,
        name: workspace.name,
        sessions: workspace.sessions.map(buildSessionRecord),
        schedules: workspace.projects.flatMap((project: (typeof workspace.projects)[number]) =>
          project.schedules.map((schedule: (typeof project.schedules)[number]) => ({
            id: schedule.id,
            title: schedule.name
          }))
        )
      }))
    });
  });

  server.post("/sessions", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const parsed = createSessionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsed.error.flatten()
      });
    }

    const workspaceIds = new Set(
      user.memberships.map((membership: (typeof user.memberships)[number]) => membership.workspaceId)
    );
    const fallbackWorkspaceId = user.memberships[0]?.workspaceId;
    if (!fallbackWorkspaceId) {
      return reply.code(403).send({ error: "no_workspace" });
    }

    const workspaceId = parsed.data.workspaceId ?? fallbackWorkspaceId;
    if (!workspaceIds.has(workspaceId)) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const session = await prisma.session.create({
      data: {
        ownerId: user.id,
        workspaceId,
        title: parsed.data.title ?? "New session"
      },
      include: {
        project: {
          select: {
            name: true
          }
        },
        messages: {
          orderBy: {
            createdAt: "asc"
          }
        },
        agentRuns: {
          orderBy: {
            createdAt: "desc"
          },
          take: 1,
          include: {
            toolCalls: true
          }
        }
      }
    });

    return reply.send({
      session: buildSessionRecord(session)
    });
  });
}
