# Scraping Engine Guide

상품/맛집 정보를 수집하는 6개 스크래핑 엔진 + 범용 fallback 동작 방식을 설명한다.

## 소스 감지 방식

URL 패턴으로 자동 판별한다.

| 소스 | URL 패턴 | 방식 |
|------|----------|------|
| Naver Smart Store | `smartstore.naver.com`, `brand.naver.com` | curl → mobile fetch → fetch |
| Coupang | `coupang.com` | fetch (desktop → mobile) |
| Olive Young | `oliveyoung.co.kr` | Playwright only |
| Naver Place | `map.naver.com`, `pcmap.place.naver.com` | Playwright only |
| iHerb | `iherb.com` | fetch |
| 11번가 | `11st.co.kr` | fetch |
| Generic | 위 미매칭 | fetch + OG/JSON-LD fallback |

---

## 1. Naver Smart Store / Brand Store

**파일**: `admin/src/app/api/content/scrape-product/route.ts` (L279-443)

### Fallback 체인
```
curl (10s timeout) → mobile fetch (12s) → standard fetch (12s)
```
- curl 사용 이유: Node.js fetch는 네이버에서 429 rate limit 발생
- User-Agent: iPhone iOS 17 모바일

### 데이터 추출
- **1차 소스**: `window.__PRELOADED_STATE__` JSON (정규식 추출)
  - `simpleProductForDetailPage.A` — 상품명, 가격, 채널
  - `product.A` — 상세 정보, 이미지
  - `productReviewSummary.A` — 리뷰 수, 평점
  - `selectedOptions.A` — 옵션 정보
- **2차 소스**: OG 태그 (`og:title`, `og:description`, `og:image`)
- **3차 소스**: HTML `<title>`

### 가격
- 우선순위: `discountedSalePrice` → `salePrice`
- 형식: "원" 통화 포맷

### 리뷰 API 파라미터
- `merchantNo`, `originProductNo` — preloaded state에서 추출
- `channelNo` — 채널 데이터에서 추출
- Fallback: URL에서 `productNo` 정규식 추출 (`/products/(\d+)`)

### 유효성 검증
- 에러 패턴 감지: `[에러]`, `시스템오류`, `error page`, `access denied`
- 제목 3자 미만: 수동 입력 폼으로 전환

---

## 2. Coupang

**파일**: `admin/src/app/api/content/scrape-product/route.ts` (L445-512)

### Fallback 체인
```
desktop fetch (12s) → mobile fetch (m.coupang.com, 12s)
```

### 주요 CSS 셀렉터

| 항목 | 셀렉터 (Cascade) |
|------|-------------------|
| 제목 | `.prod-buy-header__title` → `h1.prod-title` → `h2.prod-title` → `.prod-title-text` |
| 가격 | `.total-price strong` → `.prod-sale-price .total-price` → `.prod-price__price` |
| 이미지 | `.prod-image__item img` → `.prod-image img` → `.gallery__image img` |
| 스펙 | `.prod-attr-item` 또는 `.prod-description-attribute li` |
| 리뷰 | `.sdp-review__article__list__review` (최대 10개) |
| 평점 | `.rating-star-num` 또는 `.prod-rating__number` |

- 이미지 속성: `src`, `data-img-src`, `data-src` 순으로 탐색

---

## 3. Olive Young

**파일**: `admin/src/app/api/content/scrape-product/route.ts` (L514-625)

### 왜 Playwright인가
Cloudflare가 JA3/JA4 TLS 핑거프린트로 Node.js fetch를 차단한다.

### 브라우저 설정
- Anti-detection: `--disable-blink-features=AutomationControlled`
- User-Agent: iPhone iOS 17 모바일
- Viewport: 390×844
- Timeout: 45s (페이지), 20s (Cloudflare 챌린지)

### 데이터 추출
1. URL에서 `goodsNo` 추출 (`?goodsNo=XXXXX`)
2. **1차**: 브라우저 내 Same-origin fetch — `/review/api/v2/reviews/{goodsNo}/stats`
   - `goodsName`, `goodsImg`, `reviewCount`, `averageRating`
3. **2차**: DOM 파싱
   - 제목: `.prd_name h1.prd_name`
   - 가격: `.price-2 strong` → `.price strong` → `.goods_price strong`
   - 이미지: `.swiper-slide img` (data: URI 필터링)

### 리뷰 수집 (Playwright 전용)
- **파일**: `admin/src/app/api/content/fetch-reviews/route.ts` (L177-443)
- API: `POST /review/api/v2/reviews` (브라우저 컨텍스트에서 fetch)
- 페이지네이션: 최대 25페이지 × 20건 = 500건
- 최소 텍스트 길이: 30자
- 이미지 URL: `https://image.oliveyoung.co.kr/uploads/images/gdasEditor/{imagePath}`
- 페이지 간 딜레이: 300ms

### 메모리 최적화
- 이미지/폰트 요청 차단 (JS/CSS는 Cloudflare 통과를 위해 유지)
- 요청마다 새 context 생성 → 완료 후 즉시 정리

---

## 4. Naver Place (맛집/카페)

**파일**: `admin/src/app/api/content/scrape-product/route.ts` (L627-923)

### 브라우저 설정
- Playwright (데스크톱 Chrome)
- Timeout: 45s (전체), 18s (네비게이션)
- Settle Time: 1200ms (페이지 로드 후)

### Place ID 추출
- 정규식: `/place/(\d+)`, `/restaurant/(\d+)`, `/cafe/(\d+)`, `/entry/place/(\d+)`

### 데이터 추출

| 항목 | 소스 |
|------|------|
| 상호명 | `h1` 또는 `.GHAhO` 또는 `.place_name_area h2` |
| 카테고리 | `.lnJFt span.lnJFt` |
| 이미지 | `img[src*='ldb-phinf']` (pstatic CDN) |
| 주소 | 정규식 (도/시/구 패턴, 첫 100자) |
| 전화 | 정규식 `0507-XXXX-XXXX` 또는 `0XX-XXXX-XXXX` |
| 영업시간 | `.A_cdD` 또는 `[class*='bizHour']` |
| AI 브리핑 | `.zPfVt`, `.YH3Gk`, `.pui__vn15t2` (10개, >20자) |
| 키워드 | `.Bd1dx button`, `.keyword_list button` (15개) |

### 리뷰 수집 (인터랙티브)
- URL: `/restaurant/{placeId}/review/visitor` 또는 `/place/{placeId}/review/visitor`
- "더보기" 버튼 클릭: `.pui__wFzIYl` (개별 리뷰 펼치기)
- "펼쳐서 더보기" 클릭: 최대 15회 (글로벌 로드 버튼)
- 목표: 50건, 최소 텍스트 15자
- 중복 제거: 첫 120자로 키 생성
- 이미지: CDN 감지 + 이모지/프로필/아이콘 필터링, 리뷰당 최대 4장

---

## 5. iHerb

**파일**: `admin/src/app/api/content/scrape-product/route.ts` (L1067-1111)

### 스크래핑 방식
- `fetch()` (데스크톱 Chrome UA, 12s timeout)
- Schema.org `itemprop` 셀렉터 활용

### CSS 셀렉터

| 항목 | 셀렉터 |
|------|--------|
| 제목 | `h1[itemprop='name']` → `#name` |
| 가격 | `[itemprop='price']` → `#price` |
| 설명 | `[itemprop='description']` → `.product-overview` |
| 브랜드 | `[itemprop='brand'] span` → `.brand-name` |
| 이미지 | `[itemprop='image']` → `.product-image img` |
| 스펙 | `.supplement-facts tr`, `.product-detail-table tr` |
| 리뷰 | `.review-text`, `[itemprop='reviewBody']` (최대 10개) |

---

## 6. 11번가

**파일**: `admin/src/app/api/content/scrape-product/route.ts` (L1036-1065)

### 스크래핑 방식
- `fetch()` (데스크톱 Chrome UA, 12s timeout)

### CSS 셀렉터

| 항목 | 셀렉터 |
|------|--------|
| 제목 | `.heading_product h1` → `#productName` |
| 가격 | `.price_detail .value` → `.sale_price .value` |
| 설명 | `.product_info` → `.product_detail` |
| 브랜드 | `.brand a` → `.brand_name` |
| 이미지 | `.img_full img` → `.product_image img` → `.thumb_list img` |

- 리뷰 수집 미지원 (reviews: [], reviewCount: 0)

---

## 7. Generic Fallback

모든 소스에 매칭되지 않을 때 적용.

### 추출 순서
1. 첫 `h1` 또는 `h2` → 제목
2. `[class*='price']`, `[itemprop='price']` → 가격
3. `[itemprop='description']`, `meta[name='description']` → 설명
4. "product/item/img" 키워드 포함 이미지 → 상품 이미지 (로고/아이콘/SVG 제외)

---

## 공통 Fallback 레이어

모든 소스 파서 실행 후 순차 적용:

### OpenGraph 태그 (`fillFromOpenGraph`)
- `og:title`, `og:description`, `og:image`
- 개별 파서에서 누락된 필드만 채움

### JSON-LD 구조화 데이터 (`fillFromJsonLd`)
- `@type: Product` 스키마 추출
- name, description, brand, price, image, aggregateRating, review
- 리뷰: `reviewBody` 또는 `description`, `reviewRating.ratingValue`

### HTML Title
- 최종 fallback: `<title>` 태그

---

## 리뷰 수집 API

### Naver 리뷰
- **파일**: `admin/src/app/api/content/fetch-reviews/route.ts` (L86-175)
- API: `https://smartstore.naver.com/i/v1/reviews/paged-reviews`
- 파라미터: merchantNo, originProductNo, page (1-5), pageSize (20), sortType=REVIEW_RANKING
- 페이지 간 딜레이: 500ms

### 테마 추출 (공통)
- 24개 키워드 기반 감성 분석: 보습, 촉촉, 흡수, 가격, 자극, 트러블, 재구매 등
- 키워드별 카운트 + 샘플 텍스트
- 1-5점 평점 분포 계산
- 상위 15개 테마 빈도순 반환

---

## Timeout 계층

| 엔진 | curl | fetch | Playwright 페이지 | 전체 |
|------|------|-------|-------------------|------|
| Naver | 10s | 12s | - | - |
| Coupang | - | 12s | - | - |
| Olive Young | - | - | 45s | - |
| Naver Place | - | - | 18s | 45s |
| iHerb | - | 12s | - | - |
| 11번가 | - | 12s | - | - |

---
## 변경 이력
| 날짜 | 작성자 | 도구 | 변경 내용 |
|------|--------|------|-----------|
| 2026-03-10 | - | Claude Code | 스크래핑 엔진 가이드 초안 작성 |
