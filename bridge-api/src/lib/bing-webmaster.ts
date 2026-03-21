const BING_WEBMASTER_API_BASE =
  process.env.BING_WEBMASTER_API_BASE ||
  "https://ssl.bing.com/webmaster/api.svc/json";
const BING_WEBMASTER_API_KEY = (process.env.BING_WEBMASTER_API_KEY || "").trim();
const BING_WEBMASTER_TIMEOUT_MS = Number(
  process.env.BING_WEBMASTER_TIMEOUT_MS || 15000
);

export type BingSyncResult = {
  siteUrl: string;
  feedUrl: string;
  added: boolean;
  feedSubmitted: boolean;
  errors: string[];
};

function normalizeSiteUrl(siteUrl: string) {
  const value = siteUrl.trim();
  if (!value) {
    throw new Error("siteUrl is required");
  }

  const normalized = new URL(value.endsWith("/") ? value : `${value}/`);
  normalized.hash = "";
  normalized.search = "";
  return normalized.toString();
}

function buildFeedUrl(siteUrl: string) {
  const normalized = normalizeSiteUrl(siteUrl);
  return `${normalized}sitemap_index.xml`;
}

async function callBing(method: string, payload: Record<string, string>) {
  if (!BING_WEBMASTER_API_KEY) {
    throw new Error("BING_WEBMASTER_API_KEY is not configured");
  }

  const response = await fetch(
    `${BING_WEBMASTER_API_BASE}/${method}?apikey=${encodeURIComponent(BING_WEBMASTER_API_KEY)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(BING_WEBMASTER_TIMEOUT_MS),
    }
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} failed: HTTP ${response.status} ${text}`);
  }

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as { d?: unknown };
  } catch {
    throw new Error(`${method} returned invalid JSON: ${text}`);
  }
}

export function isBingWebmasterSyncEnabled() {
  return Boolean(BING_WEBMASTER_API_KEY);
}

export async function syncBingSite(siteUrl: string): Promise<BingSyncResult> {
  const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
  const feedUrl = buildFeedUrl(normalizedSiteUrl);
  const errors: string[] = [];
  let added = false;
  let feedSubmitted = false;

  try {
    await callBing("AddSite", { siteUrl: normalizedSiteUrl });
    added = true;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    await callBing("SubmitFeed", {
      siteUrl: normalizedSiteUrl,
      feedUrl,
    });
    feedSubmitted = true;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return {
    siteUrl: normalizedSiteUrl,
    feedUrl,
    added,
    feedSubmitted,
    errors,
  };
}
