# AEO 개선 — Codex 리뷰 반영 현황

**대상**: 생성된 WordPress 사이트의 Bing AEO(Answer Engine Optimization) 기술 신호
**샘플 URL**: `https://chowlog.xyz/seolyagalbi-cheongdam-review/`
**리뷰어**: Codex (외부 AI 리뷰)

이 문서는 Codex 가 두 차례에 걸쳐 준 AEO 리뷰의 원본과 각 지적 항목의 반영 상태, 수정 계획을 기록한다. 이후 동일 사이트를 다시 리뷰할 때 이 문서를 갱신한다.

---

## 1. Codex 리뷰 #1 — 초기 (2026-04-21 추정)

### 결론
> 페이지는 콘텐츠 구조는 괜찮은데 Bing 기준 기술 SEO 는 아직 덜 정리돼 있음. 특히 대표 URL을 `http://` 로 선언하고 있어 Bing 이 정본 URL 해석 시 신호가 흐려짐.

### 좋은 점
- 페이지 200 OK, http 접속 시 https 로 301
- robots 메타: `index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1` (Bing 지원 모두 포함)
- `robots.txt` 에서 Bingbot 허용 + `sitemap_index.xml` 정상
- 해당 URL 이 `post-sitemap.xml` 에 포함 + `lastmod` 최신
- H1, 섹션형 H2, FAQ, 주소/영업시간/예약 팁 등 온페이지 구조 양호

### 문제 (우선순위 순)
1. **최우선**: `canonical` 이 `http://chowlog.xyz/seolyagalbi-cheongdam-review/` 로 박혀있음
2. `og:url`, Yoast JSON-LD `Article/WebPage/Breadcrumb/WebSite` 도 대부분 `http://chowlog.xyz/...` 출력
3. `meta description` 이 2번 중복 출력
4. 스키마 저품질 신호
   - `author = admin`
   - `wordCount = 39`
   - 리뷰 본문 작성자 `재민` 과 Yoast author `admin` 불일치
5. Restaurant 스키마의 `aggregateRating 4.9 / 447` 가 페이지에 근거 없음 → Bing/엔진이 무시할 가능성 (추정)

### 수정 순서 (Codex 제안)
1. WordPress `home/siteurl` 과 Yoast 출력값 전부 https 통일
2. 중복 meta description 제거
3. admin 대신 실제 작성자/퍼블리셔 정보로 schema 정리
4. 근거 없는 `aggregateRating` 이면 삭제
5. 캐시 비우기 + Bing Webmaster Tools 재검사 + IndexNow 재전송

### 참고 레퍼런스
- Bing canonical/duplicate guidance: https://blogs.bing.com/webmaster/December-2025/Does-Duplicate-Content-Hurt-SEO-and-AI-Search-Visibility
- Bing sitemap coverage: https://blogs.bing.com/webmaster/september-2023/How-to-Use-the-new-Sitemap-Index-Coverage-to-Improve-Your-Site-s-Index-Coverage
- Bing lastmod: https://blogs.bing.com/webmaster/february-2023/The-Importance-of-Setting-the-lastmod-Tag-in-Your-Sitemap
- Bing snippet directives: https://blogs.bing.com/webmaster/april-2020/Announcing-new-options-for-webmasters-to-control-their-snippets-at-Bing

---

## 2. Codex 리뷰 #2 — 재확인 (2026-04-22)

### 결론
> 2026-04-22 기준으로 다시 확인해보니 이 URL 은 실질적으로는 아직 거의 안 바뀌었습니다. 바뀐 건 sitemap 갱신 시각이고, Bing 이 중요하게 보는 정본 신호는 그대로입니다.

### 바뀐 점
- `post-sitemap.xml` 에서 이 글 `lastmod` 가 `2026-04-22T00:57:22+00:00` 로 갱신됨

### 안 바뀐 점 (그대로 http:// 또는 그대로 문제)
- 라이브 페이지 `canonical` 이 여전히 `http://chowlog.xyz/seolyagalbi-cheongdam-review/`
- `og:url`, Yoast JSON-LD `Article/WebPage/Breadcrumb/WebSite`, 헤더의 `wp-json` / `shortlink` 계속 `http://chowlog.xyz/...` 출력
- `meta description` 2번 중복 출력 그대로
- `author = admin`, Yoast `wordCount = 39` 그대로

### 관찰
- 응답 헤더에 `x-cache: HIT` → 업데이트했더라도 프런트(캐시)에서 오래된 HTML 을 계속 내보내는 상태일 가능성

### Bing 공개 검색 상태
- `url:https://chowlog.xyz/seolyagalbi-cheongdam-review/` 와 `site:chowlog.xyz 설야갈비 청담` 쿼리에서 이 페이지가 정상적으로 잡히는 것 확인 못 함
- → "아직 Bing 이 이 URL 을 명확한 정본으로 못 보고 있다" 쪽에 가까움

### 다음 우선순위 (Codex 제안)
- `home/siteurl` 과 Yoast 출력값 `https` 통일
- 중복 description 제거
- 페이지/오브젝트/CDN 캐시 purge

---

## 3. 라이브 실측 — 2026-04-22 01:09 UTC (Claude Code curl)

### 응답 헤더
```
HTTP/1.1 200 OK
Server: nginx
X-Pingback: http://chowlog.xyz/xmlrpc.php            ← http://
Link: <http://chowlog.xyz/wp-json/>; rel="https://api.w.org/"
Link: <http://chowlog.xyz/wp-json/wp/v2/posts/6>; rel="alternate"
Link: <http://chowlog.xyz/?p=6>; rel=shortlink
X-Cache: HIT                                         ← 캐시 적중
```

### HTML head
```html
<link rel="canonical" href="http://chowlog.xyz/seolyagalbi-cheongdam-review/" />
<meta name="description" content="청담 저녁 약속을 마치고…" />
<meta name="description" content="청담 저녁 약속을 마치고…" />  ← 중복 2회
<meta property="og:description" content="…" />
<meta property="og:url" content="http://chowlog.xyz/seolyagalbi-cheongdam-review/" />
<meta name="author" content="admin" />
<link rel="https://api.w.org/" href="http://chowlog.xyz/wp-json/" />
<link rel='shortlink' href='http://chowlog.xyz/?p=6' />
```

### Yoast schema graph (요약)
```json
{
  "@type": "Article",
  "@id": "http://chowlog.xyz/seolyagalbi-cheongdam-review/#article",
  "author": {"name": "admin", "@id": "http://chowlog.xyz/#/schema/person/..."},
  "wordCount": 39
},
{
  "@type": "WebPage",
  "url": "http://chowlog.xyz/seolyagalbi-cheongdam-review/",
  "name": "… - ChowLog — 재민의 강남 맛집 기록"
},
{
  "@type": "Person",
  "name": "admin",
  "url": "http://chowlog.xyz/author/admin/"
}
```

### 별도 Review 스키마 (페르소나 기반, bridge-api 생성분)
```json
{
  "@type": "Review",
  "itemReviewed": {"@type": "Restaurant", "name": "설야갈비 청담"},
  "author": {"@type": "Person", "name": "재민"},
  "publisher": {"@type": "Organization", "name": "ChowLog"},
  "url": "https://chowlog.xyz/seolyagalbi-cheongdam-review/"
}
```

### aggregateRating (본문 근거 없음)
```json
"aggregateRating": {"ratingValue": "4.9", "reviewCount": "447", "bestRating": "5", "worstRating": "1"}
```

### 진단 근거
- 응답 헤더 `X-Pingback` / `Link` 까지 `http://` → **WordPress DB 의 `siteurl` / `home` 값이 여전히 `http://chowlog.xyz`** (WordPress core 가 이 값을 기반으로 헤더/JSON-LD/canonical 을 출력)
- `X-Cache: HIT` → nginx fastcgi cache(또는 유사 page cache) 가 과거 HTML 을 계속 서빙
- Yoast `author = admin` / 별도 Review 스키마 `author = 재민` → **한 페이지에 두 identity 공존** (페르소나 → WP user 매핑 미구현의 구조적 결과)

---

## 4. 항목별 반영 상태 표

| # | Codex 지적 | 상태 | 근거 파일 / 라인 |
|---|-------------|------|------------------|
| 1 | canonical `http://` | 🟡 부분반영 | 신규: `scripts/deploy-wp-sites.sh:2366` (https 세팅), 배포 후 보정: `.github/workflows/deploy-bridge.yml:117-154` — 하지만 chowlog.xyz 에는 적용 안 됨 / 캐시 미purge |
| 2 | og:url + Yoast JSON-LD `http://` | 🟡 부분반영 | `bridge-api/src/routes/publish-articles.ts:102` `getSiteBaseUrl()` 은 https 강제. 단, Yoast 자체 JSON-LD 는 제거 안 함 — DB siteurl 기준 재생성 |
| 3 | meta description 중복 | ❌ 미반영 | `publish-articles.ts:855` (`_yoast_wpseo_metadesc`) + `:410/489/713` (JSON-LD description) → 이중 저장 구조 그대로 |
| 4 | author = admin | ❌ 미반영 | `publish-articles.ts:845-857` postData 에 `author` 필드 없음 → WP 기본 admin 할당. 페르소나는 프롬프트 + JSON-LD author 에만 반영 |
| 4b | 작성자 분열 (admin ↔ 재민) | ❌ 미반영 | 페르소나 → WP user 매핑 스크립트 부재. Yoast 와 별도 Review 스키마가 다른 identity 출력 |
| 4c | wordCount = 39 | ❌ 미반영 | `generate-articles.ts:283` wordCount 계산은 정상. AI 본문이 실제로 짧음. 최소 분량 강제 없음 |
| 5 | aggregateRating 근거 부족 | ❌ 미반영 | `bridge-api/src/lib/business-schema.ts:86-97` 본문 정규식 추출 → AI 환각 숫자 그대로 스키마 주입 |
| 6 | 캐시 HIT | ❌ 미반영 | nginx fastcgi / WP object cache purge 자동화 없음 |

---

## 5. 수정 계획 (우선순위 순)

### Phase 1 — 인프라 (가장 영향 큼)
- [ ] **chowlog.xyz 서버 위치 확인** + `wp option get home/siteurl` 현재값 조회
- [ ] **DB search-replace** 로 `http://chowlog.xyz` → `https://chowlog.xyz` 전체 치환 (post_content, postmeta, options) + `wp option update home/siteurl`
- [ ] **캐시 purge** — nginx fastcgi + `wp cache flush` + Redis (필요 시)
- [ ] 라이브 재확인 — canonical/og:url/wp-json/shortlink/JSON-LD 전부 https 로 전환 확인

### Phase 2 — 코드 (이후 생성 글에 영향)
- [ ] **`publish-articles.ts` author 필드 추가** — postData 에 `author: personaWpUserId`
- [ ] **페르소나 → WP user 자동 생성** — 신규 사이트 배포 스크립트 확장
- [ ] **기존 글 post_author backfill** — wp-cli 스크립트
- [ ] **aggregateRating 가드** — `business-schema.ts` 본문 명시적 근거 있을 때만 주입 + 프롬프트에 환각 금지 강화
- [ ] **중복 meta description 제거** — MU-plugin 으로 Yoast 외 중복 차단
- [ ] **AI 최소 분량 강제** — `generate-articles.ts` 프롬프트 + wordCount 미달 시 재생성

### Phase 3 — 검증
- [ ] 라이브 curl 재검증 (모든 Codex 지적 항목 클리어 확인)
- [ ] Bing Webmaster Tools URL Inspection 재검사
- [ ] IndexNow + SubmitUrlBatch 재제출
- [ ] 일정 기간 후 Codex 재리뷰 요청

---

## 변경 이력
| 날짜 | 작성자 | 도구 | 변경 내용 |
|------|--------|------|-----------|
| 2026-04-22 | Hoon | Claude Code | Codex 리뷰 2건 원본 + 라이브 실측(curl) + 반영 상태표 + 수정 계획 초안 작성 |
