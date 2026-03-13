import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import type { FastifyInstance } from "fastify";
import { isExcludedSiteRecord } from "../lib/excluded-sites.js";

const CREDS_PATH =
  process.env.CREDENTIALS_PATH || "/root/wp-sites-credentials.json";
const CONFIG_PATH =
  process.env.CONFIG_PATH || "/root/wp-sites-config.json";
const GROUPS_PATH =
  process.env.GROUPS_PATH || "/root/site-groups.json";
const CREDENTIAL_MIRROR_PATHS = [
  "/root/wp-sites-credentials.json",
  "/home/ubuntu/wp-bulk-generator/bridge-api/data/wp-sites-credentials.json",
  "/home/ubuntu/wp-bulk-generator/admin/.cache/sites-credentials.json",
  "/home/ubuntu/wp-bridge-api/data/wp-sites-credentials.json",
];
const CONFIG_MIRROR_PATHS = [
  "/root/wp-sites-config.json",
  "/home/ubuntu/wp-bulk-generator/bridge-api/data/wp-sites-config.json",
  "/home/ubuntu/wp-bulk-generator/admin/.cache/sites-config.json",
  "/home/ubuntu/wp-bridge-api/data/wp-sites-config.json",
];
const GROUP_MIRROR_PATHS = [
  "/root/site-groups.json",
  "/home/ubuntu/wp-bulk-generator/bridge-api/data/site-groups.json",
  "/home/ubuntu/wp-bridge-api/data/site-groups.json",
];

function tryReadJson(path: string): unknown {
  try {
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
}

function normalizeRecords(
  input: unknown,
  nestedKey?: string
): Record<string, unknown>[] {
  if (Array.isArray(input)) {
    return input as Record<string, unknown>[];
  }

  if (
    nestedKey &&
    input &&
    typeof input === "object" &&
    Array.isArray((input as Record<string, unknown>)[nestedKey])
  ) {
    return (input as Record<string, unknown>)[nestedKey] as Record<
      string,
      unknown
    >[];
  }

  return [];
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

function uniquePaths(primary: string, mirrors: string[]): string[] {
  return Array.from(new Set([primary, ...mirrors].filter(Boolean)));
}

export async function credentialsRoutes(app: FastifyInstance) {
  // 사이트 자격증명 + 페르소나 병합
  app.get("/credentials", async () => {
    const credentials = normalizeRecords(tryReadJson(CREDS_PATH), "sites");
    const configs = normalizeRecords(tryReadJson(CONFIG_PATH), "configs");

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
    }).filter((cred) => !isExcludedSiteRecord(cred));

    return { sites: merged };
  });

  // 사이트 설정만 반환
  app.get("/credentials/config", async () => {
    const configs = normalizeRecords(tryReadJson(CONFIG_PATH), "configs")
      .filter((config) => !isExcludedSiteRecord(config));
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

    const shouldDelete = (item: Record<string, unknown>) => {
      const slug = normalizeText(item.slug ?? item.site_slug);
      const domain = normalizeText(item.domain);
      return slugSet.has(slug) || domainSet.has(domain);
    };

    let deletedCredentials = 0;
    let deletedConfigs = 0;
    let deletedGroups = 0;
    let remainingCredentials = 0;
    let remainingConfigs = 0;
    let remainingGroups = 0;

    for (const path of uniquePaths(CREDS_PATH, CREDENTIAL_MIRROR_PATHS)) {
      const credentials = normalizeRecords(tryReadJson(path), "sites");
      const nextCredentials = credentials.filter((item) => !shouldDelete(item));
      remainingCredentials = Math.max(remainingCredentials, nextCredentials.length);
      deletedCredentials = Math.max(
        deletedCredentials,
        credentials.length - nextCredentials.length
      );

      if (nextCredentials.length !== credentials.length) {
        writeJson(path, nextCredentials);
      }
    }

    for (const path of uniquePaths(CONFIG_PATH, CONFIG_MIRROR_PATHS)) {
      const configs = normalizeRecords(tryReadJson(path), "configs");
      const nextConfigs = configs.filter((item) => !shouldDelete(item));
      remainingConfigs = Math.max(remainingConfigs, nextConfigs.length);
      deletedConfigs = Math.max(
        deletedConfigs,
        configs.length - nextConfigs.length
      );

      if (nextConfigs.length !== configs.length) {
        writeJson(path, nextConfigs);
      }
    }

    for (const path of uniquePaths(GROUPS_PATH, GROUP_MIRROR_PATHS)) {
      const groups = normalizeRecords(tryReadJson(path), "groups");
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

      remainingGroups = Math.max(remainingGroups, nextGroups.length);
      deletedGroups = Math.max(deletedGroups, groups.length - nextGroups.length);

      if (nextGroups.length !== groups.length) {
        writeJson(path, nextGroups);
      }
    }

    return {
      success: true,
      deleted: {
        credentials: deletedCredentials,
        configs: deletedConfigs,
        groups: deletedGroups,
      },
      remaining: {
        credentials: remainingCredentials,
        configs: remainingConfigs,
        groups: remainingGroups,
      },
    };
  });
}
