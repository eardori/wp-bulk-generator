import { execSync, spawn } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "fs";
import type { FastifyInstance } from "fastify";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { setupSSE } from "../utils/sse.js";
import { isExcludedSiteSlug } from "../lib/excluded-sites.js";
import { seedDashboardSiteCaches } from "../lib/dashboard-cache.js";
import {
  getDefaultDeployTarget,
  getPrimaryServerTarget,
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
        const cacheSeedEntries = credentialsSummary.sites
          .filter((site) => successfulSlugs.size === 0 || successfulSlugs.has(site.slug))
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
}
