import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getSessionUser } from "../lib/auth-session.js";
import {
  fetchGitHubRepo,
  isGitHubAuthConfigured,
  listGitHubRepos
} from "../lib/github.js";
import {
  createGitWorktree,
  getGitDiffForFile,
  getGitSnapshot,
  listDirectoryEntries,
  readTextFile,
  removeGitWorktree,
  syncGitRepoToPath,
  writeTextFile
} from "../lib/git.js";
import {
  resolveManagedCheckoutPath,
  resolveSessionWorktreePath,
  resolveServerCheckoutRoot
} from "../lib/server-checkouts.js";

const createSessionBodySchema = z.object({
  workspaceId: z.string().min(1).optional(),
  title: z.string().min(1).max(120).optional()
});

const connectGithubRepoBodySchema = z.object({
  repoUrl: z.string().min(1).max(300),
  projectName: z.string().min(1).max(80).optional()
});

const assignSessionProjectBodySchema = z.object({
  projectId: z.string().min(1)
});

const createSessionWorktreeBodySchema = z.object({
  projectId: z.string().min(1),
  branchName: z.string().min(1).max(120).optional(),
  baseBranch: z.string().min(1).max(120).optional()
});

const sessionFilesQuerySchema = z.object({
  path: z.string().optional()
});

const updateSessionFileBodySchema = z.object({
  path: z.string().min(1),
  content: z.string()
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

function isWorkspaceAdmin(role: string) {
  return role === "owner";
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

function buildAvailableGitHubRepoRecord(repo: {
  name: string;
  fullName: string;
  htmlUrl: string;
  private: boolean;
  ownerLogin: string;
}) {
  return {
    name: repo.name,
    fullName: repo.fullName,
    repoUrl: repo.htmlUrl,
    private: repo.private,
    ownerLogin: repo.ownerLogin
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
    id: string;
    name: string;
  } | null;
  sessionWorktree?: {
    path: string;
    branch: string;
    createdAt: Date;
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
  const sessionWorktree = session.sessionWorktree ?? null;
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
    projectId: session.project?.id ?? null,
    projectName: session.project?.name ?? null,
    updated: formatRelativeTime(lastActivity),
    model: providerLabel,
    branch: sessionWorktree?.branch ?? session.project?.name ?? "main",
    worktree: sessionWorktree
      ? {
          path: sessionWorktree.path,
          branch: sessionWorktree.branch,
          createdAt: sessionWorktree.createdAt.toISOString()
        }
      : null,
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

async function syncProjectRepo(options: {
  workspaceId: string;
  workspaceName: string;
  projectId: string;
  projectName: string;
  repoUrl: string;
  githubToken?: string;
}) {
  const repoPath = resolveManagedCheckoutPath({
    workspaceId: options.workspaceId,
    workspaceName: options.workspaceName,
    projectId: options.projectId,
    projectName: options.projectName
  });

  const snapshot = await syncGitRepoToPath({
    repoUrl: options.repoUrl,
    repoPath,
    githubToken: options.githubToken
  });

  await prisma.$transaction(async (tx) => {
    await tx.worktree.deleteMany({
      where: {
        projectId: options.projectId,
        sessionId: null
      }
    });

    await tx.worktree.create({
      data: {
        projectId: options.projectId,
        path: snapshot.path,
        branch: snapshot.branch
      }
    });
  });

  return snapshot;
}

async function buildManagedGitRepoRecord(repo: {
  id: string;
  provider: string;
  repoUrl: string;
  createdAt: Date;
  project: {
    id: string;
    name: string;
    githubInstallId: string | null;
    worktrees: Array<{
      path: string;
      branch: string;
      createdAt: Date;
    }>;
  };
}) {
  const worktree = repo.project.worktrees[0] ?? null;
  const baseRecord = buildGithubRepoRecord(repo);

  if (!worktree) {
    return {
      ...baseRecord,
      serverSync: {
        status: "missing" as const,
        path: null,
        branch: null,
        lastSyncedAt: null,
        clean: null,
        changedFiles: null,
        stagedFiles: null,
        modifiedFiles: null,
        deletedFiles: null,
        untrackedFiles: null,
        ahead: null,
        behind: null,
        lastCommit: null,
        error: null
      }
    };
  }

  try {
    const snapshot = await getGitSnapshot(worktree.path);
    return {
      ...baseRecord,
      serverSync: {
        status: "ready" as const,
        path: snapshot.path,
        branch: snapshot.branch,
        lastSyncedAt: worktree.createdAt.toISOString(),
        clean: snapshot.clean,
        changedFiles: snapshot.changedFiles,
        stagedFiles: snapshot.stagedFiles,
        modifiedFiles: snapshot.modifiedFiles,
        deletedFiles: snapshot.deletedFiles,
        untrackedFiles: snapshot.untrackedFiles,
        ahead: snapshot.ahead,
        behind: snapshot.behind,
        lastCommit: snapshot.lastCommit,
        error: null
      }
    };
  } catch (error) {
    return {
      ...baseRecord,
      serverSync: {
        status: "error" as const,
        path: worktree.path,
        branch: worktree.branch,
        lastSyncedAt: worktree.createdAt.toISOString(),
        clean: null,
        changedFiles: null,
        stagedFiles: null,
        modifiedFiles: null,
        deletedFiles: null,
        untrackedFiles: null,
        ahead: null,
        behind: null,
        lastCommit: null,
        error: error instanceof Error ? error.message : "server_checkout_unavailable"
      }
    };
  }
}

async function getAuthorizedSession(options: {
  sessionId: string;
  memberships: Array<{ workspaceId: string }>;
}) {
  const session = await prisma.session.findUnique({
    where: {
      id: options.sessionId
    },
    include: {
      workspace: {
        select: {
          id: true,
          name: true
        }
      },
      project: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });

  if (!session) {
    throw new Error("session_not_found");
  }

  const allowedWorkspaceIds = new Set(options.memberships.map((membership) => membership.workspaceId));
  if (!allowedWorkspaceIds.has(session.workspaceId)) {
    throw new Error("forbidden");
  }

  const sessionWorktree = await prisma.worktree.findFirst({
    where: {
      sessionId: session.id
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return {
    ...session,
    sessionWorktree
  };
}

async function getAuthorizedProject(options: {
  workspaceId: string;
  projectId: string;
  memberships: Array<{ workspaceId: string }>;
}) {
  const allowedWorkspaceIds = new Set(options.memberships.map((membership) => membership.workspaceId));
  if (!allowedWorkspaceIds.has(options.workspaceId)) {
    throw new Error("forbidden");
  }

  const project = await prisma.project.findFirst({
    where: {
      id: options.projectId,
      workspaceId: options.workspaceId
    },
    include: {
      workspace: {
        select: {
          id: true,
          name: true
        }
      },
      gitRepos: {
        orderBy: {
          createdAt: "asc"
        }
      },
      worktrees: {
        where: {
          sessionId: null
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 1
      }
    }
  });

  if (!project) {
    throw new Error("project_not_found");
  }

  return project;
}

function buildSessionWorktreeRecord(input: {
  session: {
    id: string;
    title: string | null;
    projectId: string | null;
    project: {
      id: string;
      name: string;
    } | null;
    sessionWorktree: {
      id: string;
      path: string;
      branch: string;
      createdAt: Date;
    } | null;
  };
  filePath?: string;
  entries?: Array<{
    name: string;
    path: string;
    type: string;
    size: number | null;
  }>;
  file?: {
    path: string;
    content: string;
    truncated: boolean;
    size: number;
    diff?: {
      path: string;
      content: string;
      hasChanges: boolean;
    } | null;
  } | null;
}) {
  const worktree = input.session.sessionWorktree;

  return {
    sessionId: input.session.id,
    projectId: input.session.projectId,
    projectName: input.session.project?.name ?? null,
    worktree: worktree
      ? {
          id: worktree.id,
          path: worktree.path,
          branch: worktree.branch,
          createdAt: worktree.createdAt.toISOString()
        }
      : null,
    currentPath: input.filePath ?? "",
    entries: input.entries ?? [],
    file: input.file ?? null
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
                id: true,
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

    const sessionIds = workspaces.flatMap((workspace) =>
      workspace.sessions.map((session) => session.id)
    );
    const sessionWorktrees = sessionIds.length
      ? await prisma.worktree.findMany({
          where: {
            sessionId: {
              in: sessionIds
            }
          },
          orderBy: {
            createdAt: "desc"
          }
        })
      : [];
    const sessionWorktreeMap = new Map<string, (typeof sessionWorktrees)[number]>();
    for (const worktree of sessionWorktrees) {
      if (worktree.sessionId && !sessionWorktreeMap.has(worktree.sessionId)) {
        sessionWorktreeMap.set(worktree.sessionId, worktree);
      }
    }

    return reply.send({
      workspaces: workspaces.map((workspace: (typeof workspaces)[number]) => ({
        id: workspace.id,
        name: workspace.name,
        sessions: workspace.sessions.map((session) =>
          buildSessionRecord({
            ...session,
            sessionWorktree: sessionWorktreeMap.get(session.id) ?? null
          })
        ),
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

    let availableRepos: Array<ReturnType<typeof buildAvailableGitHubRepoRecord>> = [];
    if (user.githubAccount?.accessToken && isWorkspaceAdmin(membership.role)) {
      try {
        const catalog = await listGitHubRepos(user.githubAccount.accessToken);
        availableRepos = catalog.map(buildAvailableGitHubRepoRecord);
      } catch (error) {
        if (error instanceof Error && error.message === "github_token_invalid") {
          await prisma.gitHubAccount.deleteMany({
            where: {
              userId: user.id
            }
          });
        }
      }
    }

    return reply.send({
      github: {
        authConfigured: isGitHubAuthConfigured(),
        connected: Boolean(user.githubAccount),
        user: buildGitHubUserRecord(user.githubAccount),
        canManage: isWorkspaceAdmin(membership.role),
        repos: repos.map(buildGithubRepoRecord),
        availableRepos
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
            githubInstallId: true,
            worktrees: {
              where: {
                sessionId: null
              },
              orderBy: {
                createdAt: "desc"
              },
              take: 1
            }
          }
        }
      }
    });

    return reply.send({
      git: {
        checkoutRoot: resolveServerCheckoutRoot(),
        canManage: isWorkspaceAdmin(membership.role),
        repos: await Promise.all(repos.map((repo) => buildManagedGitRepoRecord(repo)))
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
    if (!isWorkspaceAdmin(membership.role)) {
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
              githubInstallId: true,
              workspace: {
                select: {
                  id: true,
                  name: true
                }
              }
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
            githubInstallId: true,
            workspace: {
              select: {
                id: true,
                name: true
              }
            }
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
          githubInstallId: true,
          workspace: {
            select: {
              id: true,
              name: true
            }
          }
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

    let syncError: string | null = null;
    try {
      await syncProjectRepo({
        workspaceId: repo.project.workspace.id,
        workspaceName: repo.project.workspace.name,
        projectId: repo.project.id,
        projectName: repo.project.name,
        repoUrl: repo.repoUrl,
        githubToken: user.githubAccount.accessToken
      });
    } catch (error) {
      syncError = error instanceof Error ? error.message : "server_sync_failed";
    }

    return reply.send({
      repo: buildGithubRepoRecord(repo),
      syncError
    });
  });

  server.post("/workspaces/:workspaceId/projects/:projectId/sync", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const { workspaceId, projectId } = request.params as { workspaceId: string; projectId: string };
    const membership = user.memberships.find(
      (candidate: (typeof user.memberships)[number]) => candidate.workspaceId === workspaceId
    );
    if (!membership) {
      return reply.code(403).send({ error: "forbidden" });
    }
    if (!isWorkspaceAdmin(membership.role)) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        workspaceId
      },
      include: {
        workspace: {
          select: {
            id: true,
            name: true
          }
        },
        gitRepos: {
          orderBy: {
            createdAt: "asc"
          }
        }
      }
    });

    if (!project) {
      return reply.code(404).send({
        error: "project_not_found"
      });
    }

    const repo = project.gitRepos[0];
    if (!repo) {
      return reply.code(400).send({
        error: "repo_not_connected",
        message: "Connect a repository before syncing server files."
      });
    }

    try {
      await syncProjectRepo({
        workspaceId: project.workspace.id,
        workspaceName: project.workspace.name,
        projectId: project.id,
        projectName: project.name,
        repoUrl: repo.repoUrl,
        githubToken: repo.provider === "github" ? user.githubAccount?.accessToken : undefined
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "server_sync_failed";
      return reply.code(500).send({
        error: "server_sync_failed",
        message
      });
    }

    const refreshedRepo = await prisma.gitRepo.findUnique({
      where: {
        id: repo.id
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            githubInstallId: true,
            worktrees: {
              where: {
                sessionId: null
              },
              orderBy: {
                createdAt: "desc"
              },
              take: 1
            }
          }
        }
      }
    });

    if (!refreshedRepo) {
      return reply.code(404).send({
        error: "repo_not_found"
      });
    }

    return reply.send({
      repo: await buildManagedGitRepoRecord(refreshedRepo)
    });
  });

  server.post("/sessions/:sessionId/project", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const sessionId = (request.params as { sessionId: string }).sessionId;
    const parsed = assignSessionProjectBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsed.error.flatten()
      });
    }

    try {
      const session = await getAuthorizedSession({
        sessionId,
        memberships: user.memberships
      });
      const project = await getAuthorizedProject({
        workspaceId: session.workspaceId,
        projectId: parsed.data.projectId,
        memberships: user.memberships
      });

      const updated = await prisma.session.update({
        where: {
          id: session.id
        },
        data: {
          projectId: project.id
        },
        include: {
          project: {
            select: {
              id: true,
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
        session: buildSessionRecord({
          ...updated,
          sessionWorktree: session.sessionWorktree
        })
      });
    } catch (error) {
      if (error instanceof Error && error.message === "session_not_found") {
        return reply.code(404).send({ error: "session_not_found" });
      }
      if (error instanceof Error && error.message === "project_not_found") {
        return reply.code(404).send({ error: "project_not_found" });
      }
      if (error instanceof Error && error.message === "forbidden") {
        return reply.code(403).send({ error: "forbidden" });
      }

      request.log.error(error);
      return reply.code(500).send({
        error: "session_project_update_failed"
      });
    }
  });

  server.post("/sessions/:sessionId/worktree", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const sessionId = (request.params as { sessionId: string }).sessionId;
    const parsed = createSessionWorktreeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsed.error.flatten()
      });
    }

    try {
      const session = await getAuthorizedSession({
        sessionId,
        memberships: user.memberships
      });
      const project = await getAuthorizedProject({
        workspaceId: session.workspaceId,
        projectId: parsed.data.projectId,
        memberships: user.memberships
      });
      const baseWorktree = project.worktrees[0];
      if (!baseWorktree) {
        return reply.code(400).send({
          error: "project_not_synced",
          message: "Sync the project to the server before creating a session worktree."
        });
      }

      const existingSessionWorktree = session.sessionWorktree;
      if (existingSessionWorktree) {
        await removeGitWorktree({
          repoPath: baseWorktree.path,
          worktreePath: existingSessionWorktree.path
        }).catch(() => undefined);
        await prisma.worktree.deleteMany({
          where: {
            id: existingSessionWorktree.id
          }
        });
      }

      const branchBase = (parsed.data.branchName ?? session.title ?? "session")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "session";
      const branchName = `${branchBase}-${session.id.slice(-6)}`;
      const worktreePath = resolveSessionWorktreePath({
        workspaceId: session.workspace.id,
        workspaceName: session.workspace.name,
        sessionId: session.id,
        sessionTitle: session.title ?? project.name
      });

      const snapshot = await createGitWorktree({
        repoPath: baseWorktree.path,
        worktreePath,
        branch: branchName,
        baseRef: parsed.data.baseBranch ?? baseWorktree.branch
      });

      const created = await prisma.$transaction(async (tx) => {
        await tx.session.update({
          where: {
            id: session.id
          },
          data: {
            projectId: project.id
          }
        });

        return tx.worktree.create({
          data: {
            projectId: project.id,
            sessionId: session.id,
            path: snapshot.path,
            branch: snapshot.branch
          }
        });
      });

      return reply.send({
        worktree: {
          id: created.id,
          path: created.path,
          branch: created.branch,
          createdAt: created.createdAt.toISOString()
        }
      });
    } catch (error) {
      if (error instanceof Error && error.message === "session_not_found") {
        return reply.code(404).send({ error: "session_not_found" });
      }
      if (error instanceof Error && error.message === "project_not_found") {
        return reply.code(404).send({ error: "project_not_found" });
      }
      if (error instanceof Error && error.message === "forbidden") {
        return reply.code(403).send({ error: "forbidden" });
      }

      request.log.error(error);
      return reply.code(500).send({
        error: "session_worktree_create_failed",
        message: error instanceof Error ? error.message : "unknown_error"
      });
    }
  });

  server.get("/sessions/:sessionId/files", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const sessionId = (request.params as { sessionId: string }).sessionId;
    const parsedQuery = sessionFilesQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsedQuery.error.flatten()
      });
    }

    try {
      const session = await getAuthorizedSession({
        sessionId,
        memberships: user.memberships
      });
      const worktree = session.sessionWorktree;
      if (!worktree) {
        return reply.send({
          context: buildSessionWorktreeRecord({
            session
          })
        });
      }

      const filePath = normalizeOptional(parsedQuery.data.path) ?? "";
      const entries = await listDirectoryEntries(worktree.path, filePath);
      return reply.send({
        context: buildSessionWorktreeRecord({
          session,
          filePath,
          entries
        })
      });
    } catch (error) {
      if (error instanceof Error && error.message === "session_not_found") {
        return reply.code(404).send({ error: "session_not_found" });
      }
      if (error instanceof Error && error.message === "forbidden") {
        return reply.code(403).send({ error: "forbidden" });
      }
      if (error instanceof Error && error.message === "path_outside_root") {
        return reply.code(400).send({ error: "invalid_path" });
      }
      if (error instanceof Error && error.message === "not_a_directory") {
        return reply.code(400).send({ error: "not_a_directory" });
      }

      request.log.error(error);
      return reply.code(500).send({
        error: "session_files_failed"
      });
    }
  });

  server.get("/sessions/:sessionId/file", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const sessionId = (request.params as { sessionId: string }).sessionId;
    const parsedQuery = sessionFilesQuerySchema.safeParse(request.query);
    if (!parsedQuery.success || !parsedQuery.data.path) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    try {
      const session = await getAuthorizedSession({
        sessionId,
        memberships: user.memberships
      });
      const worktree = session.sessionWorktree;
      if (!worktree) {
        return reply.code(400).send({
          error: "worktree_not_found"
        });
      }

      const [file, diff] = await Promise.all([
        readTextFile(worktree.path, parsedQuery.data.path),
        getGitDiffForFile(worktree.path, parsedQuery.data.path)
      ]);
      return reply.send({
        context: buildSessionWorktreeRecord({
          session,
          filePath: parsedQuery.data.path,
          file: {
            ...file,
            diff
          }
        })
      });
    } catch (error) {
      if (error instanceof Error && error.message === "session_not_found") {
        return reply.code(404).send({ error: "session_not_found" });
      }
      if (error instanceof Error && error.message === "forbidden") {
        return reply.code(403).send({ error: "forbidden" });
      }
      if (error instanceof Error && error.message === "path_outside_root") {
        return reply.code(400).send({ error: "invalid_path" });
      }
      if (error instanceof Error && error.message === "not_a_file") {
        return reply.code(400).send({ error: "not_a_file" });
      }

      request.log.error(error);
      return reply.code(500).send({
        error: "session_file_read_failed"
      });
    }
  });

  server.post("/sessions/:sessionId/file", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const sessionId = (request.params as { sessionId: string }).sessionId;
    const parsedBody = updateSessionFileBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsedBody.error.flatten()
      });
    }

    try {
      const session = await getAuthorizedSession({
        sessionId,
        memberships: user.memberships
      });
      const worktree = session.sessionWorktree;
      if (!worktree) {
        return reply.code(400).send({
          error: "worktree_not_found"
        });
      }

      await writeTextFile(worktree.path, parsedBody.data.path, parsedBody.data.content);
      const [file, diff] = await Promise.all([
        readTextFile(worktree.path, parsedBody.data.path),
        getGitDiffForFile(worktree.path, parsedBody.data.path)
      ]);

      return reply.send({
        context: buildSessionWorktreeRecord({
          session,
          filePath: parsedBody.data.path,
          file: {
            ...file,
            diff
          }
        })
      });
    } catch (error) {
      if (error instanceof Error && error.message === "session_not_found") {
        return reply.code(404).send({ error: "session_not_found" });
      }
      if (error instanceof Error && error.message === "forbidden") {
        return reply.code(403).send({ error: "forbidden" });
      }
      if (error instanceof Error && error.message === "path_outside_root") {
        return reply.code(400).send({ error: "invalid_path" });
      }
      if (error instanceof Error && error.message === "not_a_file") {
        return reply.code(400).send({ error: "not_a_file" });
      }

      request.log.error(error);
      return reply.code(500).send({
        error: "session_file_write_failed"
      });
    }
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
            id: true,
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
      session: buildSessionRecord({
        ...session,
        sessionWorktree: null
      })
    });
  });
}
