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