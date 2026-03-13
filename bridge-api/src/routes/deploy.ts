import { exec, execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import type { FastifyInstance } from "fastify";
import { setupSSE } from "../utils/sse.js";
import { isExcludedSiteSlug } from "../lib/excluded-sites.js";

const CREDS_PATH =
  process.env.CREDENTIALS_PATH || "/root/wp-sites-credentials.json";
const DEPLOY_SCRIPT =
  process.env.DEPLOY_SCRIPT_PATH || "/home/ubuntu/wp-bulk-generator/scripts/deploy-wp-sites.sh";

type DeployConfig = {
  site_slug?: string;
  domain?: string;
};

type DeployFailure = {
  slug: string;
  reason: string;
};

type StoredCredential = {
  slug?: string;
  site_slug?: string;
  domain?: string;
  url?: string;
  admin_user?: string;
  admin_pass?: string;
};

type DeployCredentialsSummary = {
  admin_user: string;
  admin_pass: string;
  sites: Array<{
    slug: string;
    domain: string;
    url: string;
  }>;
};

function normalizeSlug(v: string | undefined) {
  return (v || "").trim().toLowerCase();
}

function normalizeDomain(v: string | undefined) {
  return (v || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

function findDuplicates(configs: DeployConfig[]): string[] {
  const seenSlugs = new Set<string>();
  const seenDomains = new Set<string>();
  const dups = new Set<string>();
  for (const c of configs) {
    const s = normalizeSlug(c.site_slug);
    const d = normalizeDomain(c.domain);
    if (s) { if (seenSlugs.has(s)) dups.add(`slug:${s}`); seenSlugs.add(s); }
    if (d) { if (seenDomains.has(d)) dups.add(`domain:${d}`); seenDomains.add(d); }
  }
  return Array.from(dups);
}

function readExistingSites(): DeployConfig[] {
  try {
    if (existsSync(CREDS_PATH)) {
      return JSON.parse(readFileSync(CREDS_PATH, "utf-8"));
    }
    const raw = execSync(`sudo cat ${CREDS_PATH}`, { timeout: 10000 }).toString();
    return JSON.parse(raw);
  } catch { return []; }
}

type DeployMarker =
  | {
      type: "site_start";
      index: number;
      total: number;
      slug: string;
      title: string;
    }
  | {
      type: "site_retry";
      slug: string;
      attempt: number;
      maxAttempts: number;
      reason: string;
    }
  | {
      type: "site_success";
      slug: string;
      title: string;
    }
  | {
      type: "site_failure";
      slug: string;
      reason: string;
    }
  | {
      type: "summary";
      successCount: number;
      failureCount: number;
    };

function parseDeployMarker(line: string): DeployMarker | null {
  if (!line.startsWith("__WPBULK__")) {
    return null;
  }

  const parts = line.slice("__WPBULK__".length).split("|");
  const kind = parts[0];

  if (kind === "SITE_START") {
    return {
      type: "site_start",
      index: Number(parts[1]) || 0,
      total: Number(parts[2]) || 0,
      slug: parts[3] || "",
      title: parts[4] || parts[3] || "",
    };
  }

  if (kind === "SITE_RETRY") {
    return {
      type: "site_retry",
      slug: parts[1] || "",
      attempt: Number(parts[2]) || 0,
      maxAttempts: Number(parts[3]) || 0,
      reason: parts[4] || "",
    };
  }

  if (kind === "SITE_SUCCESS") {
    return {
      type: "site_success",
      slug: parts[1] || "",
      title: parts[2] || parts[1] || "",
    };
  }

  if (kind === "SITE_FAILURE") {
    return {
      type: "site_failure",
      slug: parts[1] || "",
      reason: parts[2] || "알 수 없는 오류",
    };
  }

  if (kind === "SUMMARY") {
    return {
      type: "summary",
      successCount: Number(parts[1]) || 0,
      failureCount: Number(parts[2]) || 0,
    };
  }

  return null;
}

function summarizeDeployCredentials(
  credentials: unknown[],
  configs: DeployConfig[]
): DeployCredentialsSummary | null {
  const requestedSlugs = new Set(
    configs.map((cfg) => normalizeSlug(cfg.site_slug)).filter(Boolean)
  );
  const requestedDomains = new Set(
    configs.map((cfg) => normalizeDomain(cfg.domain)).filter(Boolean)
  );

  const matched = (credentials as StoredCredential[]).filter((site) => {
    const slug = normalizeSlug(site.slug);
    const domain = normalizeDomain(site.domain);
    return requestedSlugs.has(slug) || requestedDomains.has(domain);
  });

  if (matched.length === 0) {
    return null;
  }

  const first = matched[0];

  return {
    admin_user: first.admin_user || "admin",
    admin_pass: first.admin_pass || "",
    sites: matched.map((site) => ({
      slug: site.slug || "",
      domain: site.domain || "",
      url: site.url || `http://${site.domain || ""}`,
    })),
  };
}

export async function deployRoutes(app: FastifyInstance) {
  app.post("/deploy", async (req, reply) => {
    const { configs } = req.body as { configs: DeployConfig[] };

    if (!configs?.length) {
      reply.code(400).send({ error: "configs 배열이 필요합니다." });
      return;
    }

    // 중복 검사
    const requestDups = findDuplicates(configs);
    if (requestDups.length > 0) {
      reply.code(400).send({ error: `중복: ${requestDups.join(", ")}` });
      return;
    }

    // 기존 사이트 충돌 검사
    const existing = readExistingSites();
    const existingSlugs = new Set(
      (existing as StoredCredential[])
        .map((s) => normalizeSlug(s.site_slug ?? s.slug))
        .filter((slug) => Boolean(slug) && !isExcludedSiteSlug(slug))
    );
    const conflicts: string[] = [];
    for (const c of configs) {
      const s = normalizeSlug(c.site_slug);
      if (s && existingSlugs.has(s)) conflicts.push(s);
    }
    if (conflicts.length > 0) {
      reply.code(409).send({ error: `이미 존재하는 사이트: ${conflicts.join(", ")}` });
      return;
    }

    const { send, close } = setupSSE(reply);

    try {
      // 임시 설정 파일 작성
      const tmpConfig = `/tmp/sites-config-deploy-${Date.now()}.json`;
      writeFileSync(tmpConfig, JSON.stringify(configs, null, 2));

      send({ type: "progress", message: "배포 스크립트 실행 시작..." });

      let completed = 0;
      let successCount = 0;
      let failureCount = 0;
      const failedSites: DeployFailure[] = [];

      // 배포 스크립트 실행 (stdout/stderr 실시간 스트리밍)
      const child = exec(`sudo bash ${DEPLOY_SCRIPT} ${tmpConfig}`, {
        timeout: 600000,
        maxBuffer: 50 * 1024 * 1024,
      });

      child.stdout?.on("data", (data: string) => {
        const lines = data.split("\n").filter(Boolean);
        for (const line of lines) {
          const marker = parseDeployMarker(line);
          if (marker) {
            if (marker.type === "site_start") {
              send({
                type: "progress",
                progress: completed,
                total: marker.total || configs.length,
                currentSite: marker.title || marker.slug,
                message: `[${marker.index}/${marker.total || configs.length}] ${marker.title || marker.slug} 설치 중...`,
              });
              continue;
            }

            if (marker.type === "site_retry") {
              send({
                type: "log",
                message: `${marker.slug} 재시도 (${marker.attempt}/${marker.maxAttempts})${marker.reason ? ` - ${marker.reason}` : ""}`,
              });
              continue;
            }

            if (marker.type === "site_success") {
              completed += 1;
              successCount += 1;
              send({
                type: "progress",
                progress: completed,
                total: configs.length,
                currentSite: marker.title || marker.slug,
                message: `${marker.title || marker.slug} 설치 완료 (${completed}/${configs.length})`,
              });
              continue;
            }

            if (marker.type === "site_failure") {
              completed += 1;
              failureCount += 1;
              failedSites.push({ slug: marker.slug, reason: marker.reason });
              send({
                type: "progress",
                progress: completed,
                total: configs.length,
                currentSite: marker.slug,
                message: `${marker.slug} 설치 실패, 다음 사이트로 진행합니다. (${completed}/${configs.length})`,
              });
              continue;
            }

            if (marker.type === "summary") {
              successCount = marker.successCount;
              failureCount = marker.failureCount;
              continue;
            }
          }

          send({ type: "log", message: line });
        }
      });

      child.stderr?.on("data", (data: string) => {
        const lines = data.split("\n").filter(Boolean);
        for (const line of lines) {
          send({ type: "log", message: `[stderr] ${line}` });
        }
      });

      await new Promise<void>((resolve, reject) => {
        child.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`배포 스크립트 종료 코드: ${code}`));
        });
        child.on("error", reject);
      });

      // 배포 후 credentials 읽기
      let credentials: unknown[] = [];
      try {
        const raw = execSync(`sudo cat ${CREDS_PATH}`, { timeout: 10000 }).toString();
        credentials = JSON.parse(raw);
      } catch { /* ignore */ }

      // .cache에도 동기화
      const cacheDir = "/home/ubuntu/wp-bulk-generator/admin/.cache";
      if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
      try {
        writeFileSync(`${cacheDir}/sites-credentials.json`, JSON.stringify(credentials, null, 2));
        writeFileSync(`${cacheDir}/sites-config.json`, JSON.stringify([...existing, ...configs], null, 2));
      } catch { /* ignore */ }

      const credentialsSummary = summarizeDeployCredentials(credentials, configs);

      if (credentialsSummary) {
        send({ type: "credentials", credentials: credentialsSummary });
      }

      send({
        type: "done",
        status: "done",
        progress: configs.length,
        total: configs.length,
        currentSite: "",
        successCount,
        failureCount,
        failedSites,
        message:
          failureCount > 0
            ? `배포 완료 (${successCount}개 성공, ${failureCount}개 실패)`
            : "배포 완료",
      });
    } catch (err) {
      send({
        type: "error",
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      close();
    }
  });
}
