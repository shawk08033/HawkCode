import { PrismaClient } from "@prisma/client";
import { loadRuntimeConfig } from "./runtime-config.js";

const config = loadRuntimeConfig();
if (config?.databaseUrl) {
  process.env.DATABASE_URL = config.databaseUrl;
}

function createPrismaClient() {
  try {
    return new PrismaClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    if (message.includes("@prisma/client did not initialize yet")) {
      throw new Error(
        'Prisma client is not generated. Run "pnpm -C apps/server prisma generate" and restart the server.'
      );
    }
    throw error;
  }
}

export const prisma = createPrismaClient();
