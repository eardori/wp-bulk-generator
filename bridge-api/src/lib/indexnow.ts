/**
 * IndexNow API — 콘텐츠 발행/수정 즉시 검색엔진에 색인 요청
 *
 * 지원 검색엔진: Bing, Yandex, Naver, Seznam, Yahoo 등
 * Spec: https://www.indexnow.org/
 *
 * 환경 변수:
 *   INDEXNOW_API_KEY  — 필수. 사이트 루트에 {key}.txt 파일도 존재해야 함
 *   INDEXNOW_ENABLED  — "false"로 설정하면 비활성화 (기본: true if key is set)
 */

const INDEXNOW_API_KEY = (process.env.INDEXNOW_API_KEY || "").trim();
const INDEXNOW_ENABLED =
  INDEXNOW_API_KEY.length > 0 &&
  (process.env.INDEXNOW_ENABLED || "true").toLowerCase() !== "false";

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const INDEXNOW_TIMEOUT_MS = 10_000;

export function isIndexNowEnabled(): boolean {
  return INDEXNOW_ENABLED;
}

export function getIndexNowApiKey(): string {
  return INDEXNOW_API_KEY;
}

export type IndexNowResult = {
  submitted: number;
  success: boolean;
  statusCode?: number;
  error?: string;
};

/**
 * IndexNow API에 URL 목록을 제출합니다.
 * @param urls  - 색인 요청할 URL 목록 (같은 호스트여야 함)
 * @param host  - 사이트 호스트 (예: "galbi-vibe.allmyreview.site")
 */
export async function submitIndexNow(
  urls: string[],
  host: string
): Promise<IndexNowResult> {
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
  } catch (err) {
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
export function getIndexNowKeyFileContent(): string {
  return INDEXNOW_API_KEY;
}
