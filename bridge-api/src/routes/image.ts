import { execSync } from "child_process";
import type { FastifyInstance } from "fastify";

export async function imageRoutes(app: FastifyInstance) {
  app.post("/image/download", async (req) => {
    const { url } = req.body as { url: string };

    if (!url) {
      return { error: "URL is required" };
    }

    try {
      const buffer = execSync(
        `curl -sL --max-time 20 -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" -H "Referer: https://smartstore.naver.com/" "${url}"`,
        { maxBuffer: 50 * 1024 * 1024, timeout: 25000 }
      );

      const base64 = buffer.toString("base64");

      // Content-Type 추측
      let mimeType = "image/jpeg";
      if (url.includes(".png")) mimeType = "image/png";
      else if (url.includes(".gif")) mimeType = "image/gif";
      else if (url.includes(".webp")) mimeType = "image/webp";

      return { base64, mimeType, size: buffer.length };
    } catch (err) {
      return {
        error: "Download failed",
        detail: err instanceof Error ? err.message : "Unknown",
      };
    }
  });
}
