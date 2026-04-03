const BING_WEBMASTER_API_BASE = process.env.BING_WEBMASTER_API_BASE ||
    "https://ssl.bing.com/webmaster/api.svc/json";
const BING_WEBMASTER_API_KEY = (process.env.BING_WEBMASTER_API_KEY || "").trim();
const BING_WEBMASTER_TIMEOUT_MS = Number(process.env.BING_WEBMASTER_TIMEOUT_MS || 15000);
const BING_WEBMASTER_MAX_RETRIES = Math.max(0, Number(process.env.BING_WEBMASTER_MAX_RETRIES || 4));
const BING_WEBMASTER_RETRY_BASE_MS = Math.max(250, Number(process.env.BING_WEBMASTER_RETRY_BASE_MS || 2000));
const BING_URL_SUBMISSION_SITE_URL = (process.env.BING_URL_SUBMISSION_SITE_URL || "https://allmyreview.site").trim();
const BING_URL_SUBMISSION_BATCH_SIZE = Math.max(1, Number(process.env.BING_URL_SUBMISSION_BATCH_SIZE || 100));
class BingWebmasterError extends Error {
    status;
    errorCode;
    apiMessage;
    constructor(message, options) {
        super(message);
        this.name = "BingWebmasterError";
        this.status = options.status;
        this.errorCode = options.errorCode;
        this.apiMessage = options.apiMessage;
    }
}
function normalizeSiteUrl(siteUrl) {
    const value = siteUrl.trim();
    if (!value) {
        throw new Error("siteUrl is required");
    }
    const normalized = new URL(value.endsWith("/") ? value : `${value}/`);
    normalized.hash = "";
    normalized.search = "";
    return normalized.toString();
}
function buildFeedUrl(siteUrl) {
    const normalized = normalizeSiteUrl(siteUrl);
    return `${normalized}sitemap_index.xml`;
}
async function callBing(method, payload) {
    if (!BING_WEBMASTER_API_KEY) {
        throw new Error("BING_WEBMASTER_API_KEY is not configured");
    }
    for (let attempt = 0;; attempt += 1) {
        const response = await fetch(`${BING_WEBMASTER_API_BASE}/${method}?apikey=${encodeURIComponent(BING_WEBMASTER_API_KEY)}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json; charset=utf-8",
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(BING_WEBMASTER_TIMEOUT_MS),
        });
        const text = await response.text();
        if (!response.ok) {
            let errorCode;
            let apiMessage;
            try {
                const parsed = JSON.parse(text);
                errorCode = parsed.ErrorCode;
                apiMessage = parsed.Message;
            }
            catch {
                // ignore body parse failures
            }
            const error = new BingWebmasterError(`${method} failed: HTTP ${response.status}${apiMessage ? ` ${apiMessage}` : ` ${text}`}`, {
                status: response.status,
                errorCode,
                apiMessage,
            });
            const isThrottle = error.status === 429 ||
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
            return JSON.parse(text);
        }
        catch {
            throw new Error(`${method} returned invalid JSON: ${text}`);
        }
    }
}
export function isBingWebmasterSyncEnabled() {
    return Boolean(BING_WEBMASTER_API_KEY);
}
function chunkUrls(urls, chunkSize) {
    const chunks = [];
    for (let index = 0; index < urls.length; index += chunkSize) {
        chunks.push(urls.slice(index, index + chunkSize));
    }
    return chunks;
}
function normalizeSubmissionUrls(urls) {
    return Array.from(new Set(urls
        .map((url) => {
        const trimmed = url.trim();
        if (!trimmed)
            return "";
        try {
            return new URL(trimmed).toString();
        }
        catch {
            return "";
        }
    })
        .filter(Boolean)));
}
export async function submitBingUrls(urls, siteUrl = BING_URL_SUBMISSION_SITE_URL) {
    const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
    const normalizedUrls = normalizeSubmissionUrls(urls);
    const errors = [];
    if (normalizedUrls.length === 0) {
        return {
            siteUrl: normalizedSiteUrl,
            submitted: 0,
            batches: 0,
            errors,
        };
    }
    const batches = chunkUrls(normalizedUrls, BING_URL_SUBMISSION_BATCH_SIZE);
    let submitted = 0;
    for (const batch of batches) {
        try {
            await callBing("SubmitUrlBatch", {
                siteUrl: normalizedSiteUrl,
                urlList: batch,
            });
            submitted += batch.length;
        }
        catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
        }
    }
    return {
        siteUrl: normalizedSiteUrl,
        submitted,
        batches: batches.length,
        errors,
    };
}
export async function syncBingSite(siteUrl) {
    const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
    const feedUrl = buildFeedUrl(normalizedSiteUrl);
    const notes = [];
    const errors = [];
    let added = false;
    let feedSubmitted = false;
    try {
        await callBing("AddSite", { siteUrl: normalizedSiteUrl });
        added = true;
    }
    catch (error) {
        if (error instanceof BingWebmasterError &&
            error.errorCode === 2 &&
            (error.apiMessage || "").includes("Max limit reached for number of sites registered under this domain")) {
            notes.push("Bing site registration limit reached for this domain");
        }
        else {
            errors.push(error instanceof Error ? error.message : String(error));
        }
    }
    try {
        await callBing("SubmitFeed", {
            siteUrl: normalizedSiteUrl,
            feedUrl,
        });
        feedSubmitted = true;
    }
    catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
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
//# sourceMappingURL=bing-webmaster.js.map