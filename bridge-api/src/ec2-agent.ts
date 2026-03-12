/**
 * EC2 Agent — EC2 파일시스템 접근이 필요한 경량 라우트만 제공
 * health, credentials, groups, reserved-slugs, deploy
 */
import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { verifyApiKey } from "./utils/auth.js";
import { healthRoutes } from "./routes/health.js";
import { credentialsRoutes } from "./routes/credentials.js";
import { groupsRoutes } from "./routes/groups.js";
import { reservedSlugsRoutes } from "./routes/reserved-slugs.js";
import { deployRoutes } from "./routes/deploy.js";

const PORT = Number(process.env.PORT) || 4001;
const HOST = process.env.HOST || "127.0.0.1";

const app = Fastify({
  logger: true,
  bodyLimit: 10 * 1024 * 1024,
});

await app.register(cors, {
  origin: process.env.CORS_ORIGIN || "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Bridge-API-Key"],
});

app.addHook("onRequest", verifyApiKey);

// EC2 전용 라우트만 등록
await app.register(healthRoutes);
await app.register(credentialsRoutes);
await app.register(groupsRoutes);
await app.register(reservedSlugsRoutes);
await app.register(deployRoutes);

const shutdown = async () => {
  app.log.info("EC2 Agent shutting down...");
  await app.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`EC2 Agent running on http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
