import { readFileSync, existsSync } from "fs";
import type { FastifyInstance } from "fastify";

const CREDS_PATH =
  process.env.CREDENTIALS_PATH || "/root/wp-sites-credentials.json";
const CONFIG_PATH =
  process.env.CONFIG_PATH || "/root/wp-sites-config.json";

export async function reservedSlugsRoutes(app: FastifyInstance) {
  app.post("/reserved-slugs", async () => {
    const slugs = new Set<string>();
    const domains = new Set<string>();

    const paths = [CREDS_PATH, CONFIG_PATH];
    for (const p of paths) {
      try {
        if (!existsSync(p)) continue;
        const data = JSON.parse(readFileSync(p, "utf-8")) as Record<
          string,
          string
        >[];
        for (const item of data) {
          if (item.slug || item.site_slug)
            slugs.add((item.slug || item.site_slug) as string);
          if (item.domain) domains.add(item.domain);
        }
      } catch {
        // 파일 없거나 파싱 실패
      }
    }

    return {
      slugs: Array.from(slugs),
      domains: Array.from(domains),
    };
  });
}
