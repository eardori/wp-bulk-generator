/**
 * IndexNow API — 콘텐츠 발행/수정 즉시 검색엔진에 색인 요청
 *
 * 지원 검색엔진: Bing, Yandex, Naver, Seznam, Yahoo 등
 * Spec: https://www.indexnow.org/
 *
 * 키 해석 우선순위 (shell 스크립트와 공용하기 위해 다중 fallback):
 *   1) INDEXNOW_API_KEY (Bridge 전용 env)
 *   2) INDEXNOW_KEY     (deploy-wp-sites.sh 과 공용 env)
 *   3) INDEXNOW_KEY_FILE 경로의 파일 (기본 /root/.wp-bulk-indexnow-key)
 *
 * 모든 서버(Primary/Secondary/Lightsail)가 같은 키를 공유해야 정상 동작.
 *
 * 환경 변수:
 *   INDEXNOW_ENABLED — 2026-04-22 Bing 적극 제출 금지 방침으로 기본값 "false".
 *                      활성화하려면 env 에 "true" 명시 필요.
 */
import { readFileSync } from "fs";
function resolveIndexNowKey() {
    const envKey = (process.env.INDEXNOW_API_KEY || process.env.INDEXNOW_KEY || "").trim();
    if (envKey)
        return envKey;
    const keyFile = (process.env.INDEXNOW_KEY_FILE || "/root/.wp-bulk-indexnow-key").trim();
    try {
        const fileKey = readFileSync(keyFile, "utf-8").trim();
        if (fileKey)
            return fileKey;
    }
    catch {
        // 파일 없으면 무시
    }
    return "";
}
const INDEXNOW_API_KEY = resolveIndexNowKey();
const INDEXNOW_ENABLED = INDEXNOW_API_KEY.length > 0 &&
    (process.env.INDEXNOW_ENABLED || "false").toLowerCase() === "true";
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const INDEXNOW_TIMEOUT_MS = 10_000;
export function isIndexNowEnabled() {
    return INDEXNOW_ENABLED;
}
export function getIndexNowApiKey() {
    return INDEXNOW_API_KEY;
}
/**
 * IndexNow API에 URL 목록을 제출합니다.
 * @param urls  - 색인 요청할 URL 목록 (같은 호스트여야 함)
 * @param host  - 사이트 호스트 (예: "galbi-vibe.allmyreview.site")
 */
export async function submitIndexNow(urls, host) {
    if (!INDEXNOW_ENABLED || urls.length === 0) {
        return { submitted: 0, success: false, error: "IndexNow disabled or no URLs" };
    }
    try {
        const body = {
            host,
            key: INDEXNOW_API_KEY,
            keyLocation: `https://${host}/${INDEXNOW_API_KEY}.txt`,
            urlList: urls.slice(0, 10_000), // IndexNow max 10,000 per request
        };
        const res = await fetch(INDEXNOW_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(INDEXNOW_TIMEOUT_MS),
        });
        // IndexNow returns 200 (OK) or 202 (Accepted) on success
        if (res.status === 200 || res.status === 202) {
            return { submitted: urls.length, success: true, statusCode: res.status };
        }
        const text = await res.text().catch(() => "");
        return {
            submitted: 0,
            success: false,
            statusCode: res.status,
            error: `IndexNow ${res.status}: ${text.slice(0, 200)}`,
        };
    }
    catch (err) {
        return {
            submitted: 0,
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
        };
    }
}
/**
 * 사이트 루트에 IndexNow 키 검증 파일을 생성합니다.
 * WordPress 사이트에 {INDEXNOW_API_KEY}.txt 파일이 필요합니다.
 */
export function getIndexNowKeyFileContent() {
    return INDEXNOW_API_KEY;
}
//# sourceMappingURL=indexnow.js.map