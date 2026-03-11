import { execSync } from "child_process";
import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    try {
      const memRaw = execSync("free -m", { timeout: 5000 }).toString();
      const memLines = memRaw.split("\n");
      const memParts = memLines[1]?.split(/\s+/) || [];

      const diskRaw = execSync("df -h /", { timeout: 5000 }).toString();
      const diskParts = diskRaw.split("\n")[1]?.split(/\s+/) || [];

      let siteCount = 0;
      try {
        const countRaw = execSync(
          "ls -d /var/www/*/wp-config.php 2>/dev/null | wc -l",
          { timeout: 5000 }
        ).toString();
        siteCount = parseInt(countRaw.trim(), 10) || 0;
      } catch {
        siteCount = 0;
      }

      return {
        status: "connected",
        memory: {
          total: parseInt(memParts[1] || "0", 10),
          used: parseInt(memParts[2] || "0", 10),
          free: parseInt(memParts[3] || "0", 10),
        },
        disk: {
          total: diskParts[1] || "0",
          used: diskParts[2] || "0",
          percent: diskParts[4] || "0%",
        },
        sites: siteCount,
      };
    } catch (err) {
      return {
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  });
}
