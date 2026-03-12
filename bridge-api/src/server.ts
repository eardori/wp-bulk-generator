import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { verifyApiKey } from "./utils/auth.js";
import { closeBrowser } from "./utils/browser.js";
import { healthRoutes } from "./routes/health.js";
import { credentialsRoutes } from "./routes/credentials.js";
import { groupsRoutes } from "./routes/groups.js";
import { reservedSlugsRoutes } from "./routes/reserved-slugs.js";
import { imageRoutes } from "./routes/image.js";
import { scrapeRoutes } from "./routes/scrape.js";
import { reviewsRoutes } from "./routes/reviews.js";
import { deployRoutes } from "./routes/deploy.js";
import { generateArticlesRoutes } from "./routes/generate-articles.js";
import { generateConfigsRoutes } from "./routes/generate-configs.js";
import { publishArticlesRoutes } from "./routes/publish-articles.js";
import { seoOptimizeRoutes } from "./routes/seo-optimize.js";
import { dashboardRoutes } from "./routes/dashboard.js";

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || "127.0.0.1";

const app = Fastify({
  logger: true,
  bodyLimit: 10 * 1024 * 1024, // 10MB
});

// CORS
await app.register(cors, {
  origin: process.env.CORS_ORIGIN || "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Bridge-API-Key",
  ],
});

// 모든 요청에 API Key 또는 JWT 인증 적용
app.addHook("onRequest", verifyApiKey);

// 라우트 등록
await app.register(healthRoutes);
await app.register(credentialsRoutes);
await app.register(groupsRoutes);
await app.register(reservedSlugsRoutes);
await app.register(imageRoutes);
await app.register(scrapeRoutes);
await app.register(reviewsRoutes);
await app.register(deployRoutes);
await app.register(generateArticlesRoutes);
await app.register(generateConfigsRoutes);
await app.register(publishArticlesRoutes);
await app.register(seoOptimizeRoutes);
await app.register(dashboardRoutes);

// Graceful shutdown
const shutdown = async () => {
  app.log.info("Shutting down...");
  await closeBrowser();
  await app.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Bridge API running on http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
