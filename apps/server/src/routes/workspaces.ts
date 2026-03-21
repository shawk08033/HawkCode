import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getSessionUser } from "../lib/auth-session.js";
import { fetchGitHubRepo, isGitHubAuthConfigured } from "../lib/github.js";
import { getLocalGitSnapshot, normalizeGitRepoUrl } from "../lib/git.js";

const createSessionBodySchema = z.object({
  workspaceId: z.string().min(1).optional(),
  title: z.string().min(1).max(120).optional()
});

const connectGithubRepoBodySchema = z.object({
  repoUrl: z.string().min(1).max(300),
  projectName: z.string().min(1).max(80).optional()
});

function normalizeOptional(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseGithubRepoUrl(raw: string) {
  const trimmed = raw.trim();

  const sshMatch = trimmed.match(
    /^(?:ssh:\/\/)?git@github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?\/?$/i
  );
  if (sshMatch?.groups?.owner && sshMatch.groups.repo) {
    return {
      owner: sshMatch.groups.owner,
      repo: sshMatch.groups.repo,
      canonicalUrl: `https://github.com/${sshMatch.groups.owner}/${sshMatch.groups.repo}`
    };
  }

  try {
    const url = new URL(trimmed);
    if (url.hostname !== "github.com") {
      return null;
    }

    const parts = url.pathname
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.git$/i, "")
      .split("/");
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      return null;
    }

    return {
      owner: parts[0],
      repo: parts[1],
      canonicalUrl: `https://github.com/${parts[0]}/${parts[1]}`
    };
  } catch {
    return null;
  }
}

function buildGitPanelRepoRecord(
  repo: {
    id: string;
    provider: string;
    repoUrl: string;
    createdAt: Date;
    project: {
      id: string;
      name: string;
      githubInstallId: string | null;
    };
  },
  localRepo: Awaited<ReturnType<typeof getLocalGitSnapshot>>
) {
  const gitHubRecord = buildGithubRepoRecord(repo);
  const localMatch =
    localRepo && normalizeGitRepoUrl(repo.repoUrl) === normalizeGitRepoUrl(localRepo.originUrl)
      ? {
          path: localRepo.path,
          branch: localRepo.branch,
          clean: localRepo.clean,
          changedFiles: localRepo.changedFiles,
          stagedFiles: localRepo.stagedFiles,
          modifiedFiles: localRepo.modifiedFiles,
          deletedFiles: localRepo.deletedFiles,
          untrackedFiles: localRepo.untrackedFiles,
          ahead: localRepo.ahead,
          behind: localRepo.behind,
          lastCommit: localRepo.lastCommit
        }
      : null;

  return {
    ...gitHubRecord,
    local: localMatch
  };
}

function buildGithubRepoRecord(repo: {
  id: string;
  provider: string;
  repoUrl: string;
  createdAt: Date;
  project: {
    id: string;
    name: string;
    githubInstallId: string | null;
  };
}) {
  const parsed = parseGithubRepoUrl(repo.repoUrl);
  return {
    id: repo.id,
    provider: repo.provider,
    repoUrl: repo.repoUrl,
    repoName: parsed ? `${parsed.owner}/${parsed.repo}` : repo.repoUrl,
    projectId: repo.project.id,
    projectName: repo.project.name,
    githubInstallId: repo.project.githubInstallId,
    connectedAt: repo.createdAt.toISOString()
  };
}

function buildGitHubUserRecord(account?: {
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  scope: string | null;
  createdAt: Date;
} | null) {
  if (!account) {
    return null;
  }

  return {
    login: account.login,
    name: account.name,
    email: account.email,
    avatarUrl: account.avatarUrl,
    scope: account.scope,
    connectedAt: account.createdAt.toISOString()
  };
}

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

  server.get("/workspaces/:workspaceId/github", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    const membership = user.memberships.find(
      (candidate: (typeof user.memberships)[number]) => candidate.workspaceId === workspaceId
    );
    if (!membership) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const repos = await prisma.gitRepo.findMany({
      where: {
        provider: "github",
        project: {
          workspaceId
        }
      },
      orderBy: {
        createdAt: "asc"
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            githubInstallId: true
          }
        }
      }
    });

    return reply.send({
      github: {
        authConfigured: isGitHubAuthConfigured(),
        connected: Boolean(user.githubAccount),
        user: buildGitHubUserRecord(user.githubAccount),
        canManage: membership.role === "owner" || membership.role === "maintainer",
        repos: repos.map(buildGithubRepoRecord)
      }
    });
  });

  server.get("/workspaces/:workspaceId/git", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    const membership = user.memberships.find(
      (candidate: (typeof user.memberships)[number]) => candidate.workspaceId === workspaceId
    );
    if (!membership) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const repos = await prisma.gitRepo.findMany({
      where: {
        project: {
          workspaceId
        }
      },
      orderBy: {
        createdAt: "asc"
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            githubInstallId: true
          }
        }
      }
    });

    const localRepo = await getLocalGitSnapshot();

    return reply.send({
      git: {
        detected: Boolean(localRepo),
        localRepoUrl: localRepo?.originUrl ?? null,
        localPath: localRepo?.path ?? null,
        repos: repos.map((repo) => buildGitPanelRepoRecord(repo, localRepo))
      }
    });
  });

  server.post("/workspaces/:workspaceId/github/connect", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    const membership = user.memberships.find(
      (candidate: (typeof user.memberships)[number]) => candidate.workspaceId === workspaceId
    );
    if (!membership) {
      return reply.code(403).send({ error: "forbidden" });
    }
    if (membership.role !== "owner" && membership.role !== "maintainer") {
      return reply.code(403).send({ error: "forbidden" });
    }

    if (!user.githubAccount?.accessToken) {
      return reply.code(400).send({
        error: "github_not_connected",
        message: "Connect your GitHub account first."
      });
    }

    const parsed = connectGithubRepoBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsed.error.flatten()
      });
    }

    const parsedRepo = parseGithubRepoUrl(parsed.data.repoUrl);
    if (!parsedRepo) {
      return reply.code(400).send({
        error: "invalid_github_repo",
        message: "Use a GitHub repository URL or SSH remote."
      });
    }

    const repoUrl = parsedRepo.canonicalUrl;
    let repoDetails: Awaited<ReturnType<typeof fetchGitHubRepo>>;
    try {
      repoDetails = await fetchGitHubRepo(
        user.githubAccount.accessToken,
        parsedRepo.owner,
        parsedRepo.repo
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "github_repo_not_found";
      if (message === "github_token_invalid") {
        await prisma.gitHubAccount.deleteMany({
          where: {
            userId: user.id
          }
        });
        return reply.code(401).send({
          error: "github_reauth_required",
          message: "Your GitHub session expired. Reconnect your GitHub account."
        });
      }

      return reply.code(404).send({
        error: "github_repo_not_found",
        message: "Could not access that GitHub repository with your account."
      });
    }
    const projectName = normalizeOptional(parsed.data.projectName) ?? repoDetails.name;

    const repo = await prisma.$transaction(async (tx) => {
      const existingRepo = await tx.gitRepo.findFirst({
        where: {
          provider: "github",
          repoUrl,
          project: {
            workspaceId
          }
        },
        include: {
          project: {
            select: {
              id: true,
              name: true,
              githubInstallId: true
            }
          }
        }
      });

      if (existingRepo) {
        const updatedProject = await tx.project.update({
          where: {
            id: existingRepo.project.id
          },
          data: {
            name: projectName,
            repoUrl
          },
          select: {
            id: true,
            name: true,
            githubInstallId: true
          }
        });

        return {
          ...existingRepo,
          project: updatedProject
        };
      }

      const project = await tx.project.create({
        data: {
          workspaceId,
          name: projectName,
          repoUrl
        },
        select: {
          id: true,
          name: true,
          githubInstallId: true
        }
      });

      const gitRepo = await tx.gitRepo.create({
        data: {
          projectId: project.id,
          provider: "github",
          repoUrl
        }
      });

      return {
        ...gitRepo,
        project
      };
    });

    return reply.send({
      repo: buildGithubRepoRecord(repo)
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
