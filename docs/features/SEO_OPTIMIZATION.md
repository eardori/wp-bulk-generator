# SEO Optimization

콘텐츠 생성-발행-사후 최적화 전 단계에 걸친 SEO 전략을 설명한다.

## SEO 3-Layer 전략

| Layer | 시점 | 구현 |
|-------|------|------|
| **Layer 1** | 콘텐츠 생성 | AI가 SEO 메타데이터 포함 생성 |
| **Layer 2** | WordPress 발행 | Schema JSON-LD 삽입 + Yoast 설정 |
| **Layer 3** | 사후 최적화 | 기존 포스트 일괄 개선 |

---

## Layer 1: 콘텐츠 생성 시 SEO

**파일**: `admin/src/app/api/content/generate-articles/route.ts`

Gemini AI가 아티클 생성 시 포함하는 SEO 요소:

| 항목 | 규격 | 용도 |
|------|------|------|
| `title` | 60자 이내 | 포스트 제목 (H1) |
| `metaTitle` | 60자 이내 | 검색 결과 제목 |
| `metaDescription` | 155자 이내 | 검색 결과 스니펫 |
| `slug` | 소문자 하이픈 | URL 경로 |
| `excerpt` | 2-3문장 | 발췌문 |
| `category` | 단일 카테고리 | 분류 |
| `tags` | 3-5개 키워드 | 태그 |
| `faqSchema` | Q&A 배열 | FAQ 구조화 데이터 |

---

## Layer 2: 발행 시 SEO

**파일**: `admin/src/app/api/content/publish-articles/route.ts`

### Article Schema JSON-LD
```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "아티클 제목",
  "description": "메타 설명",
  "author": { "@type": "Person", "name": "페르소나명" },
  "datePublished": "2026-03-10T...",
  "dateModified": "2026-03-10T...",
  "publisher": { "@type": "Organization", "name": "사이트명" },
  "keywords": ["태그1", "태그2"]
}
```

### FAQ Schema JSON-LD
```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "질문?",
      "acceptedAnswer": { "@type": "Answer", "text": "답변" }
    }
  ]
}
```

FAQ 패턴 감지:
1. `<h3>질문?</h3> <p>답변</p>` (h3 + 다음 p)
2. `<strong>질문?</strong>` + 다음 `<p>`
3. `<dl><dt>질문</dt><dd>답변</dd></dl>`

### 이미지 Alt 태그 최적화
- 일반적 alt ("실제 구매자 리뷰 사진", "image") → 상품명 포함으로 변경
- 예: `alt="뉴트리데일리 관련 이미지 1"`

### Yoast SEO 메타 설정
- `_yoast_wpseo_title`: 메타 타이틀
- `_yoast_wpseo_metadesc`: 메타 디스크립션
- REST API meta 필드로 설정

### 캐시 워밍
발행 후 다음 URL을 사전 요청:
1. 홈페이지 (`/`)
2. `robots.txt`
3. `sitemap_index.xml`
4. `wp-sitemap.xml`
5. 포스트 URL

---

## Layer 3: 사후 최적화

**API**: `POST /api/content/seo-optimize`
**파일**: `admin/src/app/api/content/seo-optimize/route.ts`

### 최적화 항목
1. 기존 포스트에 JSON-LD 스키마 없으면 삽입
2. 이미지 alt 태그 개선
3. Yoast 메타 필드 비어있으면 채움

### 동작 방식
- 페이지네이션: 10개씩 조회
- 중복 방지: `application/ld+json` 이미 있으면 skip
- maxDuration: 300초

### SSE 이벤트
```json
{ "type": "site-start", "siteSlug": "nutri-daily" }
{ "type": "skip", "postId": 123, "reason": "already has JSON-LD" }
{ "type": "updated", "postId": 456 }
{ "type": "site-done", "siteSlug": "nutri-daily", "updated": 15 }
{ "type": "done", "totalUpdated": 45 }
```

---

## robots.txt

각 사이트에 자동 생성. AI 크롤러를 명시적으로 허용한다.

```
User-agent: *
Allow: /

User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Anthropic-ai
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Bytespider
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Applebot-Extended
Allow: /

Sitemap: https://example.site/sitemap_index.xml
```

---

## 정적 사이트맵

**파일**: `scripts/generate-static-sitemaps.sh`

- MySQL 직접 쿼리로 발행된 포스트 추출
- `sitemap_index.xml` 생성 (홈 + 최대 1000개 포스트)
- Nginx: `expires 5m` 캐시
- 위치: `/var/www/{site-slug}/sitemap_index.xml`

---

## MU-Plugin: ai-seo-optimize.php

배포 시 자동 설치되는 SEO 보조 플러그인:

- Canonical URL 삽입 (priority: 1, head 최상단)
- 빈 검색/아카이브 페이지 noindex
- 메타 설명 fallback (Yoast → 발췌문 → 본문 미리보기)
- Open Graph fallback (Yoast 미활성 시)

---

## Yoast SEO 플러그인

배포 시 자동 설치·활성화:
- 사이트맵 자동 생성 (`/wp-sitemap.xml`)
- 메타 타이틀/설명 관리
- Open Graph 태그 자동 생성
- Breadcrumb 지원

---
## 변경 이력
| 날짜 | 작성자 | 도구 | 변경 내용 |
|------|--------|------|-----------|
| 2026-03-10 | - | Claude Code | SEO 최적화 문서 초안 작성 |
