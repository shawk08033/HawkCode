import { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma";

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

const SESSION_TTL_DAYS = 30;

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

function getExpiry() {
  const expires = new Date();
  expires.setDate(expires.getDate() + SESSION_TTL_DAYS);
  return expires;
}

async function getSessionUser(token?: string) {
  if (!token) return null;
  const session = await prisma.authSession.findUnique({
    where: { token },
    include: { user: { include: { memberships: true } } }
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.authSession.delete({ where: { id: session.id } });
    return null;
  }
  return session.user;
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

    reply.setCookie("hawkcode_session", token, {
      path: "/",
      httpOnly: true,
      sameSite: "none",
      secure: true,
      expires: expiresAt
    });

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

      const result = await prisma.$transaction(async (tx) => {
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

      reply.setCookie("hawkcode_session", tokenValue, {
        path: "/",
        httpOnly: true,
        sameSite: "none",
        secure: true,
        expires: expiresAt
      });

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
      invites: invites.map((invite) => ({
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

  server.post("/auth/logout", async (request, reply) => {
    const token = request.cookies.hawkcode_session;
    if (token) {
      await prisma.authSession.deleteMany({ where: { token } });
    }
    reply.clearCookie("hawkcode_session", { path: "/" });
    return reply.send({ ok: true });
  });
}
