import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { FastifyInstance } from "fastify";
import { tmpdir } from "os";
import { join } from "path";
import { setupSSE } from "../utils/sse.js";
import { fetchCredentials, fetchGroups } from "../lib/ec2-client.js";

type SiteCredential = {
  slug: string;
  domain: string;
  title: string;
  url: string;
  admin_user: string;
  admin_pass: string;
  app_pass: string;
  site_dir?: string;
};

type WPPost = {
  id: number;
  title: { rendered: string };
  link: string;
  date: string;
  status: string;
};

type CacheEntry = {
  posts: WPPost[];
  totalCount: number;
  cachedAt: number;
};

type SiteGroup = {
  id: string;
  name: string;
  slugs: string[];
  createdAt: string;
};

// 인메모리 캐시 (TTL 5분)
const CACHE_TTL = 5 * 60 * 1000;
const postCache = new Map<string, CacheEntry>();
const WP_SITES_ROOT = process.env.WP_SITES_ROOT || "/var/www";

type RemotePostsResult = {
  ok: boolean;
  posts: WPPost[];
};

type RemoteCountResult = {
  ok: boolean;
  totalCount: number;
};

function getLocalSiteDir(site: SiteCredential): string {
  return site.site_dir || join(WP_SITES_ROOT, site.slug);
}

function hasLocalWordPress(site: SiteCredential): boolean {
  return existsSync(join(getLocalSiteDir(site), "wp-config.php"));
}

async function fetchRemoteWPPosts(site: SiteCredential, perPage = 15): Promise<RemotePostsResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const auth = Buffer.from(`${site.admin_user}:${site.app_pass}`).toString("base64");
    const res = await fetch(
      `${site.url}/wp-json/wp/v2/posts?per_page=${perPage}&_fields=id,title,link,date,status&status=publish&orderby=date&order=desc`,
      { headers: { Authorization: `Basic ${auth}` }, signal: controller.signal }
    );
    if (!res.ok) return { ok: false, posts: [] };
    const data = await res.json();
    return { ok: true, posts: Array.isArray(data) ? data : [] };
  } catch { return { ok: false, posts: [] }; }
  finally { clearTimeout(timeout); }
}

async function fetchRemoteWPPostCount(site: SiteCredential): Promise<RemoteCountResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const auth = Buffer.from(`${site.admin_user}:${site.app_pass}`).toString("base64");
    const res = await fetch(
      `${site.url}/wp-json/wp/v2/posts?per_page=1&_fields=id&status=publish`,
      { headers: { Authorization: `Basic ${auth}` }, signal: controller.signal }
    );
    if (!res.ok) return { ok: false, totalCount: 0 };
    const total = res.headers.get("X-WP-Total");
    return { ok: true, totalCount: total ? parseInt(total, 10) : 0 };
  } catch { return { ok: false, totalCount: 0 }; }
  finally { clearTimeout(timeout); }
}

function fetchLocalSiteData(site: SiteCredential, perPage = 15): CacheEntry {
  const siteDir = getLocalSiteDir(site);
  const tempDir = mkdtempSync(join(tmpdir(), "wpbulk-dashboard-"));
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

    const parsed = JSON.parse(output) as Partial<CacheEntry>;

    return {
      posts: Array.isArray(parsed.posts) ? parsed.posts as WPPost[] : [],
      totalCount: typeof parsed.totalCount === "number" ? parsed.totalCount : 0,
      cachedAt: Date.now(),
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function fetchSiteData(site: SiteCredential): Promise<CacheEntry> {
  const cached = postCache.get(site.slug);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached;
  }

  const [postsResult, countResult] = await Promise.all([
    fetchRemoteWPPosts(site, 15),
    fetchRemoteWPPostCount(site),
  ]);

  if (!postsResult.ok || !countResult.ok) {
    if (!hasLocalWordPress(site)) {
      throw new Error(`WordPress unavailable for ${site.slug}`);
    }

    const localEntry = fetchLocalSiteData(site, 15);
    postCache.set(site.slug, localEntry);
    return localEntry;
  }

  const entry: CacheEntry = {
    posts: postsResult.posts,
    totalCount: countResult.totalCount,
    cachedAt: Date.now(),
  };
  postCache.set(site.slug, entry);
  return entry;
}

function normalizeGroups(input: unknown): SiteGroup[] {
  if (Array.isArray(input)) {
    return input as SiteGroup[];
  }

  if (
    input &&
    typeof input === "object" &&
    Array.isArray((input as { groups?: unknown[] }).groups)
  ) {
    return (input as { groups: SiteGroup[] }).groups;
  }

  return [];
}

function normalizeSites(input: unknown): SiteCredential[] {
  return Array.isArray(input) ? (input as SiteCredential[]) : [];
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/dashboard", async (_req, reply) => {
    const { send, close } = setupSSE(reply);

    try {
      const sitesRaw = await fetchCredentials();
      const sites = normalizeSites(sitesRaw);
      const groups = normalizeGroups(await fetchGroups());

      send({ type: "meta", sites, groups });

      const BATCH_SIZE = 3;
      for (let i = 0; i < sites.length; i += BATCH_SIZE) {
        const batch = sites.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (site) => {
            try {
              const { posts, totalCount } = await fetchSiteData(site);
              send({ type: "posts", slug: site.slug, posts, totalCount });
            } catch {
              send({ type: "posts", slug: site.slug, posts: [], totalCount: 0, error: true });
            }
          })
        );
      }

      send({ type: "done" });
    } catch (err) {
      send({ type: "error", message: String(err) });
    } finally {
      close();
    }
  });
}
