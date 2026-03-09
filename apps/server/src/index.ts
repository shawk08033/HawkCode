import "dotenv/config";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { getSetupComplete } from "./lib/setup-status";
import { registerAuthRoutes } from "./routes/auth";
import { loadRuntimeConfig } from "./lib/runtime-config";
import fs from "node:fs";

const runtimeConfig = loadRuntimeConfig();
let httpsConfig = {} as { https?: { cert: Buffer; key: Buffer } };
if (runtimeConfig?.tlsCertPath && runtimeConfig?.tlsKeyPath) {
  try {
    httpsConfig = {
      https: {
        cert: fs.readFileSync(runtimeConfig.tlsCertPath),
        key: fs.readFileSync(runtimeConfig.tlsKeyPath)
      }
    };
  } catch (error) {
    console.warn("TLS cert/key load failed, starting without HTTPS", error);
  }
}

const server = Fastify({ logger: true, ...httpsConfig });

await server.register(cookie);
await server.register(cors, {
  origin: true,
  credentials: true
});
await server.register(websocket);

const setupFreePaths = new Set(["/health", "/setup/status"]);

server.addHook("onRequest", async (request, reply) => {
  if (setupFreePaths.has(request.url)) {
    return;
  }
  const setupComplete = await getSetupComplete();
  if (!setupComplete) {
    reply.code(503).send({
      error: "setup_required",
      message: "Setup is required before using the API."
    });
  }
});

server.get("/health", async () => ({ status: "ok" }));
server.get("/setup/status", async () => {
  const setupComplete = await getSetupComplete();
  return { setupComplete };
});

await registerAuthRoutes(server);

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await server.listen({ port, host });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
