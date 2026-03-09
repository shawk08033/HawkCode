import { PrismaClient } from "@prisma/client";
import { loadRuntimeConfig } from "./runtime-config";

const config = loadRuntimeConfig();
if (config?.databaseUrl) {
  process.env.DATABASE_URL = config.databaseUrl;
}

export const prisma = new PrismaClient();
