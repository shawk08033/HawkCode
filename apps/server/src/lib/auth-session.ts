import { prisma } from "./prisma.js";

export async function getSessionUser(token?: string) {
  if (!token) return null;

  const session = await prisma.authSession.findUnique({
    where: { token },
    include: {
      user: {
        include: {
          memberships: true
        }
      }
    }
  });

  if (!session) return null;

  if (session.expiresAt < new Date()) {
    await prisma.authSession.delete({ where: { id: session.id } });
    return null;
  }

  return session.user;
}
