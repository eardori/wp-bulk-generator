import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import type { FastifyInstance } from "fastify";

const CREDS_PATH =
  process.env.CREDENTIALS_PATH || "/root/wp-sites-credentials.json";
const CONFIG_PATH =
  process.env.CONFIG_PATH || "/root/wp-sites-config.json";
const GROUPS_PATH =
  process.env.GROUPS_PATH || "/root/site-groups.json";

function tryReadJson(path: string): unknown[] {
  try {
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
}

function writeJson(path: string, data: unknown[]) {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(path, JSON.stringify(data, null, 2));
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
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

  // 사이트 credentials/config/groups 정리
  app.post("/credentials/delete-sites", async (req, reply) => {
    const body = (req.body || {}) as {
      slugs?: unknown[];
      domains?: unknown[];
    };

    const slugSet = new Set(
      (Array.isArray(body.slugs) ? body.slugs : [])
        .map((slug) => normalizeText(slug))
        .filter(Boolean)
    );
    const domainSet = new Set(
      (Array.isArray(body.domains) ? body.domains : [])
        .map((domain) => normalizeText(domain))
        .filter(Boolean)
    );

    if (slugSet.size === 0 && domainSet.size === 0) {
      reply.code(400).send({ error: "slugs 또는 domains가 필요합니다." });
      return;
    }

    const credentials = tryReadJson(CREDS_PATH) as Record<string, unknown>[];
    const configs = tryReadJson(CONFIG_PATH) as Record<string, unknown>[];
    const groups = tryReadJson(GROUPS_PATH) as Record<string, unknown>[];

    const shouldDelete = (item: Record<string, unknown>) => {
      const slug = normalizeText(item.slug ?? item.site_slug);
      const domain = normalizeText(item.domain);
      return slugSet.has(slug) || domainSet.has(domain);
    };

    const nextCredentials = credentials.filter((item) => !shouldDelete(item));
    const nextConfigs = configs.filter((item) => !shouldDelete(item));

    const nextGroups = groups
      .map((group) => {
        const slugs = Array.isArray(group.slugs)
          ? (group.slugs as unknown[]).map((slug) => normalizeText(slug))
          : [];

        return {
          ...group,
          slugs: slugs.filter((slug) => !slugSet.has(slug)),
        };
      })
      .filter((group) => Array.isArray(group.slugs) && group.slugs.length > 0);

    if (nextCredentials.length !== credentials.length) {
      writeJson(CREDS_PATH, nextCredentials);
    }
    if (nextConfigs.length !== configs.length) {
      writeJson(CONFIG_PATH, nextConfigs);
    }
    if (nextGroups.length !== groups.length) {
      writeJson(GROUPS_PATH, nextGroups);
    }

    return {
      success: true,
      deleted: {
        credentials: credentials.length - nextCredentials.length,
        configs: configs.length - nextConfigs.length,
        groups: groups.length - nextGroups.length,
      },
      remaining: {
        credentials: nextCredentials.length,
        configs: nextConfigs.length,
        groups: nextGroups.length,
      },
    };
  });
}
