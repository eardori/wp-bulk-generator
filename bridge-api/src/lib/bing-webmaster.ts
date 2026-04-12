const BING_WEBMASTER_API_BASE =
  process.env.BING_WEBMASTER_API_BASE ||
  "https://ssl.bing.com/webmaster/api.svc/json";
const BING_WEBMASTER_API_KEY = (process.env.BING_WEBMASTER_API_KEY || "").trim();
const BING_WEBMASTER_TIMEOUT_MS = Number(
  process.env.BING_WEBMASTER_TIMEOUT_MS || 15000
);
const BING_WEBMASTER_MAX_RETRIES = Math.max(
  0,
  Number(process.env.BING_WEBMASTER_MAX_RETRIES || 4)
);
const BING_WEBMASTER_RETRY_BASE_MS = Math.max(
  250,
  Number(process.env.BING_WEBMASTER_RETRY_BASE_MS || 2000)
);
const BING_URL_SUBMISSION_SITE_URL = (process.env.BING_URL_SUBMISSION_SITE_URL || "").trim();
const BING_URL_SUBMISSION_BATCH_SIZE = Math.max(
  1,
  Number(process.env.BING_URL_SUBMISSION_BATCH_SIZE || 100)
);

export type BingSyncResult = {
  siteUrl: string;
  feedUrl: string;
  added: boolean;
  feedSubmitted: boolean;
  notes: string[];
  errors: string[];
};

export type BingUrlSubmissionResult = {
  siteUrl: string;
  siteUrls: string[];
  submitted: number;
  batches: number;
  errors: string[];
};

class BingWebmasterError extends Error {
  status: number;
  errorCode?: number;
  apiMessage?: string;

  constructor(message: string, options: { status: number; errorCode?: number; apiMessage?: string }) {
    super(message);
    this.name = "BingWebmasterError";
    this.status = options.status;
    this.errorCode = options.errorCode;
    this.apiMessage = options.apiMessage;
  }
}

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

async function callBing(method: string, payload: Record<string, unknown>) {
  if (!BING_WEBMASTER_API_KEY) {
    throw new Error("BING_WEBMASTER_API_KEY is not configured");
  }

  for (let attempt = 0; ; attempt += 1) {
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
      let errorCode: number | undefined;
      let apiMessage: string | undefined;

      try {
        const parsed = JSON.parse(text) as {
          ErrorCode?: number;
          Message?: string;
        };
        errorCode = parsed.ErrorCode;
        apiMessage = parsed.Message;
      } catch {
        // ignore body parse failures
      }

      const error = new BingWebmasterError(
        `${method} failed: HTTP ${response.status}${apiMessage ? ` ${apiMessage}` : ` ${text}`}`,
        {
          status: response.status,
          errorCode,
          apiMessage,
        }
      );

      const isThrottle =
        error.status === 429 ||
        error.status >= 500 ||
        (error.apiMessage || "").includes("ThrottleHost");

      if (isThrottle && attempt < BING_WEBMASTER_MAX_RETRIES) {
        const delayMs = BING_WEBMASTER_RETRY_BASE_MS * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      throw error;
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
}

export function isBingWebmasterSyncEnabled() {
  return Boolean(BING_WEBMASTER_API_KEY);
}

function chunkUrls(urls: string[], chunkSize: number) {
  const chunks: string[][] = [];
  for (let index = 0; index < urls.length; index += chunkSize) {
    chunks.push(urls.slice(index, index + chunkSize));
  }
  return chunks;
}

function normalizeSubmissionUrls(urls: string[]) {
  return Array.from(
    new Set(
      urls
        .map((url) => {
          const trimmed = url.trim();
          if (!trimmed) return "";
          try {
            return new URL(trimmed).toString();
          } catch {
            return "";
          }
        })
        .filter(Boolean)
    )
  );
}

function groupSubmissionUrlsBySite(urls: string[]) {
  const groups = new Map<string, string[]>();

  for (const url of urls) {
    let siteUrl = "";
    try {
      siteUrl = normalizeSiteUrl(new URL(url).origin);
    } catch {
      continue;
    }

    const current = groups.get(siteUrl);
    if (current) {
      current.push(url);
    } else {
      groups.set(siteUrl, [url]);
    }
  }

  return groups;
}

export async function submitBingUrls(
  urls: string[],
  siteUrl = BING_URL_SUBMISSION_SITE_URL
): Promise<BingUrlSubmissionResult> {
  const normalizedUrls = normalizeSubmissionUrls(urls);
  const errors: string[] = [];
  const normalizedSiteUrl = siteUrl ? normalizeSiteUrl(siteUrl) : "";

  if (normalizedUrls.length === 0) {
    return {
      siteUrl: normalizedSiteUrl,
      siteUrls: normalizedSiteUrl ? [normalizedSiteUrl] : [],
      submitted: 0,
      batches: 0,
      errors,
    };
  }

  const groupedUrls = normalizedSiteUrl
    ? new Map([[normalizedSiteUrl, normalizedUrls]])
    : groupSubmissionUrlsBySite(normalizedUrls);
  const siteUrls = Array.from(groupedUrls.keys());
  let submitted = 0;
  let totalBatches = 0;

  for (const [submissionSiteUrl, submissionUrls] of groupedUrls) {
    const batches = chunkUrls(submissionUrls, BING_URL_SUBMISSION_BATCH_SIZE);
    totalBatches += batches.length;

    for (const batch of batches) {
      try {
        await callBing("SubmitUrlBatch", {
          siteUrl: submissionSiteUrl,
          urlList: batch,
        });
        submitted += batch.length;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`[${submissionSiteUrl}] ${message}`);
      }
    }
  }

  return {
    siteUrl: normalizedSiteUrl || siteUrls[0] || "",
    siteUrls,
    submitted,
    batches: totalBatches,
    errors,
  };
}

export async function syncBingSite(siteUrl: string): Promise<BingSyncResult> {
  const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
  const feedUrl = buildFeedUrl(normalizedSiteUrl);
  const notes: string[] = [];
  const errors: string[] = [];
  let added = false;
  let feedSubmitted = false;

  try {
    await callBing("AddSite", { siteUrl: normalizedSiteUrl });
    added = true;
  } catch (error) {
    if (
      error instanceof BingWebmasterError &&
      error.errorCode === 2 &&
      (error.apiMessage || "").includes("Max limit reached for number of sites registered under this domain")
    ) {
      notes.push("Bing site registration limit reached for this domain");
      errors.push(`[CRITICAL] Bing 사이트 등록 한도 초과 — ${normalizedSiteUrl} 미등록. DNS-TXT 도메인 레벨 검증을 권장합니다.`);
    } else {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  // static sitemap 제출
  try {
    await callBing("SubmitFeed", {
      siteUrl: normalizedSiteUrl,
      feedUrl,
    });
    feedSubmitted = true;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  // Yoast/WordPress 기본 sitemap도 함께 제출 (항상 최신 상태)
  const wpSitemapUrl = `${normalizedSiteUrl}wp-sitemap.xml`;
  try {
    await callBing("SubmitFeed", {
      siteUrl: normalizedSiteUrl,
      feedUrl: wpSitemapUrl,
    });
  } catch {
    // wp-sitemap.xml 제출 실패는 치명적이지 않으므로 무시
  }

  return {
    siteUrl: normalizedSiteUrl,
    feedUrl,
    added,
    feedSubmitted,
    notes,
    errors,
  };
}
