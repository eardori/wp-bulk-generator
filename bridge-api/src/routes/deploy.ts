import { execSync, spawn } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "fs";
import type { FastifyInstance } from "fastify";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { setupSSE } from "../utils/sse.js";
import { isExcludedSiteSlug } from "../lib/excluded-sites.js";
import { seedDashboardSiteCaches } from "../lib/dashboard-cache.js";
import {
  isBingUrlSubmissionEnabled,
  isBingWebmasterSyncEnabled,
  submitBingUrls,
  syncBingSite,
} from "../lib/bing-webmaster.js";
import { isIndexNowEnabled, submitIndexNow } from "../lib/indexnow.js";
import { syncWpAuthorFromPersona } from "../lib/author-sync.js";
import {
  getDefaultDeployTarget,
  getPrimaryServerTarget,
  getSecondaryServerTarget,
  isRemoteTarget,
  type ServerTarget,
} from "../lib/server-targets.js";
import { execSsh, scpToTarget, shellQuote, spawnSsh } from "../lib/ssh.js";

const CREDS_PATH =
  process.env.CREDENTIALS_PATH || "/root/wp-sites-credentials.json";
const CONFIG_PATH =
  process.env.CONFIG_PATH || "/root/wp-sites-config.json";
const DEPLOY_SCRIPT =
  process.env.DEPLOY_SCRIPT_PATH || "/home/ubuntu/wp-bulk-generator/scripts/deploy-wp-sites.sh";
const SECONDARY_PROXY_SYNC_SCRIPT =
  process.env.SECONDARY_PROXY_SYNC_SCRIPT ||
  join(getPrimaryServerTarget().repoRoot, "scripts", "sync-secondary-proxies.sh");
const MIN_BATCH_FREE_KB_HEADROOM =
  Number(process.env.MIN_BATCH_FREE_KB_HEADROOM || 524288);
const ESTIMATED_SITE_DISK_KB =
  Number(process.env.ESTIMATED_SITE_DISK_KB || 153600);
const DEPLOY_CACHE_WARM_TIMEOUT_MS =
  Number(process.env.DEPLOY_CACHE_WARM_TIMEOUT_MS || 12000);
const DEPLOY_CACHE_WARM_CONCURRENCY =
  Math.max(1, Number(process.env.DEPLOY_CACHE_WARM_CONCURRENCY || 4));
const DEPLOY_BING_SYNC_CONCURRENCY = Math.max(
  1,
  Number(process.env.DEPLOY_BING_SYNC_CONCURRENCY || 3)
);

type DeployConfig = {
  site_slug?: string;
  domain?: string;
  server_id?: string;
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
  app_pass?: string;
  site_dir?: string;
  server_id?: string;
  server_host?: string;
  server_user?: string;
  server_key_path?: string;
  server_site_root?: string;
  server_repo_root?: string;
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
    const raw = execSync(
      `sudo test -f ${shellQuote(CREDS_PATH)} && sudo cat ${shellQuote(CREDS_PATH)} || printf "[]"`,
      { timeout: 10000 }
    ).toString();
    return JSON.parse(raw);
  } catch { return []; }
}

function readExistingConfigs(): DeployConfig[] {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    }
    const raw = execSync(
      `sudo test -f ${shellQuote(CONFIG_PATH)} && sudo cat ${shellQuote(CONFIG_PATH)} || printf "[]"`,
      { timeout: 10000 }
    ).toString();
    return JSON.parse(raw);
  } catch { return []; }
}

function writeJson(path: string, data: unknown) {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function parseFreeDiskKb(raw: string) {
  const value = Number(String(raw).trim());
  return Number.isFinite(value) ? value : 0;
}

function getTargetFreeDiskKb(target: ServerTarget) {
  if (!isRemoteTarget(target)) {
    const raw = execSync("df -Pk / | awk 'NR==2 {print $4}'", {
      timeout: 10000,
    }).toString();
    return parseFreeDiskKb(raw);
  }

  const raw = execSsh(target, "df -Pk / | awk 'NR==2 {print $4}'", 15000);
  return parseFreeDiskKb(raw);
}

function estimateRequiredDiskKb(siteCount: number) {
  return MIN_BATCH_FREE_KB_HEADROOM + siteCount * ESTIMATED_SITE_DISK_KB;
}

function pickDeployTarget(siteCount: number): {
  target: ServerTarget;
  message?: string;
} {
  const preferred = getDefaultDeployTarget();
  const requiredKb = estimateRequiredDiskKb(siteCount);
  const preferredFreeKb = getTargetFreeDiskKb(preferred);

  if (preferredFreeKb >= requiredKb) {
    return { target: preferred };
  }

  const primary = getPrimaryServerTarget();
  if (isRemoteTarget(preferred) && preferred.id !== primary.id) {
    const primaryFreeKb = getTargetFreeDiskKb(primary);
    if (primaryFreeKb >= requiredKb) {
      return {
        target: primary,
        message:
          `기본 배포 서버(${preferred.host}) 디스크가 부족해 기존 서버로 우회합니다. ` +
          `(필요 약 ${Math.ceil(requiredKb / 1024)}MB, ` +
          `${preferred.host} 여유 약 ${Math.floor(preferredFreeKb / 1024)}MB, ` +
          `기존 서버 여유 약 ${Math.floor(primaryFreeKb / 1024)}MB)`,
      };
    }
  }

  throw new Error(
    `배포 서버 디스크 공간이 부족합니다. ` +
      `(필요 약 ${Math.ceil(requiredKb / 1024)}MB, ` +
      `${preferred.id}${preferred.host ? ` ${preferred.host}` : ""} 여유 약 ${Math.floor(preferredFreeKb / 1024)}MB)`
  );
}

function getCredentialKey(site: DeployConfig): string {
  return normalizeSlug(site.site_slug) || normalizeSlug((site as StoredCredential).slug) || normalizeDomain(site.domain);
}

function mergeCredentials(
  existing: StoredCredential[],
  incoming: StoredCredential[]
): StoredCredential[] {
  const merged = new Map<string, StoredCredential>();

  for (const item of existing) {
    const key = getCredentialKey(item);
    if (!key) continue;
    merged.set(key, item);
  }

  for (const item of incoming) {
    const key = getCredentialKey(item);
    if (!key) continue;
    merged.set(key, item);
  }

  return Array.from(merged.values());
}

function mergeConfigs(
  existing: DeployConfig[],
  incoming: DeployConfig[]
): DeployConfig[] {
  const merged = new Map<string, DeployConfig>();

  for (const item of existing) {
    const key = getCredentialKey(item);
    if (!key) continue;
    merged.set(key, item);
  }

  for (const item of incoming) {
    const key = getCredentialKey(item);
    if (!key) continue;
    merged.set(key, item);
  }

  return Array.from(merged.values());
}

function filterMatchedCredentials(
  credentials: StoredCredential[],
  configs: DeployConfig[]
): StoredCredential[] {
  const requestedSlugs = new Set(
    configs.map((cfg) => normalizeSlug(cfg.site_slug)).filter(Boolean)
  );
  const requestedDomains = new Set(
    configs.map((cfg) => normalizeDomain(cfg.domain)).filter(Boolean)
  );

  return credentials.filter((site) => {
    const slug = normalizeSlug(site.slug || site.site_slug);
    const domain = normalizeDomain(site.domain);
    return requestedSlugs.has(slug) || requestedDomains.has(domain);
  });
}

function applyTargetMetadata(
  credentials: StoredCredential[],
  target: ServerTarget
): StoredCredential[] {
  if (!isRemoteTarget(target)) {
    return credentials;
  }

  return credentials.map((site) => ({
    ...site,
    server_id: target.id,
    server_host: target.host,
    server_user: target.user,
    server_key_path: target.keyPath,
    server_site_root: target.siteRoot,
    server_repo_root: target.repoRoot,
  }));
}

function buildSiteWarmTargets(siteUrl: string): string[] {
  const baseUrl = siteUrl.replace(/\/$/, "");
  return [
    `${baseUrl}/`,
    `${baseUrl}/robots.txt`,
    `${baseUrl}/sitemap_index.xml`,
    `${baseUrl}/wp-sitemap.xml`,
  ];
}

async function warmDeployedSites(
  sites: Array<{ url: string }>
): Promise<void> {
  const urls = Array.from(
    new Set(
      sites.flatMap((site) => buildSiteWarmTargets(site.url)).filter(Boolean)
    )
  );

  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(DEPLOY_CACHE_WARM_CONCURRENCY, urls.length) },
    async () => {
      while (cursor < urls.length) {
        const index = cursor++;
        const url = urls[index];
        try {
          const res = await fetch(url, {
            method: "GET",
            cache: "no-store",
            headers: { "User-Agent": "WPBulkDeployWarmer/1.0" },
            signal: AbortSignal.timeout(DEPLOY_CACHE_WARM_TIMEOUT_MS),
          });
          await res.arrayBuffer();
        } catch {
          // best-effort cache warm
        }
      }
    }
  );

  await Promise.allSettled(workers);
}

async function syncDeployedSitesWithBing(
  sites: Array<{ url: string }>,
  onLog: (message: string) => void
): Promise<void> {
  if (!isBingWebmasterSyncEnabled()) {
    return;
  }

  const urls = Array.from(
    new Set(
      sites
        .map((site) => String(site.url || "").trim())
        .filter(Boolean)
    )
  );

  if (urls.length === 0) {
    return;
  }

  let cursor = 0;
  let addedCount = 0;
  let feedCount = 0;
  let errorCount = 0;

  const workers = Array.from(
    { length: Math.min(DEPLOY_BING_SYNC_CONCURRENCY, urls.length) },
    async () => {
      while (cursor < urls.length) {
        const index = cursor++;
        const url = urls[index];

        try {
          const result = await syncBingSite(url);
          if (result.added) addedCount += 1;
          if (result.feedSubmitted) feedCount += 1;
          for (const note of result.notes) {
            onLog(`Bing sync note: ${result.siteUrl} - ${note}`);
          }

          if (result.errors.length > 0) {
            errorCount += 1;
            onLog(
              `Bing sync partial: ${result.siteUrl} (add=${result.added ? "ok" : "fail"}, sitemap=${result.feedSubmitted ? "ok" : "fail"})`
            );
            for (const error of result.errors) {
              onLog(`Bing sync error: ${error}`);
            }
          } else {
            onLog(`Bing sync ok: ${result.siteUrl}`);
          }
        } catch (error) {
          errorCount += 1;
          onLog(
            `Bing sync failed: ${url} - ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    }
  );

  await Promise.allSettled(workers);
  onLog(
    `Bing sync summary: ${urls.length}개 사이트, add ${addedCount}건, sitemap ${feedCount}건, 오류 ${errorCount}건`
  );
}

function syncLocalCaches(credentials: StoredCredential[], configs: DeployConfig[]) {
  const primary = getPrimaryServerTarget();
  const cacheDir = join(primary.repoRoot, "admin", ".cache");

  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }

  try {
    writeFileSync(`${cacheDir}/sites-credentials.json`, JSON.stringify(credentials, null, 2));
    writeFileSync(`${cacheDir}/sites-config.json`, JSON.stringify(configs, null, 2));
  } catch {
    // ignore cache mirror failures
  }
}

function readTargetCredentials(target: ServerTarget): StoredCredential[] {
  try {
    if (!isRemoteTarget(target)) {
      return readExistingSites() as StoredCredential[];
    }

    const raw = execSsh(
      target,
      `sudo cat ${shellQuote("/root/wp-sites-credentials.json")}`,
      20000
    );
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function createDeployProcess(
  target: ServerTarget,
  configs: DeployConfig[]
): {
  child: ReturnType<typeof spawn>;
  cleanup: () => void;
} {
  const tempDir = mkdtempSync(join(tmpdir(), "wpbulk-deploy-"));
  const localConfigPath = join(tempDir, "sites-config.json");
  writeFileSync(localConfigPath, JSON.stringify(configs, null, 2));

  if (!isRemoteTarget(target)) {
    const child = spawn("sudo", ["bash", DEPLOY_SCRIPT, localConfigPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    return {
      child,
      cleanup: () => {
        rmSync(tempDir, { recursive: true, force: true });
      },
    };
  }

  const remoteConfigPath = execSsh(
    target,
    "mktemp /tmp/sites-config-deploy-XXXXXX.json",
    15000
  );
  scpToTarget(target, localConfigPath, remoteConfigPath, 60000);

  const scriptPath = `${target.repoRoot}/scripts/deploy-wp-sites.sh`;
  const remoteCommand = `sudo bash ${shellQuote(scriptPath)} ${shellQuote(remoteConfigPath)}`;
  const child = spawnSsh(target, remoteCommand);

  return {
    child,
    cleanup: () => {
      try {
        execSsh(target, `rm -f ${shellQuote(remoteConfigPath)}`, 15000);
      } catch {
        // ignore cleanup failures
      }
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
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

function runSecondaryProxySync() {
  if (!existsSync(SECONDARY_PROXY_SYNC_SCRIPT)) {
    return "";
  }

  return execSync(`sudo bash ${shellQuote(SECONDARY_PROXY_SYNC_SCRIPT)}`, {
    timeout: 10 * 60 * 1000,
  }).toString();
}

function appendChunkLines(
  pending: string,
  data: string | Buffer,
  onLine: (line: string) => void
): string {
  const text = typeof data === "string" ? data : data.toString("utf8");
  const combined = pending + text;
  const lines = combined.split(/\r?\n/);
  const remainder = lines.pop() ?? "";

  for (const line of lines) {
    if (line) {
      onLine(line);
    }
  }

  return remainder;
}

export async function deployRoutes(app: FastifyInstance) {
  // proxy sync만 단독 실행 (SSL 인증서 발급 + Nginx 설정 업데이트)
  app.post("/deploy/proxy-sync", async (req, reply) => {
    const { send, close } = setupSSE(reply);
    try {
      send({ type: "log", message: "--- primary proxy sync 시작 ---" });
      const output = runSecondaryProxySync();
      for (const line of output.split(/\r?\n/).filter(Boolean)) {
        send({ type: "log", message: line });
      }
      send({ type: "done", message: "proxy sync 완료" });
    } catch (error) {
      const stdout =
        error && typeof error === "object" && "stdout" in error && Buffer.isBuffer((error as { stdout?: unknown }).stdout)
          ? (error as { stdout: Buffer }).stdout.toString("utf8") : "";
      const stderr =
        error && typeof error === "object" && "stderr" in error && Buffer.isBuffer((error as { stderr?: unknown }).stderr)
          ? (error as { stderr: Buffer }).stderr.toString("utf8") : "";
      for (const line of `${stdout}\n${stderr}`.split(/\r?\n/).filter(Boolean)) {
        send({ type: "log", message: line });
      }
      send({ type: "error", message: "proxy sync 실패" });
    } finally {
      close();
    }
  });

  // 기존 사이트의 robots.txt http→https 수정 (모든 서버 대상)
  app.post("/deploy/refresh-static-files", async (req, reply) => {
    const { send, close } = setupSSE(reply);
    try {
      // Primary + Secondary 서버 모두 처리
      const targets: ServerTarget[] = [getPrimaryServerTarget()];
      const secondary = getSecondaryServerTarget();
      if (secondary) targets.push(secondary);

      let totalUpdated = 0;
      for (const target of targets) {
        const siteRoot = target.siteRoot;
        // robots.txt 내 http:// → https:// 일괄 치환
        const cmd = `find ${siteRoot} -maxdepth 2 -name robots.txt -exec grep -l 'http://' {} \\; 2>/dev/null | while read f; do sed -i 's|http://|https://|g' "$f" && echo "✓ $f"; done; echo "DONE"`;

        try {
          let output: string;
          if (isRemoteTarget(target)) {
            output = execSsh(target, cmd, 30000);
          } else {
            output = execSync(cmd, { encoding: "utf8", timeout: 30000 }).trim();
          }
          for (const line of output.split(/\r?\n/).filter(Boolean)) {
            if (line === "DONE") continue;
            send({ type: "log", message: `[${target.id}] ${line}` });
            totalUpdated++;
          }
        } catch (err) {
          send({ type: "log", message: `[${target.id}] ⚠ ${err instanceof Error ? err.message : String(err)}` });
        }
      }

      send({ type: "done", message: `완료: ${totalUpdated}개 robots.txt 갱신` });
    } catch (error) {
      send({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      close();
    }
  });

  // 모든 myground 사이트의 sitemap을 Bing에 일괄 제출
  app.post("/deploy/submit-sitemaps", async (req, reply) => {
    const { send, close } = setupSSE(reply);
    try {
      const sites = readExistingSites() as StoredCredential[];
      const mygroundSites = sites.filter(
        (s) => s.domain && (s.domain.includes("myground.website"))
      );
      send({ type: "log", message: `myground 사이트 ${mygroundSites.length}개 발견` });

      let successCount = 0;
      for (const site of mygroundSites) {
        const domain = site.domain!;
        try {
          const siteUrl = `https://${domain}`;
          const result = await syncBingSite(siteUrl);
          const status = result.feedSubmitted ? "✓ sitemap 제출" : "⚠ sitemap 실패";
          send({ type: "log", message: `  ${status}: ${domain}` });
          if (result.errors.length > 0) {
            for (const err of result.errors) {
              send({ type: "log", message: `    ${err}` });
            }
          }
          if (result.feedSubmitted) successCount++;
        } catch (err) {
          send({ type: "log", message: `  ✗ ${domain}: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
      send({ type: "done", message: `완료: ${successCount}/${mygroundSites.length}개 sitemap 제출` });
    } catch (error) {
      send({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      close();
    }
  });

  // 기존 발행된 모든 WP 글을 Bing SubmitUrlBatch + IndexNow로 일괄 재제출
  // 요청 body (모두 optional):
  //   { domainFilter?: string, slugs?: string[], perSiteLimit?: number }
  app.post("/deploy/resubmit-bing-urls", async (req, reply) => {
    const { send, close } = setupSSE(reply);
    const body = (req.body || {}) as {
      domainFilter?: string;
      slugs?: string[];
      perSiteLimit?: number;
    };
    const perSiteLimit = Math.min(Math.max(body.perSiteLimit || 200, 1), 1000);
    const slugFilter = body.slugs?.length
      ? new Set(body.slugs.map((s) => s.toLowerCase()))
      : null;

    try {
      const sites = readExistingSites() as StoredCredential[];
      let targets = sites.filter((s) => s.domain && !isExcludedSiteSlug(normalizeSlug(s.site_slug ?? s.slug)));
      if (body.domainFilter) {
        const needle = body.domainFilter.toLowerCase();
        targets = targets.filter((s) => (s.domain || "").toLowerCase().includes(needle));
      }
      if (slugFilter) {
        targets = targets.filter((s) => slugFilter.has(normalizeSlug(s.site_slug ?? s.slug)));
      }

      send({ type: "log", message: `대상 사이트 ${targets.length}개` });

      if (!isBingWebmasterSyncEnabled() && !isIndexNowEnabled()) {
        send({ type: "error", message: "BING_WEBMASTER_API_KEY / INDEXNOW_API_KEY 모두 미설정 — 아무것도 제출할 수 없습니다." });
        return;
      }

      let totalUrls = 0;
      let bingSubmitted = 0;
      let bingErrors = 0;
      let indexNowSubmitted = 0;
      let indexNowErrors = 0;

      for (const site of targets) {
        const domain = site.domain!;
        const host = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
        const base = `https://${host}`;

        // WP REST API 로 발행된 글 URL 수집 (페이지네이션)
        const urls: string[] = [];
        try {
          let page = 1;
          while (urls.length < perSiteLimit) {
            const perPage = Math.min(100, perSiteLimit - urls.length);
            const endpoint = `${base}/wp-json/wp/v2/posts?status=publish&per_page=${perPage}&page=${page}&_fields=link`;
            const res = await fetch(endpoint, {
              signal: AbortSignal.timeout(15000),
              headers: { "User-Agent": "wp-bulk-generator/resubmit" },
            });
            if (!res.ok) {
              if (res.status === 400 || res.status === 404) break; // 페이지 끝
              throw new Error(`HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 120)).catch(() => "")}`);
            }
            const items = (await res.json()) as Array<{ link?: string }>;
            if (!Array.isArray(items) || items.length === 0) break;
            for (const it of items) {
              if (it.link && typeof it.link === "string") {
                // 내부 http→https 방어
                urls.push(it.link.replace(/^http:\/\//, "https://"));
              }
            }
            if (items.length < perPage) break;
            page += 1;
          }
        } catch (err) {
          send({ type: "log", message: `  ✗ ${domain} URL 수집 실패: ${err instanceof Error ? err.message : String(err)}` });
          continue;
        }

        if (urls.length === 0) {
          send({ type: "log", message: `  - ${domain}: 발행 글 없음` });
          continue;
        }
        totalUrls += urls.length;
        send({ type: "log", message: `  • ${domain}: ${urls.length}개 URL 수집` });

        // Bing SubmitUrlBatch — BING_URL_SUBMISSION_ENABLED=false 면 건너뜀
        if (isBingUrlSubmissionEnabled(base)) {
          try {
            const result = await submitBingUrls(urls, base);
            bingSubmitted += result.submitted;
            if (result.errors.length > 0) {
              bingErrors += result.errors.length;
              send({ type: "log", message: `    Bing 경고: ${result.errors[0]}` });
            }
            send({ type: "log", message: `    ↳ Bing: ${result.submitted}건 제출 (batch ${result.batches})` });
          } catch (err) {
            bingErrors += 1;
            send({ type: "log", message: `    ✗ Bing 실패: ${err instanceof Error ? err.message : String(err)}` });
          }
        }

        // IndexNow (호스트별 일괄)
        if (isIndexNowEnabled()) {
          try {
            const result = await submitIndexNow(urls, host);
            if (result.success) {
              indexNowSubmitted += result.submitted;
              send({ type: "log", message: `    ↳ IndexNow: ${result.submitted}건 (${result.statusCode})` });
            } else if (result.error) {
              indexNowErrors += 1;
              send({ type: "log", message: `    ✗ IndexNow: ${result.error}` });
            }
          } catch (err) {
            indexNowErrors += 1;
            send({ type: "log", message: `    ✗ IndexNow 실패: ${err instanceof Error ? err.message : String(err)}` });
          }
        }
      }

      send({
        type: "done",
        message: `완료 — 수집 ${totalUrls}건 / Bing 제출 ${bingSubmitted} (오류 ${bingErrors}) / IndexNow 제출 ${indexNowSubmitted} (오류 ${indexNowErrors})`,
      });
    } catch (error) {
      send({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      close();
    }
  });

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
    const conflictReasons = new Map<string, string>();
    const deployableConfigs: DeployConfig[] = [];
    for (const c of configs) {
      const s = normalizeSlug(c.site_slug);
      if (s && existingSlugs.has(s)) {
        conflicts.push(s);
        conflictReasons.set(s, "이미 존재하는 사이트");
        continue;
      }
      deployableConfigs.push(c);
    }

    const { send, close } = setupSSE(reply);
    let deployCleanup: () => void = () => undefined;

    try {
      let completed = 0;
      let successCount = 0;
      let failureCount = 0;
      const successfulSlugs = new Set<string>();
      const failedSites: DeployFailure[] = conflicts.map((slug) => ({
        slug,
        reason: conflictReasons.get(slug) || "이미 존재하는 사이트",
      }));

      if (conflicts.length > 0) {
        failureCount += conflicts.length;
        for (const slug of conflicts) {
          completed += 1;
          send({
            type: "progress",
            progress: completed,
            total: configs.length,
            currentSite: slug,
            message: `${slug} 건너뜀: 이미 존재하는 사이트 (${completed}/${configs.length})`,
          });
        }
      }

      if (deployableConfigs.length === 0) {
        send({
          type: "done",
          status: "done",
          progress: configs.length,
          total: configs.length,
          currentSite: "",
          successCount,
          failureCount,
          failedSites,
          message: `배포 완료 (${successCount}개 성공, ${failureCount}개 실패)`,
        });
        return;
      }

      const { target: deployTarget, message: targetSelectionMessage } =
        pickDeployTarget(deployableConfigs.length);
      const configsToPersist = deployableConfigs.map((config) =>
        isRemoteTarget(deployTarget)
          ? { ...config, server_id: deployTarget.id }
          : config
      );

      if (targetSelectionMessage) {
        send({ type: "log", message: targetSelectionMessage });
      }

      send({
        type: "progress",
        message: isRemoteTarget(deployTarget)
          ? `배포 스크립트 실행 시작... (${deployTarget.host})`
          : "배포 스크립트 실행 시작...",
      });

      const { child, cleanup } = createDeployProcess(deployTarget, deployableConfigs);
      deployCleanup = cleanup;

      let pendingStdout = "";
      let pendingStderr = "";

      const handleStdoutLine = (line: string) => {
        const marker = parseDeployMarker(line);
        if (!marker) {
          send({ type: "log", message: line });
          return;
        }

        if (marker.type === "site_start") {
          send({
            type: "progress",
            progress: completed,
            total: configs.length,
            currentSite: marker.title || marker.slug,
            message: `[${completed + marker.index}/${configs.length}] ${marker.title || marker.slug} 설치 중...`,
          });
          return;
        }

        if (marker.type === "site_retry") {
          send({
            type: "log",
            message: `${marker.slug} 재시도 (${marker.attempt}/${marker.maxAttempts})${marker.reason ? ` - ${marker.reason}` : ""}`,
          });
          return;
        }

        if (marker.type === "site_success") {
          completed += 1;
          successCount += 1;
          successfulSlugs.add(marker.slug);
          send({
            type: "progress",
            progress: completed,
            total: configs.length,
            currentSite: marker.title || marker.slug,
            message: `${marker.title || marker.slug} 설치 완료 (${completed}/${configs.length})`,
          });
          return;
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
          return;
        }

        if (marker.type === "summary") {
          successCount = Math.max(successCount, marker.successCount);
          failureCount = Math.max(failureCount, conflicts.length + marker.failureCount);
        }
      };

      child.stdout?.on("data", (data) => {
        pendingStdout = appendChunkLines(pendingStdout, data, handleStdoutLine);
      });

      child.stderr?.on("data", (data) => {
        pendingStderr = appendChunkLines(pendingStderr, data, (line) => {
          send({ type: "log", message: `[stderr] ${line}` });
        });
      });

      await new Promise<void>((resolve, reject) => {
        child.on("close", (code) => {
          if (pendingStdout) {
            handleStdoutLine(pendingStdout);
            pendingStdout = "";
          }
          if (pendingStderr) {
            send({ type: "log", message: `[stderr] ${pendingStderr}` });
            pendingStderr = "";
          }
          if (code === 0) resolve();
          else reject(new Error(`배포 스크립트 종료 코드: ${code}`));
        });
        child.on("error", reject);
      });
      deployCleanup();
      deployCleanup = () => undefined;

      const existingConfigs = readExistingConfigs();
      const targetCredentials = readTargetCredentials(deployTarget);
      const matchedCredentials = applyTargetMetadata(
        filterMatchedCredentials(targetCredentials, deployableConfigs),
        deployTarget
      );
      const mergedCredentials = mergeCredentials(
        readExistingSites() as StoredCredential[],
        matchedCredentials
      );
      const mergedConfigs = mergeConfigs(existingConfigs, configsToPersist);

      writeJson(CREDS_PATH, mergedCredentials);
      writeJson(CONFIG_PATH, mergedConfigs);
      syncLocalCaches(mergedCredentials, mergedConfigs);

      if (isRemoteTarget(deployTarget)) {
        send({ type: "log", message: "--- primary proxy sync ---" });
        try {
          const proxySyncOutput = runSecondaryProxySync();
          for (const line of proxySyncOutput.split(/\r?\n/).filter(Boolean)) {
            send({ type: "log", message: line });
          }
        } catch (error) {
          const stdout =
            error &&
            typeof error === "object" &&
            "stdout" in error &&
            Buffer.isBuffer((error as { stdout?: unknown }).stdout)
              ? (error as { stdout: Buffer }).stdout.toString("utf8")
              : "";
          const stderr =
            error &&
            typeof error === "object" &&
            "stderr" in error &&
            Buffer.isBuffer((error as { stderr?: unknown }).stderr)
              ? (error as { stderr: Buffer }).stderr.toString("utf8")
              : "";

          for (const line of `${stdout}\n${stderr}`.split(/\r?\n/).filter(Boolean)) {
            send({ type: "log", message: line });
          }

          send({
            type: "log",
            message: "⚠ primary proxy sync failed; secondary sites may stay inaccessible until sync completes.",
          });
        }
      }

      const credentialsSummary = summarizeDeployCredentials(
        mergedCredentials,
        deployableConfigs
      );

      if (credentialsSummary) {
        const successfulSites = credentialsSummary.sites
          .filter((site) => successfulSlugs.size === 0 || successfulSlugs.has(site.slug))
        const cacheSeedEntries = successfulSites
          .map((site) => ({
            slug: site.slug,
            entry: {
              posts: [],
              totalCount: 0,
              cachedAt: Date.now(),
              error: false,
            },
          }));

        if (cacheSeedEntries.length > 0) {
          await seedDashboardSiteCaches(cacheSeedEntries);
        }

        if (successfulSites.length > 0) {
          void warmDeployedSites(successfulSites);
          void syncDeployedSitesWithBing(successfulSites, (message) => {
            send({ type: "log", message });
          });
        }

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
      deployCleanup();
      close();
    }
  });

  // 단일 사이트의 AEO 관련 설정을 즉시 재적용.
  // (1) credentials 에 persona.slug 영구 저장
  // (2) MU-plugin(ai-seo-optimize.php) 재설치 — Yoast wordCount 필터 등 최신 상태로
  // (3) WP object cache flush
  // (4) WP user 의 display_name/description/slug 를 persona 로 동기화
  // body: { slug: string, personaSlug?: string }
  app.post("/deploy/refresh-aeo", async (req, reply) => {
    type RefreshBody = { slug?: string; personaSlug?: string };
    type RefreshCredential = StoredCredential & {
      persona?: { name: string; bio?: string; slug?: string };
    };
    const body = (req.body || {}) as RefreshBody;
    const slug = String(body.slug || "").trim();
    const rawPersonaSlug = body.personaSlug ? String(body.personaSlug).trim() : "";
    if (!slug) {
      reply.code(400);
      return { error: "slug is required" };
    }

    let credentials: RefreshCredential[];
    try {
      credentials = JSON.parse(readFileSync(CREDS_PATH, "utf-8")) as RefreshCredential[];
    } catch (e) {
      reply.code(500);
      return {
        error: `failed to load credentials (${CREDS_PATH}): ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }

    const siteIndex = credentials.findIndex(
      (c) => (c.slug || c.site_slug) === slug
    );
    if (siteIndex < 0) {
      reply.code(404);
      return { error: `site not found: ${slug}` };
    }
    const site = credentials[siteIndex];
    const result: Record<string, unknown> = { slug };

    // 1. credentials 에 personaSlug 영구 저장
    if (rawPersonaSlug) {
      const sanitized = rawPersonaSlug
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (sanitized) {
        const existingPersona = site.persona || { name: "" };
        if (existingPersona.slug !== sanitized) {
          existingPersona.slug = sanitized;
          site.persona = existingPersona;
          credentials[siteIndex] = site;
          try {
            writeFileSync(CREDS_PATH, JSON.stringify(credentials, null, 2));
            result.credentialsUpdated = { personaSlug: sanitized };
          } catch (e) {
            result.credentialsUpdateError =
              e instanceof Error ? e.message : String(e);
          }
        } else {
          result.credentialsUpdated = { personaSlug: sanitized, noChange: true };
        }
      }
    }

    // 2. MU-plugin 재설치 (sudo bash)
    const siteDir = `/var/www/${slug}`;
    try {
      execSync(
        `sudo -n bash -c "cd /home/ubuntu/wp-bulk-generator && source scripts/deploy-wp-sites.sh && ensure_seo_mu_plugin '${siteDir}'"`,
        { stdio: "pipe", timeout: 30000 }
      );
      result.muPluginUpdated = true;
    } catch (e) {
      result.muPluginError =
        e instanceof Error ? e.message.slice(0, 400) : String(e).slice(0, 400);
    }

    // 3. WP object cache flush
    try {
      execSync(
        `sudo -n wp cache flush --path="${siteDir}" --allow-root`,
        { stdio: "pipe", timeout: 15000 }
      );
      result.cacheFlushed = true;
    } catch (e) {
      result.cacheFlushError =
        e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
    }

    // 4. WP user 동기화 (display_name/description/slug → persona)
    const domainRaw = site.domain || "";
    const host = domainRaw.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const adminUser = site.admin_user || "";
    const appPass = site.app_pass || "";
    if (host && adminUser && appPass) {
      const baseUrl = `https://${host}`;
      const authHeader =
        "Basic " + Buffer.from(`${adminUser}:${appPass}`).toString("base64");
      const syncResult = await syncWpAuthorFromPersona(
        { slug, persona: site.persona },
        baseUrl,
        { "Content-Type": "application/json", Authorization: authHeader }
      );
      result.authorSync = syncResult;
    } else {
      result.authorSync = {
        updated: false,
        error: "missing domain/admin_user/app_pass in credentials",
      };
    }

    return result;
  });
}
