import { readDashboardCache } from "../lib/dashboard-cache.js";
import { fetchCredentials, fetchGroups } from "../lib/ec2-client.js";
import { setupSSE } from "../utils/sse.js";
function normalizeGroups(input) {
    if (Array.isArray(input)) {
        return input;
    }
    if (input &&
        typeof input === "object" &&
        Array.isArray(input.groups)) {
        return input.groups;
    }
    return [];
}
function normalizeSites(input) {
    return Array.isArray(input) ? input : [];
}
export async function dashboardRoutes(app) {
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
        }
        catch (err) {
            send({ type: "error", message: String(err) });
        }
        finally {
            close();
        }
    });
}
//# sourceMappingURL=dashboard.js.map