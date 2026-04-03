import { readFileSync, existsSync } from "fs";
import { isExcludedSiteDomain, isExcludedSiteSlug } from "../lib/excluded-sites.js";
const CREDS_PATH = process.env.CREDENTIALS_PATH || "/root/wp-sites-credentials.json";
const CONFIG_PATH = process.env.CONFIG_PATH || "/root/wp-sites-config.json";
export async function reservedSlugsRoutes(app) {
    app.post("/reserved-slugs", async () => {
        const slugs = new Set();
        const domains = new Set();
        const paths = [CREDS_PATH, CONFIG_PATH];
        for (const p of paths) {
            try {
                if (!existsSync(p))
                    continue;
                const data = JSON.parse(readFileSync(p, "utf-8"));
                for (const item of data) {
                    const slug = (item.slug || item.site_slug);
                    const domain = item.domain;
                    if (slug && !isExcludedSiteSlug(slug))
                        slugs.add(slug);
                    if (domain && !isExcludedSiteDomain(domain))
                        domains.add(domain);
                }
            }
            catch {
                // 파일 없거나 파싱 실패
            }
        }
        return {
            slugs: Array.from(slugs),
            domains: Array.from(domains),
        };
    });
}
//# sourceMappingURL=reserved-slugs.js.map