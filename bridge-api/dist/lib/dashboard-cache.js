import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";
let mutationQueue = Promise.resolve();
function getDashboardCachePaths() {
    return Array.from(new Set([
        process.env.DASHBOARD_CACHE_PATH,
        "/home/ubuntu/wp-bulk-generator/bridge-api/data/dashboard-cache.json",
        "/home/ubuntu/wp-bulk-generator/admin/.cache/dashboard-cache.json",
        "/home/ubuntu/wp-bridge-api/data/dashboard-cache.json",
        "/root/dashboard-cache.json",
    ].filter((value) => Boolean(value))));
}
function createEmptyCache() {
    return {
        version: 1,
        updatedAt: Date.now(),
        sites: {},
    };
}
function normalizePost(input) {
    if (!input || typeof input !== "object") {
        return null;
    }
    const item = input;
    const rawTitle = item.title;
    const title = rawTitle && typeof rawTitle === "object" && typeof rawTitle.rendered === "string"
        ? { rendered: rawTitle.rendered }
        : { rendered: "" };
    return {
        id: typeof item.id === "number" ? item.id : 0,
        title,
        link: typeof item.link === "string" ? item.link : "",
        date: typeof item.date === "string" ? item.date : new Date().toISOString(),
        status: typeof item.status === "string" ? item.status : "publish",
    };
}
function normalizeEntry(input) {
    if (!input || typeof input !== "object") {
        return { posts: [], totalCount: 0, cachedAt: Date.now() };
    }
    const item = input;
    const posts = Array.isArray(item.posts)
        ? item.posts.map((post) => normalizePost(post)).filter((post) => Boolean(post))
        : [];
    return {
        posts,
        totalCount: typeof item.totalCount === "number" ? item.totalCount : posts.length,
        cachedAt: typeof item.cachedAt === "number" ? item.cachedAt : Date.now(),
        ...(typeof item.error === "boolean" ? { error: item.error } : {}),
    };
}
function normalizeCache(input) {
    if (!input || typeof input !== "object") {
        return createEmptyCache();
    }
    const record = input;
    const rawSites = record.sites;
    const sites = {};
    if (rawSites && typeof rawSites === "object") {
        for (const [slug, value] of Object.entries(rawSites)) {
            const normalizedSlug = slug.trim().toLowerCase();
            if (!normalizedSlug) {
                continue;
            }
            sites[normalizedSlug] = normalizeEntry(value);
        }
    }
    return {
        version: 1,
        updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
        sites,
    };
}
function readDashboardCacheSync() {
    for (const path of getDashboardCachePaths()) {
        try {
            if (!existsSync(path)) {
                continue;
            }
            return normalizeCache(JSON.parse(readFileSync(path, "utf-8")));
        }
        catch {
            continue;
        }
    }
    return createEmptyCache();
}
function writeDashboardCacheSync(cache) {
    const payload = JSON.stringify({
        ...cache,
        updatedAt: Date.now(),
    }, null, 2);
    let successCount = 0;
    for (const path of getDashboardCachePaths()) {
        try {
            const dir = dirname(path);
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
            const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
            writeFileSync(tempPath, payload);
            renameSync(tempPath, path);
            successCount += 1;
        }
        catch {
            continue;
        }
    }
    if (successCount === 0) {
        throw new Error("No writable dashboard cache path available.");
    }
}
function normalizeSlug(slug) {
    return slug.trim().toLowerCase();
}
async function mutateDashboardCache(mutator) {
    let nextCache = createEmptyCache();
    const nextTask = mutationQueue.then(() => {
        const cache = readDashboardCacheSync();
        mutator(cache);
        writeDashboardCacheSync(cache);
        nextCache = cache;
    });
    mutationQueue = nextTask.catch(() => undefined);
    await nextTask;
    return nextCache;
}
export function readDashboardCache() {
    return readDashboardCacheSync();
}
export async function setDashboardSiteCache(slug, entry) {
    const normalizedSlug = normalizeSlug(slug);
    const cache = await mutateDashboardCache((draft) => {
        draft.sites[normalizedSlug] = {
            ...normalizeEntry(entry),
            cachedAt: Date.now(),
        };
    });
    return cache.sites[normalizedSlug];
}
export async function updateDashboardSiteCache(slug, updater) {
    const normalizedSlug = normalizeSlug(slug);
    const cache = await mutateDashboardCache((draft) => {
        const current = draft.sites[normalizedSlug] || {
            posts: [],
            totalCount: 0,
            cachedAt: Date.now(),
        };
        draft.sites[normalizedSlug] = {
            ...normalizeEntry(updater(current)),
            cachedAt: Date.now(),
        };
    });
    return cache.sites[normalizedSlug];
}
export async function seedDashboardSiteCaches(entries) {
    await mutateDashboardCache((draft) => {
        for (const item of entries) {
            const normalizedSlug = normalizeSlug(item.slug);
            if (!normalizedSlug) {
                continue;
            }
            draft.sites[normalizedSlug] = {
                ...normalizeEntry(item.entry),
                cachedAt: Date.now(),
            };
        }
    });
}
export async function removeDashboardSiteCaches(slugs) {
    const normalizedSlugs = slugs.map((slug) => normalizeSlug(slug)).filter(Boolean);
    if (normalizedSlugs.length === 0) {
        return;
    }
    await mutateDashboardCache((draft) => {
        for (const slug of normalizedSlugs) {
            delete draft.sites[slug];
        }
    });
}
//# sourceMappingURL=dashboard-cache.js.map