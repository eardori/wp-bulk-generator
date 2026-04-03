export type DashboardPost = {
    id: number;
    title: {
        rendered: string;
    };
    link: string;
    date: string;
    status: string;
};
export type DashboardCacheEntry = {
    posts: DashboardPost[];
    totalCount: number;
    cachedAt: number;
    error?: boolean;
};
type DashboardCacheFile = {
    version: 1;
    updatedAt: number;
    sites: Record<string, DashboardCacheEntry>;
};
export declare function readDashboardCache(): DashboardCacheFile;
export declare function setDashboardSiteCache(slug: string, entry: DashboardCacheEntry): Promise<DashboardCacheEntry>;
export declare function updateDashboardSiteCache(slug: string, updater: (entry: DashboardCacheEntry) => DashboardCacheEntry): Promise<DashboardCacheEntry>;
export declare function seedDashboardSiteCaches(entries: Array<{
    slug: string;
    entry: DashboardCacheEntry;
}>): Promise<void>;
export declare function removeDashboardSiteCaches(slugs: string[]): Promise<void>;
export {};
//# sourceMappingURL=dashboard-cache.d.ts.map