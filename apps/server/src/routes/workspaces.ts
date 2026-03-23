import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getSessionUser } from "../lib/auth-session.js";
import {
  createGitHubPullRequest,
  fetchGitHubRepo,
  isGitHubAuthConfigured,
  listGitHubRepos
} from "../lib/github.js";
import {
  commitGitChanges,
  createGitWorktree,
  getGitDiffForFile,
  getGitChangedFiles,
  getGitSnapshot,
  listDirectoryEntries,
  pushGitBranch,
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

const createWorkspaceBodySchema = z.object({
  name: z.string().min(1).max(120)
});

const updateSessionSharingBodySchema = z.object({
  sharedWithWorkspace: z.boolean()
});

const updateSessionBodySchema = z.object({
  title: z.string().min(1).max(120)
});

const sessionCheckoutBodySchema = z.object({
  extendMinutes: z.number().int().min(1).max(120).optional()
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

const sessionCommitBodySchema = z.object({
  message: z.string().min(1).max(240)
});

const sessionPullRequestBodySchema = z.object({
  title: z.string().min(1).max(240).optional(),
  body: z.string().max(10000).optional(),
  baseBranch: z.string().min(1).max(120).optional()
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

function formatProviderLabel(provider?: string) {
  return provider === "codex"
    ? "Codex"
    : provider === "cursor"
      ? "Cursor CLI"
      : provider === "gemini"
        ? "Gemini CLI"
      : provider === "openrouter"
        ? "OpenRouter"
        : "Agent";
}

function formatRunLabel(provider?: string, model?: string) {
  const providerLabel = formatProviderLabel(provider);
  return model ? `${providerLabel} · ${model}` : providerLabel;
}

const DEFAULT_SESSION_CHECKOUT_MINUTES = 15;

function getCheckoutExpiry(minutes = DEFAULT_SESSION_CHECKOUT_MINUTES) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function getActiveCheckout(session: {
  checkedOutById?: string | null;
  checkoutExpiresAt?: Date | null;
}) {
  if (!session.checkedOutById || !session.checkoutExpiresAt) {
    return null;
  }
  if (session.checkoutExpiresAt <= new Date()) {
    return null;
  }
  return {
    checkedOutById: session.checkedOutById,
    checkoutExpiresAt: session.checkoutExpiresAt
  };
}

function hasExternalSessionContributors(session: {
  ownerId: string;
  messages: Array<{
    authorId: string;
  }>;
}) {
  return session.messages.some((message) => message.authorId !== session.ownerId);
}

function displayMessageContent(content: string) {
  return content.replace(/^\[Session note\]\s*/, "").trim();
}

function buildSessionRecord(session: {
  id: string;
  title: string | null;
  ownerId: string;
  sharedWithWorkspace: boolean;
  checkedOutById?: string | null;
  checkoutExpiresAt?: Date | null;
  createdAt: Date;
  messages: Array<{
    id: string;
    authorId: string;
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
}, currentUserId: string, checkoutHolderEmail?: string | null) {
  const lastMessage = session.messages[session.messages.length - 1];
  const lastActivity = lastMessage?.createdAt ?? session.createdAt;
  const latestRun = session.agentRuns[0];
  const latestToolCall = latestRun?.toolCalls.find((toolCall) => {
    return toolCall.input.includes("\"provider\"") && toolCall.input.includes("\"model\"");
  });
  const sessionWorktree = session.sessionWorktree ?? null;
  const providerInfo = parseToolCallInput(latestToolCall?.input);
  const canManage = session.ownerId === currentUserId;
  const externalContributors = hasExternalSessionContributors(session);
  const activeCheckout = getActiveCheckout(session);
  const checkedOutByCurrentUser = activeCheckout?.checkedOutById === currentUserId;
  const canPrompt = !activeCheckout || checkedOutByCurrentUser;

  return {
    id: session.id,
    title: session.title ?? "New session",
    ownerId: session.ownerId,
    sharedWithWorkspace: session.sharedWithWorkspace,
    canManage,
    canDelete: canManage && (!session.sharedWithWorkspace || !externalContributors),
    canPrompt,
    checkout: activeCheckout
      ? {
          checkedOutById: activeCheckout.checkedOutById,
          checkedOutByCurrentUser,
          checkedOutByEmail: checkoutHolderEmail ?? null,
          expiresAt: activeCheckout.checkoutExpiresAt.toISOString()
        }
      : null,
    projectId: session.project?.id ?? null,
    projectName: session.project?.name ?? null,
    updated: formatRelativeTime(lastActivity),
    model: formatRunLabel(providerInfo?.provider, providerInfo?.model),
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
      .filter(
        (message) =>
          message.role === "user" || message.role === "assistant" || message.role === "system"
      )
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: displayMessageContent(message.content),
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
  userId: string;
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
  if (session.ownerId !== options.userId && !session.sharedWithWorkspace) {
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

async function getCheckoutHolderMap(sessionIds: string[]) {
  if (sessionIds.length === 0) {
    return new Map<string, string | null>();
  }

  const sessions = await prisma.session.findMany({
    where: {
      id: {
        in: sessionIds
      },
      checkedOutById: {
        not: null
      }
    },
    select: {
      id: true,
      checkedOutById: true,
      checkoutExpiresAt: true
    }
  });

  const activeHolderIds = [...new Set(
    sessions
      .filter((session) => getActiveCheckout(session)?.checkedOutById)
      .map((session) => session.checkedOutById as string)
  )];
  const users = activeHolderIds.length
    ? await prisma.user.findMany({
        where: {
          id: {
            in: activeHolderIds
          }
        },
        select: {
          id: true,
          email: true
        }
      })
    : [];
  const userMap = new Map(users.map((user) => [user.id, user.email]));
  const checkoutMap = new Map<string, string | null>();

  for (const session of sessions) {
    const activeCheckout = getActiveCheckout(session);
    if (activeCheckout) {
      checkoutMap.set(session.id, userMap.get(activeCheckout.checkedOutById) ?? null);
    }
  }

  return checkoutMap;
}

async function deleteSessionResources(sessionId: string) {
  const agentRuns = await prisma.agentRun.findMany({
    where: {
      sessionId
    },
    select: {
      id: true
    }
  });
  const agentRunIds = agentRuns.map((run) => run.id);

  await prisma.$transaction(async (tx) => {
    await tx.worktree.deleteMany({
      where: {
        sessionId
      }
    });
    await tx.sandbox.deleteMany({
      where: {
        sessionId
      }
    });
    if (agentRunIds.length > 0) {
      await tx.artifact.deleteMany({
        where: {
          agentRunId: {
            in: agentRunIds
          }
        }
      });
      await tx.toolCall.deleteMany({
        where: {
          agentRunId: {
            in: agentRunIds
          }
        }
      });
      await tx.agentRun.deleteMany({
        where: {
          id: {
            in: agentRunIds
          }
        }
      });
    }
    await tx.message.deleteMany({
      where: {
        sessionId
      }
    });
    await tx.session.delete({
      where: {
        id: sessionId
      }
    });
  });
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

async function buildSessionGitState(input: {
  session: Awaited<ReturnType<typeof getAuthorizedSession>>;
  project: Awaited<ReturnType<typeof getAuthorizedProject>>;
}) {
  const worktree = input.session.sessionWorktree;
  if (!worktree) {
    return {
      branch: null,
      baseBranch: input.project.worktrees[0]?.branch ?? null,
      repoUrl: input.project.gitRepos[0]?.repoUrl ?? null,
      clean: true,
      changedFiles: [],
      ahead: null,
      behind: null,
      lastCommit: null,
      canPush: false,
      canCreatePr: false
    };
  }

  const [snapshot, changedFiles] = await Promise.all([
    getGitSnapshot(worktree.path),
    getGitChangedFiles(worktree.path)
  ]);

  return {
    branch: snapshot.branch,
    baseBranch: input.project.worktrees[0]?.branch ?? null,
    repoUrl: input.project.gitRepos[0]?.repoUrl ?? null,
    clean: snapshot.clean,
    changedFiles: changedFiles.map((file) => ({
      path: file.path,
      staged: file.x !== " " && file.x !== "?",
      modified: file.y !== " ",
      untracked: file.x === "?" && file.y === "?"
    })),
    ahead: snapshot.ahead,
    behind: snapshot.behind,
    lastCommit: snapshot.lastCommit,
    canPush: Boolean(input.project.gitRepos[0]),
    canCreatePr: Boolean(input.project.gitRepos[0])
  };
}

export async function registerWorkspaceRoutes(server: FastifyInstance) {
  server.get("/workspaces", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const memberships = await prisma.membership.findMany({
      where: {
        userId: user.id
      },
      orderBy: [
        {
          createdAt: "asc"
        },
        {
          workspace: {
            createdAt: "asc"
          }
        }
      ],
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            createdAt: true
          }
        }
      }
    });

    return reply.send({
      workspaces: memberships.map((membership) => ({
        id: membership.workspace.id,
        name: membership.workspace.name,
        role: membership.role,
        createdAt: membership.workspace.createdAt.toISOString()
      }))
    });
  });

  server.post("/workspaces", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const parsed = createWorkspaceBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsed.error.flatten()
      });
    }

    try {
      const workspace = await prisma.$transaction(async (tx) => {
        const created = await tx.workspace.create({
          data: {
            name: parsed.data.name.trim()
          }
        });

        await tx.membership.create({
          data: {
            userId: user.id,
            workspaceId: created.id,
            role: "owner"
          }
        });

        return created;
      });

      return reply.code(201).send({
        workspace: {
          id: workspace.id,
          name: workspace.name,
          sessions: [],
          schedules: []
        }
      });
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({
        error: "workspace_create_failed"
      });
    }
  });

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
          where: {
            OR: [
              {
                ownerId: user.id
              },
              {
                sharedWithWorkspace: true
              }
            ]
          },
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
                toolCalls: {
                  where: {
                    name: "generate_reply"
                  },
                  orderBy: {
                    id: "desc"
                  },
                  take: 1
                }
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
    const checkoutHolderMap = await getCheckoutHolderMap(sessionIds);
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
          }, user.id, checkoutHolderMap.get(session.id) ?? null)
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
        userId: user.id,
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
              toolCalls: {
                where: {
                  name: "generate_reply"
                },
                orderBy: {
                  id: "desc"
                },
                take: 1
              }
            }
          }
        }
      });

      return reply.send({
        session: buildSessionRecord({
          ...updated,
          sessionWorktree: session.sessionWorktree
        }, user.id, null)
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
        userId: user.id,
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
        userId: user.id,
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

  server.get("/sessions/:sessionId/git", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const sessionId = (request.params as { sessionId: string }).sessionId;

    try {
      const session = await getAuthorizedSession({
        sessionId,
        userId: user.id,
        memberships: user.memberships
      });
      if (!session.projectId) {
        return reply.send({
          git: {
            branch: session.sessionWorktree?.branch ?? null,
            baseBranch: null,
            repoUrl: null,
            clean: true,
            changedFiles: [],
            ahead: null,
            behind: null,
            lastCommit: null,
            canPush: false,
            canCreatePr: false
          }
        });
      }

      const project = await getAuthorizedProject({
        workspaceId: session.workspaceId,
        projectId: session.projectId,
        memberships: user.memberships
      });

      return reply.send({
        git: await buildSessionGitState({
          session,
          project
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
      return reply.code(500).send({ error: "session_git_failed" });
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
        userId: user.id,
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

  server.post("/sessions/:sessionId/commit", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const sessionId = (request.params as { sessionId: string }).sessionId;
    const parsedBody = sessionCommitBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsedBody.error.flatten()
      });
    }

    try {
      const session = await getAuthorizedSession({
        sessionId,
        userId: user.id,
        memberships: user.memberships
      });
      if (!session.sessionWorktree || !session.projectId) {
        return reply.code(400).send({ error: "worktree_not_found" });
      }

      const project = await getAuthorizedProject({
        workspaceId: session.workspaceId,
        projectId: session.projectId,
        memberships: user.memberships
      });

      const snapshot = await commitGitChanges({
        repoPath: session.sessionWorktree.path,
        message: parsedBody.data.message,
        authorName: user.githubAccount?.name || user.githubAccount?.login || user.email,
        authorEmail: user.githubAccount?.email || user.email
      });

      return reply.send({
        git: await buildSessionGitState({ session, project }),
        snapshot
      });
    } catch (error) {
      if (error instanceof Error && error.message === "nothing_to_commit") {
        return reply.code(400).send({ error: "nothing_to_commit" });
      }
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
      return reply.code(500).send({ error: "session_commit_failed" });
    }
  });

  server.post("/sessions/:sessionId/push", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const sessionId = (request.params as { sessionId: string }).sessionId;

    try {
      const session = await getAuthorizedSession({
        sessionId,
        userId: user.id,
        memberships: user.memberships
      });
      if (!session.sessionWorktree || !session.projectId) {
        return reply.code(400).send({ error: "worktree_not_found" });
      }
      if (!user.githubAccount?.accessToken) {
        return reply.code(400).send({ error: "github_not_connected" });
      }

      const project = await getAuthorizedProject({
        workspaceId: session.workspaceId,
        projectId: session.projectId,
        memberships: user.memberships
      });

      const snapshot = await pushGitBranch({
        repoPath: session.sessionWorktree.path,
        branch: session.sessionWorktree.branch,
        githubToken: user.githubAccount.accessToken
      });

      return reply.send({
        git: await buildSessionGitState({ session, project }),
        snapshot
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
      return reply.code(500).send({ error: "session_push_failed" });
    }
  });

  server.post("/sessions/:sessionId/pull-request", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const sessionId = (request.params as { sessionId: string }).sessionId;
    const parsedBody = sessionPullRequestBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsedBody.error.flatten()
      });
    }

    try {
      const session = await getAuthorizedSession({
        sessionId,
        userId: user.id,
        memberships: user.memberships
      });
      if (!session.sessionWorktree || !session.projectId) {
        return reply.code(400).send({ error: "worktree_not_found" });
      }
      if (!user.githubAccount?.accessToken) {
        return reply.code(400).send({ error: "github_not_connected" });
      }

      const project = await getAuthorizedProject({
        workspaceId: session.workspaceId,
        projectId: session.projectId,
        memberships: user.memberships
      });
      const repo = project.gitRepos[0];
      if (!repo) {
        return reply.code(400).send({ error: "repo_not_connected" });
      }

      const parsedRepo = parseGithubRepoUrl(repo.repoUrl);
      if (!parsedRepo) {
        return reply.code(400).send({ error: "invalid_repo_url" });
      }

      const pullRequest = await createGitHubPullRequest({
        accessToken: user.githubAccount.accessToken,
        owner: parsedRepo.owner,
        repo: parsedRepo.repo,
        title: parsedBody.data.title ?? session.title ?? `HawkCode changes for ${project.name}`,
        body: parsedBody.data.body,
        head: session.sessionWorktree.branch,
        base: parsedBody.data.baseBranch ?? project.worktrees[0]?.branch ?? "main"
      });

      return reply.send({
        git: await buildSessionGitState({ session, project }),
        pullRequest
      });
    } catch (error) {
      if (error instanceof Error && error.message === "github_token_invalid") {
        return reply.code(401).send({ error: "github_token_invalid" });
      }
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
      return reply.code(500).send({ error: "session_pull_request_failed" });
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
        userId: user.id,
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
        sharedWithWorkspace: false,
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
            toolCalls: {
              where: {
                name: "generate_reply"
              },
              orderBy: {
                id: "desc"
              },
              take: 1
            }
          }
        }
      }
    });

    return reply.send({
      session: buildSessionRecord({
        ...session,
        sessionWorktree: null
      }, user.id, null)
    });
  });

  server.patch("/sessions/:sessionId", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const sessionId = (request.params as { sessionId: string }).sessionId;
    const parsed = updateSessionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsed.error.flatten()
      });
    }

    try {
      const session = await getAuthorizedSession({
        sessionId,
        userId: user.id,
        memberships: user.memberships
      });
      if (session.ownerId !== user.id) {
        return reply.code(403).send({ error: "forbidden" });
      }

      const updated = await prisma.session.update({
        where: {
          id: session.id
        },
        data: {
          title: parsed.data.title.trim()
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
              toolCalls: {
                where: {
                  name: "generate_reply"
                },
                orderBy: {
                  id: "desc"
                },
                take: 1
              }
            }
          }
        }
      });

      return reply.send({
        session: buildSessionRecord({
          ...updated,
          sessionWorktree: session.sessionWorktree
        }, user.id, null)
      });
    } catch (error) {
      if (error instanceof Error && error.message === "session_not_found") {
        return reply.code(404).send({ error: "session_not_found" });
      }
      if (error instanceof Error && error.message === "forbidden") {
        return reply.code(403).send({ error: "forbidden" });
      }

      request.log.error(error);
      return reply.code(500).send({
        error: "session_update_failed"
      });
    }
  });

  server.patch("/sessions/:sessionId/sharing", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const sessionId = (request.params as { sessionId: string }).sessionId;
    const parsed = updateSessionSharingBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsed.error.flatten()
      });
    }

    try {
      const session = await getAuthorizedSession({
        sessionId,
        userId: user.id,
        memberships: user.memberships
      });
      if (session.ownerId !== user.id) {
        return reply.code(403).send({ error: "forbidden" });
      }

      const updated = await prisma.session.update({
        where: {
          id: session.id
        },
        data: {
          sharedWithWorkspace: parsed.data.sharedWithWorkspace
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
              toolCalls: {
                where: {
                  name: "generate_reply"
                },
                orderBy: {
                  id: "desc"
                },
                take: 1
              }
            }
          }
        }
      });

      return reply.send({
        session: buildSessionRecord({
          ...updated,
          sessionWorktree: session.sessionWorktree
        }, user.id, null)
      });
    } catch (error) {
      if (error instanceof Error && error.message === "session_not_found") {
        return reply.code(404).send({ error: "session_not_found" });
      }
      if (error instanceof Error && error.message === "forbidden") {
        return reply.code(403).send({ error: "forbidden" });
      }

      request.log.error(error);
      return reply.code(500).send({
        error: "session_sharing_update_failed"
      });
    }
  });

  server.post("/sessions/:sessionId/checkout", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const sessionId = (request.params as { sessionId: string }).sessionId;
    const parsed = sessionCheckoutBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsed.error.flatten()
      });
    }

    try {
      const session = await getAuthorizedSession({
        sessionId,
        userId: user.id,
        memberships: user.memberships
      });
      const activeCheckout = getActiveCheckout(session);
      if (activeCheckout && activeCheckout.checkedOutById !== user.id) {
        const checkoutUser = await prisma.user.findUnique({
          where: {
            id: activeCheckout.checkedOutById
          },
          select: {
            email: true
          }
        });
        return reply.code(409).send({
          error: "session_checked_out",
          message: `Session is currently checked out by ${checkoutUser?.email ?? "another user"}.`
        });
      }

      const extendMinutes = parsed.data.extendMinutes ?? DEFAULT_SESSION_CHECKOUT_MINUTES;
      const updated = await prisma.session.update({
        where: {
          id: session.id
        },
        data: {
          checkedOutById: user.id,
          checkoutExpiresAt: getCheckoutExpiry(extendMinutes)
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
              toolCalls: {
                where: {
                  name: "generate_reply"
                },
                orderBy: {
                  id: "desc"
                },
                take: 1
              }
            }
          }
        }
      });

      return reply.send({
        session: buildSessionRecord({
          ...updated,
          sessionWorktree: session.sessionWorktree
        }, user.id, user.email)
      });
    } catch (error) {
      if (error instanceof Error && error.message === "session_not_found") {
        return reply.code(404).send({ error: "session_not_found" });
      }
      if (error instanceof Error && error.message === "forbidden") {
        return reply.code(403).send({ error: "forbidden" });
      }

      request.log.error(error);
      return reply.code(500).send({
        error: "session_checkout_failed"
      });
    }
  });

  server.delete("/sessions/:sessionId/checkout", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const sessionId = (request.params as { sessionId: string }).sessionId;

    try {
      const session = await getAuthorizedSession({
        sessionId,
        userId: user.id,
        memberships: user.memberships
      });
      const activeCheckout = getActiveCheckout(session);
      if (activeCheckout && activeCheckout.checkedOutById !== user.id && session.ownerId !== user.id) {
        return reply.code(403).send({ error: "forbidden" });
      }

      const updated = activeCheckout
        ? await prisma.session.update({
            where: {
              id: session.id
            },
            data: {
              checkedOutById: null,
              checkoutExpiresAt: null
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
                  toolCalls: {
                    where: {
                      name: "generate_reply"
                    },
                    orderBy: {
                      id: "desc"
                    },
                    take: 1
                  }
                }
              }
            }
          })
        : await prisma.session.findUniqueOrThrow({
            where: {
              id: session.id
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
                  toolCalls: {
                    where: {
                      name: "generate_reply"
                    },
                    orderBy: {
                      id: "desc"
                    },
                    take: 1
                  }
                }
              }
            }
          });

      return reply.send({
        session: buildSessionRecord({
          ...updated,
          sessionWorktree: session.sessionWorktree
        }, user.id, null)
      });
    } catch (error) {
      if (error instanceof Error && error.message === "session_not_found") {
        return reply.code(404).send({ error: "session_not_found" });
      }
      if (error instanceof Error && error.message === "forbidden") {
        return reply.code(403).send({ error: "forbidden" });
      }

      request.log.error(error);
      return reply.code(500).send({
        error: "session_checkout_release_failed"
      });
    }
  });

  server.delete("/sessions/:sessionId", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const sessionId = (request.params as { sessionId: string }).sessionId;

    try {
      const session = await getAuthorizedSession({
        sessionId,
        userId: user.id,
        memberships: user.memberships
      });
      if (session.ownerId !== user.id) {
        return reply.code(403).send({ error: "forbidden" });
      }

      const hasExternalContributors =
        session.sharedWithWorkspace &&
        (await prisma.message.findFirst({
          where: {
            sessionId: session.id,
            authorId: {
              not: session.ownerId
            }
          },
          select: {
            id: true
          }
        }));

      if (hasExternalContributors) {
        return reply.code(409).send({
          error: "session_delete_blocked",
          message: "A shared workspace member has already contributed to this session."
        });
      }

      await deleteSessionResources(session.id);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof Error && error.message === "session_not_found") {
        return reply.code(404).send({ error: "session_not_found" });
      }
      if (error instanceof Error && error.message === "forbidden") {
        return reply.code(403).send({ error: "forbidden" });
      }

      request.log.error(error);
      return reply.code(500).send({
        error: "session_delete_failed"
      });
    }
  });
}
