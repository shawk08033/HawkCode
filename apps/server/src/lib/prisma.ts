import { PrismaClient } from "@prisma/client";
import { loadRuntimeConfig } from "./runtime-config.js";

const config = loadRuntimeConfig();
if (config?.databaseUrl) {
  process.env.DATABASE_URL = config.databaseUrl;
}

export const prisma = new PrismaClient();
