import { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { loadRuntimeConfig } from "../lib/runtime-config.js";
import { getSessionUser } from "../lib/auth-session.js";
import {
  fetchGitHubUser,
  isGitHubAuthConfigured,
  pollGitHubDeviceFlow,
  startGitHubDeviceFlow
} from "../lib/github.js";

type LoginBody = {
  email: string;
  password: string;
};

type AcceptInviteBody = {
  token: string;
  email: string;
  password: string;
};

type CreateInviteBody = {
  email?: string;
  role: "maintainer" | "viewer";
  expiresInDays?: number;
};

type GitHubDevicePollBody = {
  deviceCode: string;
};

const SESSION_TTL_DAYS = 30;

function getCookieOptions(expiresAt?: Date) {
  const runtime = loadRuntimeConfig();
  const hasTls = Boolean(runtime?.tlsCertPath && runtime?.tlsKeyPath);
  return {
    path: "/",
    httpOnly: true,
    sameSite: hasTls ? ("none" as const) : ("lax" as const),
    secure: hasTls,
    ...(expiresAt ? { expires: expiresAt } : {})
  };
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

function getExpiry() {
  const expires = new Date();
  expires.setDate(expires.getDate() + SESSION_TTL_DAYS);
  return expires;
}

function buildGitHubAccountRecord(account?: {
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

export async function registerAuthRoutes(server: FastifyInstance) {
  server.get("/auth/invite/:token", async (request, reply) => {
    const token = (request.params as { token: string }).token;
    const invite = await prisma.invite.findUnique({
      where: { token },
      include: { workspace: true }
    });
    if (!invite || invite.expiresAt < new Date() || invite.acceptedAt) {
      return reply.code(404).send({ error: "invite_not_found" });
    }
    return reply.send({
      workspace: invite.workspace.name,
      role: invite.role,
      email: invite.email
    });
  });

  server.post<{ Body: LoginBody }>("/auth/login", async (request, reply) => {
    const { email, password } = request.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    const token = createToken();
    const expiresAt = getExpiry();

    await prisma.authSession.create({
      data: {
        token,
        userId: user.id,
        expiresAt
      }
    });

    reply.setCookie("hawkcode_session", token, getCookieOptions(expiresAt));

    return reply.send({
      user: { id: user.id, email: user.email }
    });
  });

  server.post<{ Body: AcceptInviteBody }>(
    "/auth/invite/accept",
    async (request, reply) => {
      const { token, email, password } = request.body;
      const invite = await prisma.invite.findUnique({ where: { token } });
      if (!invite || invite.expiresAt < new Date() || invite.acceptedAt) {
        return reply.code(404).send({ error: "invite_not_found" });
      }
      if (invite.email && invite.email !== email) {
        return reply.code(400).send({ error: "invite_email_mismatch" });
      }
      if (password.length < 8) {
        return reply.code(400).send({ error: "password_too_short" });
      }
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return reply.code(409).send({ error: "user_exists" });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const tokenValue = createToken();
      const expiresAt = getExpiry();

      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const user = await tx.user.create({
          data: { email, passwordHash }
        });
        await tx.membership.create({
          data: {
            role: invite.role,
            userId: user.id,
            workspaceId: invite.workspaceId
          }
        });
        await tx.invite.update({
          where: { id: invite.id },
          data: { acceptedAt: new Date(), acceptedById: user.id }
        });
        await tx.authSession.create({
          data: { token: tokenValue, userId: user.id, expiresAt }
        });
        return user;
      });

      reply.setCookie("hawkcode_session", tokenValue, getCookieOptions(expiresAt));

      return reply.send({ user: { id: result.id, email: result.email } });
    }
  );

  server.post<{ Body: CreateInviteBody }>("/invites", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const membership = user.memberships[0];
    if (!membership) {
      return reply.code(403).send({ error: "no_workspace" });
    }
    if (membership.role !== "owner" && membership.role !== "maintainer") {
      return reply.code(403).send({ error: "forbidden" });
    }

    const { email, role, expiresInDays } = request.body;
    if (!role || (role !== "maintainer" && role !== "viewer")) {
      return reply.code(400).send({ error: "invalid_role" });
    }

    const days = Math.max(1, Math.min(expiresInDays ?? 7, 30));
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    const token = createToken();
    const invite = await prisma.invite.create({
      data: {
        token,
        role,
        email: email || null,
        workspaceId: membership.workspaceId,
        expiresAt
      }
    });

    return reply.send({
      token: invite.token,
      expiresAt: invite.expiresAt.toISOString()
    });
  });

  server.get("/invites", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const membership = user.memberships[0];
    if (!membership) {
      return reply.code(403).send({ error: "no_workspace" });
    }
    if (membership.role !== "owner" && membership.role !== "maintainer") {
      return reply.code(403).send({ error: "forbidden" });
    }

    const invites = await prisma.invite.findMany({
      where: { workspaceId: membership.workspaceId },
      orderBy: { createdAt: "desc" }
    });

    return reply.send({
      invites: invites.map((invite: {
        id: string;
        token: string;
        role: string;
        email: string | null;
        expiresAt: Date;
        acceptedAt: Date | null;
      }) => ({
        id: invite.id,
        token: invite.token,
        role: invite.role,
        email: invite.email,
        expiresAt: invite.expiresAt.toISOString(),
        acceptedAt: invite.acceptedAt ? invite.acceptedAt.toISOString() : null
      }))
    });
  });

  server.delete("/invites/:id", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const membership = user.memberships[0];
    if (!membership) {
      return reply.code(403).send({ error: "no_workspace" });
    }
    if (membership.role !== "owner" && membership.role !== "maintainer") {
      return reply.code(403).send({ error: "forbidden" });
    }

    const id = (request.params as { id: string }).id;
    const invite = await prisma.invite.findUnique({ where: { id } });
    if (!invite || invite.workspaceId !== membership.workspaceId) {
      return reply.code(404).send({ error: "invite_not_found" });
    }

    await prisma.invite.delete({ where: { id } });
    return reply.send({ ok: true });
  });

  server.get("/auth/me", async (request, reply) => {
    const token = request.cookies.hawkcode_session;
    if (!token) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const session = await prisma.authSession.findUnique({
      where: { token },
      include: { user: true }
    });
    if (!session) {
      reply.clearCookie("hawkcode_session", { path: "/" });
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (session.expiresAt < new Date()) {
      await prisma.authSession.delete({ where: { id: session.id } });
      reply.clearCookie("hawkcode_session", { path: "/" });
      return reply.code(401).send({ error: "session_expired" });
    }
    return reply.send({ user: { id: session.user.id, email: session.user.email } });
  });

  server.get("/auth/github/status", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    return reply.send({
      github: {
        authConfigured: isGitHubAuthConfigured(),
        connected: Boolean(user.githubAccount),
        user: buildGitHubAccountRecord(user.githubAccount)
      }
    });
  });

  server.post("/auth/github/device/start", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    try {
      const result = await startGitHubDeviceFlow();
      request.log.info(
        {
          userId: user.id,
          githubDeviceFlow: {
            action: "start",
            interval: result.interval,
            expiresIn: result.expiresIn
          }
        },
        "GitHub device flow started"
      );
      const expiresAt = new Date(Date.now() + result.expiresIn * 1000);
      return reply.send({
        deviceCode: result.deviceCode,
        userCode: result.userCode,
        verificationUri: result.verificationUri,
        intervalSeconds: result.interval,
        expiresAt: expiresAt.toISOString()
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "github_device_flow_start_failed";
      return reply.code(message === "github_not_configured" ? 503 : 502).send({
        error: message
      });
    }
  });

  server.post<{ Body: GitHubDevicePollBody }>("/auth/github/device/poll", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const deviceCode = request.body?.deviceCode?.trim();
    if (!deviceCode) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    try {
      const result = await pollGitHubDeviceFlow(deviceCode);
      request.log.info(
        {
          userId: user.id,
          githubDeviceFlow: {
            action: "poll",
            status: result.status,
            error: "error" in result ? result.error : undefined
          }
        },
        "GitHub device flow poll result"
      );
      if (result.status === "authorization_pending" || result.status === "slow_down") {
        return reply.send({
          status: result.status === "slow_down" ? "slow_down" : "pending",
          message: result.message,
          intervalSeconds: result.retryAfterSeconds
        });
      }

      if (result.status === "error") {
        return reply.code(
          result.error === "expired_token" || result.error === "access_denied" ? 400 : 502
        ).send({
          status: "error",
          error: result.error,
          message: result.message
        });
      }

      if (result.status !== "connected") {
        return reply.code(502).send({
          status: "error",
          error: "github_device_flow_poll_failed"
        });
      }

      const githubUser = await fetchGitHubUser(result.accessToken);
      request.log.info(
        {
          userId: user.id,
          githubDeviceFlow: {
            action: "connected",
            githubLogin: githubUser.login
          }
        },
        "GitHub device flow connected"
      );
      const account = await prisma.gitHubAccount.upsert({
        where: {
          userId: user.id
        },
        update: {
          githubUserId: githubUser.githubUserId,
          login: githubUser.login,
          name: githubUser.name,
          email: githubUser.email,
          avatarUrl: githubUser.avatarUrl,
          accessToken: result.accessToken,
          scope: result.scope,
          tokenType: result.tokenType
        },
        create: {
          userId: user.id,
          githubUserId: githubUser.githubUserId,
          login: githubUser.login,
          name: githubUser.name,
          email: githubUser.email,
          avatarUrl: githubUser.avatarUrl,
          accessToken: result.accessToken,
          scope: result.scope,
          tokenType: result.tokenType
        }
      });

      return reply.send({
        status: "connected",
        github: {
          authConfigured: isGitHubAuthConfigured(),
          connected: true,
          user: buildGitHubAccountRecord(account)
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "github_device_flow_poll_failed";
      request.log.error(
        {
          userId: user.id,
          githubDeviceFlow: {
            action: "poll_failed",
            message
          }
        },
        "GitHub device flow poll failed"
      );
      return reply.code(message === "github_not_configured" ? 503 : 502).send({
        status: "error",
        error: message
      });
    }
  });

  server.delete("/auth/github", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    await prisma.gitHubAccount.deleteMany({
      where: {
        userId: user.id
      }
    });

    return reply.send({ ok: true });
  });

  server.post("/auth/logout", async (request, reply) => {
    const token = request.cookies.hawkcode_session;
    if (token) {
      await prisma.authSession.deleteMany({ where: { token } });
    }
    reply.clearCookie("hawkcode_session", { path: "/" });
    return reply.send({ ok: true });
  });
}
