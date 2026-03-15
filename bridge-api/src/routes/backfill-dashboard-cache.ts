import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { FastifyInstance } from "fastify";
import { tmpdir } from "os";
import { join } from "path";
import {
  setDashboardSiteCache,
  type DashboardCacheEntry,
  type DashboardPost,
} from "../lib/dashboard-cache.js";
import { fetchCredentials } from "../lib/ec2-client.js";
import {
  getSiteDirForTarget,
  isRemoteTarget,
  resolveSiteTarget,
} from "../lib/server-targets.js";
import { execSsh, scpToTarget, shellQuote } from "../lib/ssh.js";
import { setupSSE } from "../utils/sse.js";

type SiteCredential = {
  slug: string;
  domain: string;
  title: string;
  url: string;
  admin_user: string;
  admin_pass: string;
  app_pass: string;
  site_dir?: string;
  server_id?: string;
  server_host?: string;
  server_user?: string;
  server_key_path?: string;
  server_site_root?: string;
  server_repo_root?: string;
};

const WP_SITES_ROOT = process.env.WP_SITES_ROOT || "/var/www";
const REMOTE_FETCH_TIMEOUT_MS = Number(process.env.WP_REMOTE_FETCH_TIMEOUT_MS || 12000);

function normalizeSites(input: unknown): SiteCredential[] {
  return Array.isArray(input) ? (input as SiteCredential[]) : [];
}

function normalizeSlugs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((slug) => (typeof slug === "string" ? slug.trim().toLowerCase() : ""))
    .filter((slug) => /^[a-z0-9-]{2,40}$/.test(slug));
}

function getLocalSiteDir(site: SiteCredential): string {
  return getSiteDirForTarget(site, resolveSiteTarget(site));
}

function hasLocalWordPress(site: SiteCredential): boolean {
  const target = resolveSiteTarget(site);
  const siteDir = getLocalSiteDir(site);

  if (!isRemoteTarget(target)) {
    return existsSync(join(siteDir, "wp-config.php"));
  }

  try {
    execSsh(
      target,
      `[ -f ${shellQuote(join(siteDir, "wp-config.php"))} ] && echo ok`,
      15000
    );
    return true;
  } catch {
    return false;
  }
}

function fetchLocalSiteData(site: SiteCredential, perPage = 15): DashboardCacheEntry {
  const siteDir = getLocalSiteDir(site);
  const tempDir = mkdtempSync(join(tmpdir(), "wpbulk-cache-backfill-"));
  const scriptPath = join(tempDir, "dashboard-local.php");

  try {
    writeFileSync(
      scriptPath,
      `<?php
$posts = get_posts([
  'post_type' => 'post',
  'post_status' => 'publish',
  'posts_per_page' => ${perPage},
  'orderby' => 'date',
  'order' => 'DESC',
]);

$payload = array_map(function ($post) {
  return [
    'id' => (int) $post->ID,
    'title' => ['rendered' => (string) get_the_title($post)],
    'link' => (string) get_permalink($post),
    'date' => (string) get_post_time(DATE_ATOM, true, $post),
    'status' => 'publish',
  ];
}, $posts);

$counts = wp_count_posts('post');
$total_count = isset($counts->publish) ? (int) $counts->publish : count($payload);

echo wp_json_encode([
  'posts' => $payload,
  'totalCount' => $total_count,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
`
    );

    const output = execFileSync(
      "wp",
      ["eval-file", scriptPath, `--path=${siteDir}`, "--allow-root"],
      { encoding: "utf8", timeout: 45000 }
    ).trim();

    const parsed = JSON.parse(output) as Partial<DashboardCacheEntry>;

    return {
      posts: Array.isArray(parsed.posts) ? (parsed.posts as DashboardPost[]) : [],
      totalCount: typeof parsed.totalCount === "number" ? parsed.totalCount : 0,
      cachedAt: Date.now(),
      error: false,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function fetchRemoteSiteDataViaSsh(
  site: SiteCredential,
  perPage = 15
): DashboardCacheEntry {
  const target = resolveSiteTarget(site);
  const siteDir = getLocalSiteDir(site);
  const tempDir = mkdtempSync(join(tmpdir(), "wpbulk-cache-remote-"));
  const scriptPath = join(tempDir, "dashboard-local.php");
  const remoteTempDir = `/tmp/wpbulk-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const remoteScriptPath = `${remoteTempDir}/dashboard-local.php`;

  try {
    writeFileSync(
      scriptPath,
      `<?php
$posts = get_posts([
  'post_type' => 'post',
  'post_status' => 'publish',
  'posts_per_page' => ${perPage},
  'orderby' => 'date',
  'order' => 'DESC',
]);

$payload = array_map(function ($post) {
  return [
    'id' => (int) $post->ID,
    'title' => ['rendered' => (string) get_the_title($post)],
    'link' => (string) get_permalink($post),
    'date' => (string) get_post_time(DATE_ATOM, true, $post),
    'status' => 'publish',
  ];
}, $posts);

$counts = wp_count_posts('post');
$total_count = isset($counts->publish) ? (int) $counts->publish : count($payload);

echo wp_json_encode([
  'posts' => $payload,
  'totalCount' => $total_count,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
`
    );

    execSsh(target, `mkdir -p ${shellQuote(remoteTempDir)}`, 15000);
    scpToTarget(target, scriptPath, remoteScriptPath, 30000);
    const output = execSsh(
      target,
      `wp eval-file ${shellQuote(remoteScriptPath)} --path=${shellQuote(siteDir)} --allow-root`,
      60000
    ).trim();

    const parsed = JSON.parse(output) as Partial<DashboardCacheEntry>;
    return {
      posts: Array.isArray(parsed.posts) ? (parsed.posts as DashboardPost[]) : [],
      totalCount: typeof parsed.totalCount === "number" ? parsed.totalCount : 0,
      cachedAt: Date.now(),
      error: false,
    };
  } finally {
    try {
      execSsh(target, `rm -rf ${shellQuote(remoteTempDir)}`, 15000);
    } catch {
      // ignore cleanup failures
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function fetchRemoteSiteData(site: SiteCredential, perPage = 15): Promise<DashboardCacheEntry> {
  const auth = Buffer.from(`${site.admin_user}:${site.app_pass}`).toString("base64");
  const headers = { Authorization: `Basic ${auth}` };

  const [postsRes, countRes] = await Promise.all([
    fetch(
      `${site.url}/wp-json/wp/v2/posts?per_page=${perPage}&_fields=id,title,link,date,status&status=publish&orderby=date&order=desc`,
      { headers, signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS) }
    ),
    fetch(
      `${site.url}/wp-json/wp/v2/posts?per_page=1&_fields=id&status=publish`,
      { headers, signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS) }
    ),
  ]);

  if (!postsRes.ok || !countRes.ok) {
    throw new Error(`원격 WordPress 조회 실패 (${postsRes.status}/${countRes.status})`);
  }

  const posts = await postsRes.json();
  const total = countRes.headers.get("X-WP-Total");

  return {
    posts: Array.isArray(posts) ? (posts as DashboardPost[]) : [],
    totalCount: total ? parseInt(total, 10) : Array.isArray(posts) ? posts.length : 0,
    cachedAt: Date.now(),
    error: false,
  };
}

async function resolveSiteCacheEntry(site: SiteCredential): Promise<{ entry: DashboardCacheEntry; source: "local" | "remote" }> {
  if (hasLocalWordPress(site)) {
    const target = resolveSiteTarget(site);
    if (isRemoteTarget(target)) {
      return { entry: fetchRemoteSiteDataViaSsh(site), source: "local" };
    }

    return { entry: fetchLocalSiteData(site), source: "local" };
  }

  try {
    return { entry: await fetchRemoteSiteData(site), source: "remote" };
  } catch (error) {
    if (!isRemoteTarget(resolveSiteTarget(site))) {
      throw error;
    }

    return { entry: fetchRemoteSiteDataViaSsh(site), source: "local" };
  }
}

export async function backfillDashboardCacheRoutes(app: FastifyInstance) {
  app.post("/backfill-dashboard-cache", async (req, reply) => {
    const body = (req.body || {}) as { slugs?: unknown };
    const targetSlugs = new Set(normalizeSlugs(body.slugs));

    const { send, close } = setupSSE(reply);

    try {
      const sites = normalizeSites(await fetchCredentials()).filter((site) =>
        targetSlugs.size > 0 ? targetSlugs.has(site.slug) : true
      );

      if (sites.length === 0) {
        send({
          type: "done",
          status: "done",
          successCount: 0,
          failureCount: 0,
          message: "캐시 백필 대상 사이트가 없습니다.",
        });
        return;
      }

      let successCount = 0;
      let failureCount = 0;

      for (let index = 0; index < sites.length; index += 1) {
        const site = sites[index];

        send({
          type: "progress",
          current: index + 1,
          total: sites.length,
          siteSlug: site.slug,
          message: `[${index + 1}/${sites.length}] ${site.slug} 캐시 백필 중...`,
        });

        try {
          const { entry, source } = await resolveSiteCacheEntry(site);
          await setDashboardSiteCache(site.slug, entry);
          successCount += 1;

          send({
            type: "site",
            siteSlug: site.slug,
            totalCount: entry.totalCount,
            posts: entry.posts,
            source,
            message: `${site.slug} 캐시 저장 완료 (${entry.totalCount}개, ${source})`,
          });
        } catch (error) {
          failureCount += 1;
          send({
            type: "log",
            siteSlug: site.slug,
            message: `${site.slug} 캐시 백필 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
          });
        }
      }

      send({
        type: "done",
        status: "done",
        successCount,
        failureCount,
        message: `대시보드 캐시 백필 완료 (${successCount}개 성공, ${failureCount}개 실패)`,
      });
    } catch (error) {
      send({
        type: "error",
        status: "error",
        message: error instanceof Error ? error.message : "대시보드 캐시 백필 중 알 수 없는 오류",
      });
    } finally {
      close();
    }
  });
}
