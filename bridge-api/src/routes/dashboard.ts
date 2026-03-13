import type { FastifyInstance } from "fastify";
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

// 인메모리 캐시 (TTL 5분)
const CACHE_TTL = 5 * 60 * 1000;
const postCache = new Map<string, CacheEntry>();

async function fetchWPPosts(site: SiteCredential, perPage = 15): Promise<WPPost[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const auth = Buffer.from(`${site.admin_user}:${site.app_pass}`).toString("base64");
    const res = await fetch(
      `${site.url}/wp-json/wp/v2/posts?per_page=${perPage}&_fields=id,title,link,date,status&status=publish&orderby=date&order=desc`,
      { headers: { Authorization: `Basic ${auth}` }, signal: controller.signal }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch { return []; }
  finally { clearTimeout(timeout); }
}

async function fetchWPPostCount(site: SiteCredential): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const auth = Buffer.from(`${site.admin_user}:${site.app_pass}`).toString("base64");
    const res = await fetch(
      `${site.url}/wp-json/wp/v2/posts?per_page=1&_fields=id&status=publish`,
      { headers: { Authorization: `Basic ${auth}` }, signal: controller.signal }
    );
    if (!res.ok) return 0;
    const total = res.headers.get("X-WP-Total");
    return total ? parseInt(total, 10) : 0;
  } catch { return 0; }
  finally { clearTimeout(timeout); }
}

async function fetchSiteData(site: SiteCredential): Promise<CacheEntry> {
  const cached = postCache.get(site.slug);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached;
  }

  const [posts, totalCount] = await Promise.all([
    fetchWPPosts(site, 15),
    fetchWPPostCount(site),
  ]);

  const entry: CacheEntry = { posts, totalCount, cachedAt: Date.now() };
  postCache.set(site.slug, entry);
  return entry;
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/dashboard", async (_req, reply) => {
    const { send, close } = setupSSE(reply);

    try {
      const sitesRaw = await fetchCredentials();
      const sites = sitesRaw as unknown as SiteCredential[];
      const groups = await fetchGroups();

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
