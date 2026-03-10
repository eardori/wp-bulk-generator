# API Reference

모든 API는 `admin/src/app/api/` 하위에 Next.js Route Handler로 구현.
장시간 작업은 SSE 스트리밍(`text/event-stream`)으로 응답.

## 콘텐츠 API

### POST /api/content/scrape-product
상품 URL에서 정보를 스크래핑.

| 항목 | 값 |
|------|------|
| maxDuration | 45초 |
| 스트리밍 | 아니오 |
| 파일 | `admin/src/app/api/content/scrape-product/route.ts` |

**Request:**
```json
{ "url": "https://smartstore.naver.com/..." }
```

**Response:** `ScrapedProduct`
```json
{
  "url": "", "title": "", "description": "", "price": "",
  "images": [], "specs": {}, "reviews": [],
  "rating": 0, "reviewCount": 0, "brand": "", "category": "", "source": "",
  "reviewApiParams": { "source": "naver", "merchantNo": "", "originProductNo": "" }
}
```

**지원 소스:** Naver Smart Store, Naver Brand, Coupang, Olive Young, 11번가, iHerb, Naver Place, Generic

---

### POST /api/content/fetch-reviews
상품의 고객 리뷰를 수집.

| 항목 | 값 |
|------|------|
| maxDuration | 300초 |
| 스트리밍 | SSE (진행률) |
| 파일 | `admin/src/app/api/content/fetch-reviews/route.ts` |

**Request:**
```json
{
  "source": "naver",
  "merchantNo": "...",
  "originProductNo": "...",
  "productTitle": "..."
}
```

**SSE Events:**
- `{ type: "progress", message: "...", current: N, total: M }`
- `{ type: "complete", reviews: ReviewCollection }`

**ReviewCollection:**
```json
{
  "reviews": [{ "text": "", "rating": 5, "images": [], "reviewer": "", "date": "" }],
  "totalCount": 0, "averageRating": 0,
  "ratingDistribution": { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
  "themes": [{ "keyword": "", "count": 0, "sentiment": "positive" }]
}
```

---

### POST /api/content/generate-articles
AI로 아티클을 생성.

| 항목 | 값 |
|------|------|
| maxDuration | 300초 |
| 스트리밍 | SSE (아티클별 진행) |
| 병렬 처리 | 3개 동시 |
| AI 엔진 | Google Gemini 2.0 Flash |
| 파일 | `admin/src/app/api/content/generate-articles/route.ts` |

**Request:**
```json
{
  "product": { "ScrapedProduct" },
  "reviews": { "ReviewCollection" },
  "sites": [{ "slug": "", "domain": "", "persona": {}, "app_pass": "" }],
  "questions": [{ "text": "", "intent": "recommendation" }],
  "articlesPerSite": 2
}
```

**SSE Events:**
- `{ type: "progress", siteSlug: "", current: N, total: M }`
- `{ type: "article", article: GeneratedArticle }`
- `{ type: "complete", articles: GeneratedArticle[] }`

**GeneratedArticle:**
```json
{
  "id": "", "siteSlug": "", "siteDomain": "", "personaName": "",
  "sourceTitle": "", "targetQuestion": "",
  "title": "", "metaTitle": "", "metaDescription": "", "slug": "",
  "htmlContent": "", "excerpt": "", "category": "", "tags": [],
  "faqSchema": [], "wordCount": 0, "status": "generated",
  "reviewImages": [], "usedReviewImageIndices": []
}
```

---

### POST /api/content/publish-articles
생성된 아티클을 WordPress에 발행.

| 항목 | 값 |
|------|------|
| maxDuration | 300초 |
| 스트리밍 | SSE (발행별 진행) |
| 파일 | `admin/src/app/api/content/publish-articles/route.ts` |

**Request:**
```json
{
  "articles": [{ "GeneratedArticle + siteCredentials" }]
}
```

**SSE Events:**
- `{ type: "progress", siteSlug: "", title: "", status: "uploading_images" }`
- `{ type: "published", siteSlug: "", title: "", url: "https://..." }`
- `{ type: "complete", results: [] }`

**발행 과정:**
1. 리뷰 이미지 다운로드 (curl + iPhone user-agent)
2. WordPress 미디어 업로드 (`/wp-json/wp/v2/media`)
3. 이미지 플레이스홀더 → 실제 URL 치환
4. 카테고리/태그 생성
5. FAQ + Article Schema JSON-LD 삽입
6. 포스트 생성 (`/wp-json/wp/v2/posts`)
7. 캐시 워밍 (홈, robots.txt, sitemap, 포스트 URL)

---

### POST /api/content/seo-optimize
기존 WordPress 포스트의 SEO를 최적화.

| 항목 | 값 |
|------|------|
| maxDuration | 300초 |
| 스트리밍 | SSE |
| 파일 | `admin/src/app/api/content/seo-optimize/route.ts` |

**최적화 항목:**
- FAQ Schema JSON-LD 생성 (h3 질문 + p 답변 패턴 감지)
- Article Schema JSON-LD 생성
- 이미지 alt 태그 개선
- Yoast SEO 메타 타이틀/설명 설정

---

### GET /api/content/fetch-sites
배포된 사이트 목록 + 인증 정보 조회.

| 항목 | 값 |
|------|------|
| 파일 | `admin/src/app/api/content/fetch-sites/route.ts` |

**Response:** `SiteCredential[]`
- `.cache/sites-credentials.json` + `configs/sites-config.json` 머지

---

### POST /api/content/site-groups
사이트 그룹 CRUD.

| 항목 | 값 |
|------|------|
| 파일 | `admin/src/app/api/content/site-groups/route.ts` |

**Actions:** create, update, delete
**저장소:** `.cache/site-groups.json`

---

## 인프라 API

### POST /api/generate-configs
AI로 사이트 설정 템플릿을 생성.

| 항목 | 값 |
|------|------|
| maxDuration | 300초 |
| 스트리밍 | SSE |
| AI 엔진 | Gemini |
| 파일 | `admin/src/app/api/generate-configs/route.ts` |

**생성 항목:** site_slug, domain, site_title, tagline, persona, color_scheme, categories, initial_post_topics, layout_preference

---

### POST /api/deploy-sites
SSH로 EC2에 WordPress 사이트를 일괄 배포.

| 항목 | 값 |
|------|------|
| maxDuration | 600초 |
| 스트리밍 | SSE (진행률) |
| 파일 | `admin/src/app/api/deploy-sites/route.ts` |

**과정:** 설정 검증 → 스크립트 전송 → sudo 실행 → 진행률 파싱 → 인증 정보 회수

---

### GET /api/dashboard
전체 사이트의 발행 포스트 현황.

| 항목 | 값 |
|------|------|
| 스트리밍 | SSE |
| 파일 | `admin/src/app/api/dashboard/route.ts` |

**응답:** 사이트별 최근 15개 포스트 + 총 포스트 수

---

### GET /api/server-status
EC2 서버 상태 확인.

| 항목 | 값 |
|------|------|
| Timeout | 15초 |
| 파일 | `admin/src/app/api/server-status/route.ts` |

**응답:** 메모리 (free/used/%), 디스크 사용량, 사이트 수

---
## 변경 이력
| 날짜 | 작성자 | 도구 | 변경 내용 |
|------|--------|------|-----------|
| 2026-03-10 | - | Claude Code | API 레퍼런스 초안 작성 |
