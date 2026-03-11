import { readFileSync, existsSync } from "fs";
import type { FastifyInstance } from "fastify";

const CREDS_PATH =
  process.env.CREDENTIALS_PATH || "/root/wp-sites-credentials.json";
const CONFIG_PATH =
  process.env.CONFIG_PATH || "/root/wp-sites-config.json";

function tryReadJson(path: string): unknown[] {
  try {
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
}

export async function credentialsRoutes(app: FastifyInstance) {
  // 사이트 자격증명 + 페르소나 병합
  app.get("/credentials", async () => {
    const credentials = tryReadJson(CREDS_PATH) as Record<string, unknown>[];
    const configs = tryReadJson(CONFIG_PATH) as Record<string, unknown>[];

    const configMap = new Map<string, Record<string, unknown>>();
    for (const c of configs) {
      if (c.site_slug) configMap.set(c.site_slug as string, c);
    }

    const merged = credentials.map((cred) => {
      const config = configMap.get(cred.slug as string);
      return {
        ...cred,
        persona: config?.persona || null,
        categories: config?.categories || [],
      };
    });

    return { sites: merged };
  });

  // 사이트 설정만 반환
  app.get("/credentials/config", async () => {
    const configs = tryReadJson(CONFIG_PATH);
    return { configs };
  });
}
