import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { SiteCredential } from "@/app/content/types";

const CREDS_CACHE = join(process.cwd(), ".cache", "sites-credentials.json");
const CONFIG_CACHE = join(process.cwd(), ".cache", "sites-config.json");

function tryReadJson<T>(path: string): T[] {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf-8")) as T[];
  } catch { /* ignore */ }
  return [];
}

export async function GET() {
  try {
    let creds: Record<string, string>[] = [];
    let configData: Record<string, unknown>[] = [];

    // Priority: .cache/ (deploy script syncs here after each site install, ubuntu-readable)
    // Fallback: ../configs/ (legacy path)
    creds =
      tryReadJson<Record<string, string>>(CREDS_CACHE).length > 0
        ? tryReadJson<Record<string, string>>(CREDS_CACHE)
        : tryReadJson<Record<string, string>>(join(process.cwd(), "..", "configs", "sites-credentials.json"));

    configData =
      tryReadJson<Record<string, unknown>>(CONFIG_CACHE).length > 0
        ? tryReadJson<Record<string, unknown>>(CONFIG_CACHE)
        : tryReadJson<Record<string, unknown>>(join(process.cwd(), "..", "configs", "sites-config.json"));

    if (creds.length === 0) {
      return Response.json(
        { error: "사이트 자격증명 캐시가 없습니다. 먼저 사이트를 배포해주세요.", sites: [] },
        { status: 200 }
      );
    }

    // Build config lookup by slug
    const configMap = new Map<string, Record<string, unknown>>();
    for (const cfg of configData) {
      if (cfg.site_slug) configMap.set(cfg.site_slug as string, cfg);
    }

    // Merge creds with persona data
    const sites: SiteCredential[] = creds.map(
      (c: Record<string, string>) => {
        const cfg = configMap.get(c.slug);
        const persona = cfg?.persona as SiteCredential["persona"] | undefined;

        return {
          slug: c.slug,
          domain: c.domain,
          title: c.title,
          url: c.url || `http://${c.domain}`,
          admin_user: c.admin_user,
          admin_pass: c.admin_pass,
          app_pass: c.app_pass,
          persona: persona || {
            name: c.title,
            age: 30,
            concern: "",
            expertise: "",
            tone: "전문적이고 친근한",
            bio: "",
          },
        };
      }
    );

    return Response.json({ sites });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "사이트 목록을 가져올 수 없습니다.",
        sites: [],
      },
      { status: 500 }
    );
  }
}
