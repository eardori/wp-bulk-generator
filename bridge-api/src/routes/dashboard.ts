import type { FastifyInstance } from "fastify";
import { readDashboardCache } from "../lib/dashboard-cache.js";
import { fetchCredentials, fetchGroups } from "../lib/ec2-client.js";
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
};

type SiteGroup = {
  id: string;
  name: string;
  slugs: string[];
  createdAt: string;
};

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
      const cache = readDashboardCache();

      send({ type: "meta", sites, groups });

      for (const site of sites) {
        const cached = cache.sites[site.slug];

        send({
          type: "posts",
          slug: site.slug,
          posts: cached?.posts || [],
          totalCount: cached?.totalCount || 0,
          ...(cached ? {} : { cacheMissing: true }),
          ...(cached?.error ? { error: true } : {}),
        });
      }

      send({ type: "done" });
    } catch (err) {
      send({ type: "error", message: String(err) });
    } finally {
      close();
    }
  });
}
