const BING_WEBMASTER_API_BASE = process.env.BING_WEBMASTER_API_BASE ||
    "https://ssl.bing.com/webmaster/api.svc/json";
const BING_WEBMASTER_API_KEY = (process.env.BING_WEBMASTER_API_KEY || "").trim();
const BING_WEBMASTER_API_KEY_MYGROUND = (process.env.BING_WEBMASTER_API_KEY_MYGROUND || "").trim();
const BING_WEBMASTER_TIMEOUT_MS = Number(process.env.BING_WEBMASTER_TIMEOUT_MS || 15000);
const BING_WEBMASTER_MAX_RETRIES = Math.max(0, Number(process.env.BING_WEBMASTER_MAX_RETRIES || 4));
const BING_WEBMASTER_RETRY_BASE_MS = Math.max(250, Number(process.env.BING_WEBMASTER_RETRY_BASE_MS || 2000));
const BING_URL_SUBMISSION_SITE_URL = (process.env.BING_URL_SUBMISSION_SITE_URL || "").trim();
const BING_URL_SUBMISSION_BATCH_SIZE = Math.max(1, Number(process.env.BING_URL_SUBMISSION_BATCH_SIZE || 100));
/** 도메인에 따라 적절한 Bing Webmaster API 키를 반환 */
function getApiKeyForDomain(domain) {
    if (domain) {
        const host = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
        if (host.endsWith(".myground.website") || host === "myground.website") {
            return BING_WEBMASTER_API_KEY_MYGROUND || BING_WEBMASTER_API_KEY;
        }
    }
    return BING_WEBMASTER_API_KEY;
}
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
async function callBing(method, payload, domain) {
    const apiKey = getApiKeyForDomain(domain);
    if (!apiKey) {
        throw new Error("BING_WEBMASTER_API_KEY is not configured");
    }
    for (let attempt = 0;; attempt += 1) {
        const response = await fetch(`${BING_WEBMASTER_API_BASE}/${method}?apikey=${encodeURIComponent(apiKey)}`, {
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
export function isBingWebmasterSyncEnabled(domain) {
    return Boolean(getApiKeyForDomain(domain));
}
// SubmitUrlBatch (발행 시 URL 단건 제출) 전용 kill-switch.
// 2026-04-22 Bing 적극 제출 금지 방침 — 기본값 false. 명시적 "true" 로만 활성화.
// "Bing 이 스스로 크롤링하도록" 전략이므로 능동 제출을 기본 차단.
export function isBingUrlSubmissionEnabled(domain) {
    const enabled = (process.env.BING_URL_SUBMISSION_ENABLED || "false").toLowerCase() === "true";
    if (!enabled)
        return false;
    return isBingWebmasterSyncEnabled(domain);
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
function groupSubmissionUrlsBySite(urls) {
    const groups = new Map();
    for (const url of urls) {
        let siteUrl = "";
        try {
            siteUrl = normalizeSiteUrl(new URL(url).origin);
        }
        catch {
            continue;
        }
        const current = groups.get(siteUrl);
        if (current) {
            current.push(url);
        }
        else {
            groups.set(siteUrl, [url]);
        }
    }
    return groups;
}
export async function submitBingUrls(urls, siteUrl = BING_URL_SUBMISSION_SITE_URL) {
    const normalizedUrls = normalizeSubmissionUrls(urls);
    const errors = [];
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
                }, submissionSiteUrl);
                submitted += batch.length;
            }
            catch (error) {
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
/**
 * 서브도메인의 루트 도메인 URL을 반환.
 * 예: https://foo.myground.website/ → https://myground.website/
 * 루트 도메인이면 그대로 반환.
 */
function getRootSiteUrl(normalizedSiteUrl) {
    try {
        const url = new URL(normalizedSiteUrl);
        const parts = url.hostname.split(".");
        if (parts.length > 2) {
            url.hostname = parts.slice(-2).join(".");
            return normalizeSiteUrl(url.origin);
        }
    }
    catch { /* ignore */ }
    return normalizedSiteUrl;
}
export async function syncBingSite(siteUrl) {
    const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
    const feedUrl = buildFeedUrl(normalizedSiteUrl);
    const notes = [];
    const errors = [];
    let added = false;
    let feedSubmitted = false;
    // 서브도메인이면 루트 도메인 사이트에 sitemap을 제출 (개별 AddSite 안 함)
    const rootSiteUrl = getRootSiteUrl(normalizedSiteUrl);
    const isSubdomain = rootSiteUrl !== normalizedSiteUrl;
    if (!isSubdomain) {
        // 루트 도메인만 AddSite 등록
        try {
            await callBing("AddSite", { siteUrl: normalizedSiteUrl }, normalizedSiteUrl);
            added = true;
        }
        catch (error) {
            if (error instanceof BingWebmasterError &&
                error.errorCode === 2 &&
                (error.apiMessage || "").includes("Max limit reached for number of sites registered under this domain")) {
                notes.push("Bing site registration limit reached for this domain");
                errors.push(`[CRITICAL] Bing 사이트 등록 한도 초과 — ${normalizedSiteUrl} 미등록. DNS-TXT 도메인 레벨 검증을 권장합니다.`);
            }
            else {
                errors.push(error instanceof Error ? error.message : String(error));
            }
        }
    }
    // sitemap 제출: 서브도메인이면 루트 도메인의 siteUrl로 제출
    const submitSiteUrl = isSubdomain ? rootSiteUrl : normalizedSiteUrl;
    try {
        await callBing("SubmitFeed", {
            siteUrl: submitSiteUrl,
            feedUrl,
        }, submitSiteUrl);
        feedSubmitted = true;
    }
    catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
    }
    // Yoast/WordPress 기본 sitemap도 함께 제출
    const wpSitemapUrl = `${normalizedSiteUrl}wp-sitemap.xml`;
    try {
        await callBing("SubmitFeed", {
            siteUrl: submitSiteUrl,
            feedUrl: wpSitemapUrl,
        }, submitSiteUrl);
    }
    catch {
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
//# sourceMappingURL=bing-webmaster.js.map