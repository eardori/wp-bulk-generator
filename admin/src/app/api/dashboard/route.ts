import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const CACHE_DIR = join(process.cwd(), ".cache");

type SiteCredential = {
  slug: string;
  domain: string;
  title: string;
  url: string;
  admin_user: string;
  admin_pass: string;
  app_pass: string;
  persona?: {
    name: string;
    age?: number;
    concern?: string;
    expertise?: string;
    tone?: string;
    bio?: string;
  };
};

type SiteGroup = {
  id: string;
  name: string;
  slugs: string[];
  createdAt: string;
};

type WPPost = {
  id: number;
  title: { rendered: string };
  link: string;
  date: string;
  status: string;
};

function tryReadJson<T>(path: string): T[] {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf-8")) as T[];
  } catch {
    /* ignore */
  }
  return [];
}

async function fetchWPPosts(site: SiteCredential, perPage = 15): Promise<WPPost[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const auth = Buffer.from(`${site.admin_user}:${site.app_pass}`).toString("base64");
    const res = await fetch(
      `${site.url}/wp-json/wp/v2/posts?per_page=${perPage}&_fields=id,title,link,date,status&status=publish&orderby=date&order=desc`,
      {
        headers: { Authorization: `Basic ${auth}` },
        signal: controller.signal,
        cache: "no-store",
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWPPostCount(site: SiteCredential): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const auth = Buffer.from(`${site.admin_user}:${site.app_pass}`).toString("base64");
    const res = await fetch(
      `${site.url}/wp-json/wp/v2/posts?per_page=1&_fields=id&status=publish`,
      {
        headers: { Authorization: `Basic ${auth}` },
        signal: controller.signal,
        cache: "no-store",
      }
    );
    if (!res.ok) return 0;
    const total = res.headers.get("X-WP-Total");
    return total ? parseInt(total, 10) : 0;
  } catch {
    return 0;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* stream closed */
        }
      };

      try {
        // Load sites and groups from cache
        const sites = tryReadJson<SiteCredential>(join(CACHE_DIR, "sites-credentials.json"));
        const groups = tryReadJson<SiteGroup>(join(CACHE_DIR, "site-groups.json"));

        // Send meta immediately so UI can render structure
        send({ type: "meta", sites, groups });

        // Fetch WP posts for each site in parallel batches of 6
        const BATCH_SIZE = 6;
        for (let i = 0; i < sites.length; i += BATCH_SIZE) {
          const batch = sites.slice(i, i + BATCH_SIZE);
          await Promise.all(
            batch.map(async (site) => {
              try {
                const [posts, totalCount] = await Promise.all([
                  fetchWPPosts(site, 15),
                  fetchWPPostCount(site),
                ]);
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
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
