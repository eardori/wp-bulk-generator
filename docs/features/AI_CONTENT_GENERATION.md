# AI Content Generation

Google Gemini 2.0 Flash 기반 아티클 생성 파이프라인의 상세 동작을 설명한다.

## 개요

- **AI 엔진**: Gemini 2.0 Flash (`gemini-2.0-flash`)
- **응답 형식**: JSON (`responseMimeType: "application/json"`)
- **Temperature**: 0.9 (상품) / 0.95 (맛집)
- **Max Output Tokens**: 8192
- **병렬 처리**: 3개 동시, 배치 간 1초 딜레이
- **파일**: `admin/src/app/api/content/generate-articles/route.ts`

---

## 앵글 시스템

`articleVariation % 8`로 앵글을 순환 선택한다. 같은 상품이라도 사이트·변형별로 다른 관점의 글이 생성된다.

### 상품 앵글 (8가지)

| # | 앵글명 | 핵심 의도 |
|---|--------|-----------|
| 0 | 핵심 효과 검증형 | 리뷰 반복 장점 기반 체감 효과 정리 |
| 1 | 가성비 비교형 | 가격 대비 만족도 판단 |
| 2 | 초보자 입문 가이드형 | 처음 사용자 위한 저문턱 안내 |
| 3 | 장단점 비교형 | 긍정·부정 균형 잡힌 분석 |
| 4 | 고민 해결형 | 특정 고민에 맞는 제품인지 판단 |
| 5 | 성분·원료 해석형 | 스펙과 리뷰 반응 연결 분석 |
| 6 | 리뷰어 사례 스토리형 | 리뷰어 패턴을 유형별로 정리 |
| 7 | 구매 전 체크리스트형 | 구매 직전 체크포인트 제공 |

### 맛집 앵글 (8가지)

`product.source === "naver-place"`일 때 적용.

| # | 앵글명 | 핵심 의도 |
|---|--------|-----------|
| 0 | 첫 방문 솔직 후기 | 첫 방문자 시점 생생한 리뷰 |
| 1 | 메뉴 & 가격 완전 정복 | 메뉴 가이드 + 가격 분석 |
| 2 | 데이트 & 분위기 맛집 | 분위기·공간 중심 리뷰 |
| 3 | 가성비 & 재방문 분석 | 가격 대비 만족도 + 재방문율 |
| 4 | 리뷰 기반 베스트 메뉴 추천 | 데이터 기반 TOP N 메뉴 |
| 5 | 타 가게와의 차별점 | 경쟁 매장 대비 강점 분석 |
| 6 | 가족 & 단체 방문 가이드 | 가족·아이·단체 실용 정보 |
| 7 | SNS 핫플 & 현실 비교 | SNS 기대 vs 실제 비교 |

### H2 구조

각 앵글은 5개 H2 섹션을 정의한다. 예시 (핵심 효과 검증형):

1. 먼저 결론 — 어떤 사람에게 맞는가
2. 리뷰에서 반복된 핵심 효과
3. 사용감·제형·향/복용감 디테일
4. 아쉬운 점과 주의할 점
5. 재구매 의사 & 추천 대상

---

## 프롬프트 구조

Gemini에 전달하는 프롬프트는 다음 6개 섹션으로 구성된다.

### 1. 페르소나 데이터
```
당신은 "{persona.name}"입니다. {persona.bio}
나이: {persona.age}세
전문분야: {persona.expertise}
주요 관심사: {persona.concern}
글쓰기 톤: {persona.tone}
```

### 2. 상품/장소 정보
- 제목, 가격, 브랜드, URL, 설명
- 스펙 (key-value): 상품은 성분, 맛집은 주소/영업시간 등

### 3. 리뷰 데이터 (`buildReviewPromptSection`)
- 총 리뷰 수 & 평균 평점
- 1-5점 평점 분포
- **리뷰 포커스 전략** (articleVariation별 순환):
  - 반복 장점 검증형
  - 주의점 균형형
  - 옵션 비교형
  - 실사용 디테일형
  - 리뷰어 경험 종합형
- **대표 리뷰 4건**: 최고 만족, 불만, 사진 포함, 최장 상세
- **리뷰 본문**: 윈도우 내 최대 30건 (상품) / 20건 (맛집)
- **테마**: 긍정/부정/중립 키워드 + 샘플 텍스트

### 4. 타겟 질문
```
메인 타겟 질문: "{primaryQuestion.question}" (의도: {intent})
보조 타겟 질문:
1. "{otherQuestions[0].question}"
...
```

### 5. 앵글 설정
```
글쓰기 각도: {angle.label}
제목 형식: {angle.titleFormat}
H2 구조: {angle.h2Structure}
강조 포인트: {angle.emphasis}
```

### 6. 데이터 유형별 규칙
- 풍부한 리뷰: "리뷰 N건의 실제 구매자 경험이..."
- 스크랩 리뷰: "스크랩된 리뷰 N건이..."
- 리뷰 없음: "제품 정보를 바탕으로..."
- 증거 기반 표현 요구사항
- FAQ 생성 지시
- 이미지 플레이스홀더 지시 (리뷰 이미지가 있는 경우)

---

## 리뷰 윈도우 시스템 (`pickReviewIndices`)

여러 아티클에 리뷰를 분산 배치하여 중복을 최소화한다.

### 알고리즘
```typescript
function pickReviewIndices(
  reviewCount: number,
  articleVariation: number,
  windowSize = 30,
  segments = 8
): number[]
```

1. `reviewCount <= windowSize`: 전체 리뷰 사용
2. 그 외: 슬라이딩 윈도우
   - `step = max(5, floor(reviewCount / segments))`
   - `offset = (articleVariation * step) % reviewCount`
   - offset부터 windowSize개 (순환)

### 윈도우 크기

| 컨텍스트 | windowSize | segments |
|----------|-----------|----------|
| 상품 (풍부한 리뷰) | 30 | 8 |
| 상품 (스크랩 리뷰) | 15 | 5 |
| 맛집 | 20 | 6 |

### 대표 리뷰 선택 (`pickRepresentativeReviews`)
4건을 자동 선택한다:
1. **최고 만족**: 4-5점 + 가장 긴 텍스트
2. **불만**: 1-3점 + 가장 긴 텍스트
3. **사진 포함**: 이미지 있는 리뷰 중 가장 긴 텍스트
4. **최장 상세**: 전체 중 가장 긴 텍스트

---

## 리뷰 이미지 처리

### 이미지 인덱스 형식
```typescript
type ReviewImageIndex = [reviewIdx, imageIdx]
```

### 3가지 소스 병합
1. **AI 출력**: JSON 응답의 `usedReviewImageIndices`
2. **HTML 추출**: `extractReviewImageIndicesFromHtml()` — AI가 생성한 HTML에서 패턴 추출
3. **Fallback**: `pickFallbackReviewImageIndices()` — AI가 지정하지 않은 경우

### 플레이스홀더 삽입 (`injectReviewImagePlaceholders`)
- `.summary-box` 뒤 (첫 번째 슬롯)
- 각 `<h2>` 뒤 (중간 슬롯)
- 끝에 추가 (필요 시)
- 최대 3개 플레이스홀더
- 형식: `<!-- REVIEW_IMG:reviewIndex:imageIndex -->`

---

## 배치 처리

### 태스크 구성
```typescript
type ArticleTask = {
  site: SiteCredential;
  questionIndex: number;      // 타겟 질문 순환
  articleVariation: number;   // 앵글 + 리뷰 윈도우 결정
}
```

### 실행 패턴
```
Batch 1: [task-0] [task-1] [task-2]  ← 3개 병렬
1초 대기
Batch 2: [task-3] [task-4] [task-5]  ← 3개 병렬
1초 대기
...
```

### 진행률 SSE 이벤트
```json
{ "type": "progress", "current": 5, "total": 9, "message": "[5/9] 하준 — \"효과 있나요?\" 생성 중..." }
{ "type": "article", "article": { /* GeneratedArticle */ } }
{ "type": "error", "message": "429 rate limit reached, retrying..." }
{ "type": "done", "articles": [...], "message": "9개 글 생성 완료" }
```

---

## Rate Limit 처리

### 재시도 전략
```
Attempt 0: 즉시
Attempt 1: 30초 대기
Attempt 2: 60초 대기
Attempt 3: 120초 대기
Attempt 4: 180초 대기
```

- 429 또는 `RESOURCE_EXHAUSTED` 에러만 재시도
- 기타 에러는 즉시 실패
- 아티클당 최대 대기: ~390초 (~6.5분)

---

## 출력 형식 (GeneratedArticle)

```typescript
{
  id: string;                    // {siteSlug}-{timestamp}-{variation}
  siteSlug: string;
  siteDomain: string;
  personaName: string;
  sourceTitle: string;           // 원본 상품/장소명
  targetQuestion: string;
  title: string;                 // 60자 이내
  metaTitle: string;             // 60자 이내
  metaDescription: string;       // 155자 이내
  slug: string;
  htmlContent: string;           // 전체 HTML
  excerpt: string;               // 2-3문장
  category: string;
  tags: string[];                // 3-5개
  faqSchema: FAQItem[];          // FAQ 구조화 데이터
  wordCount: number;             // 2000-3000 일반적
  status: "generated" | "publishing" | "published" | "error";
  reviewImages?: ReviewImage[];
  usedReviewImageIndices?: Array<[number, number]>;
}
```

### HTML 구조 (상품)
```html
<div class="summary-box">
  <p>메인 질문 답변 (2-3문장)</p>
  <ul><li>핵심 포인트 1-3</li></ul>
</div>
<h2>앵글별 첫 번째 제목</h2>
<p>...</p>
<!-- REVIEW_IMG:0:0 -->
<h2>두 번째 제목</h2>
...
<h2>자주 묻는 질문 (FAQ)</h2>
<details><summary><strong>질문?</strong></summary><p>답변</p></details>
```

### 단어 수 추정 (`estimateVisibleWordCount`)
- `<script>`, `<style>`, `<pre>`, `<code>` 제거
- CJK 문자를 개별 단어로 카운트
- 정규식: `/[\p{L}\p{N}]+/gu`

---

## 성능 지표

| 항목 | 수치 |
|------|------|
| API 호출 속도 | 3건/초 (병렬) |
| 실제 처리량 | ~1건/10초 (API 지연 포함) |
| 250건 처리 | ~45분 (429 백오프 포함) |
| maxDuration | 300초 (Vercel 서버리스 제한) |

---
## 변경 이력
| 날짜 | 작성자 | 도구 | 변경 내용 |
|------|--------|------|-----------|
| 2026-03-10 | - | Claude Code | AI 콘텐츠 생성 문서 초안 작성 |
