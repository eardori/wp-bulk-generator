import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { verifyApiKey } from "./utils/auth.js";
import { closeBrowser } from "./utils/browser.js";
import { imageRoutes } from "./routes/image.js";
import { scrapeRoutes } from "./routes/scrape.js";
import { reviewsRoutes } from "./routes/reviews.js";
import { generateArticlesRoutes } from "./routes/generate-articles.js";
import { generateConfigsRoutes } from "./routes/generate-configs.js";
import { publishArticlesRoutes } from "./routes/publish-articles.js";
import { seoOptimizeRoutes } from "./routes/seo-optimize.js";
import { dashboardRoutes } from "./routes/dashboard.js";

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || "0.0.0.0";
const DEFAULT_ALLOWED_ORIGINS = [
  "https://wp.multiful.ai",
  "https://wp-bulk-generator.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

function getAllowedOrigins(): Set<string> {
  const configured = (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

function isAllowedOrigin(origin: string, allowedOrigins: Set<string>): boolean {
  if (allowedOrigins.has(origin)) {
    return true;
  }

  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

const app = Fastify({
  logger: true,
  bodyLimit: 10 * 1024 * 1024, // 10MB
});
const allowedOrigins = getAllowedOrigins();

// CORS
await app.register(cors, {
  origin(origin, callback) {
    if (!origin || isAllowedOrigin(origin, allowedOrigins)) {
      callback(null, true);
      return;
    }

    callback(null, false);
  },
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Bridge-API-Key",
  ],
});

// 모든 요청에 API Key 또는 JWT 인증 적용
app.addHook("onRequest", verifyApiKey);

// Health check (Fly.io 자체 상태)
app.get("/health", async () => ({ status: "ok", service: "bridge-api" }));

// 라우트 등록 (EC2-independent + hybrid)
await app.register(imageRoutes);
await app.register(scrapeRoutes);
await app.register(reviewsRoutes);
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
  app.log.info({ allowedOrigins: [...allowedOrigins] }, "Bridge CORS origins loaded");
  app.log.info(`Bridge API running on http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
