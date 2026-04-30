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
export declare function isIndexNowEnabled(): boolean;
export declare function getIndexNowApiKey(): string;
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
export declare function submitIndexNow(urls: string[], host: string): Promise<IndexNowResult>;
/**
 * 사이트 루트에 IndexNow 키 검증 파일을 생성합니다.
 * WordPress 사이트에 {INDEXNOW_API_KEY}.txt 파일이 필요합니다.
 */
export declare function getIndexNowKeyFileContent(): string;
//# sourceMappingURL=indexnow.d.ts.map