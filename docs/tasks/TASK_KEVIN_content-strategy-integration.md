# [요청] SEO 콘텐츠 전략 시스템 통합

- **요청자**: Hoon (PM)
- **담당자**: Kevin (BE)
- **우선순위**: 높음
- **상태**: 대기 중

---

## 목적

맛집 AI 콘텐츠 생성 시, 캠페인별 SEO/AEO 최적화 전략(타겟 키워드, 시맨틱 키워드, 핵심 경험담 등)을 주입할 수 있는 시스템 추가.

첫 번째 적용 대상: **설야갈비 캠페인** (`configs/content-strategies/seolya-galbi.json` 이미 생성 완료)

---

## 설정 파일 (PM 관리 완료)

`configs/content-strategies/seolya-galbi.json`에 아래 구조로 설정 파일을 이미 생성해두었음:

| 필드 | 설명 |
|------|------|
| `targetKeywords[]` | 타겟 키워드 18개 배열 (랜덤 1개 추출) |
| `semanticKeywords[]` | 시맨틱/연관 키워드 8개 |
| `keywordOptimization` | 제목/도입부/H2 키워드 배치 규칙 |
| `htmlStructureRules` | bullet point 사용, Q&A 결말 구조 규칙 |
| `coreNarratives[]` | 반드시 포함할 핵심 경험담 3개 |
| `toneOverride` | 톤앤매너 오버라이드 ("자연스러운 일상어") |

---

## 코드 변경 요청

### 1. 타입 정의 추가
**파일**: `bridge-api/src/routes/generate-articles.ts` (상단 Types 섹션)

```typescript
type ContentStrategy = {
  name: string;
  toneOverride?: string;
  targetKeywords?: string[];
  semanticKeywords?: string[];
  keywordOptimization?: {
    titleRule?: string;
    introRule?: string;
    h2Rule?: string;
  };
  htmlStructureRules?: {
    useBulletPoints?: string;
    endingSection?: string;
  };
  coreNarratives?: Array<{
    label: string;
    content: string;
  }>;
};
```

### 2. `generateForSite` 함수 수정
**위치**: L538 함수 시그니처

- 매개변수에 `contentStrategy?: ContentStrategy` 추가
- 맛집 프롬프트 생성 시:
  - `targetKeywords`에서 `Math.random()`으로 1개 추출 → `selectedKeyword`
  - 톤 오버라이드: `contentStrategy.toneOverride`가 있으면 페르소나 톤 대신 사용 (단, "페르소나 특성 유지하면서"로 지시)
  - 기존 작성 규칙(L825~L839) 뒤에 SEO 전략 블록을 프롬프트에 삽입

### 3. 프롬프트에 주입할 SEO 전략 블록 (contentStrategy가 있을 때만)

```
## SEO 콘텐츠 전략 (반드시 준수):

### 이번 글의 타겟 키워드: "{selectedKeyword}"
- 제목: {keywordOptimization.titleRule}
- 도입부: {keywordOptimization.introRule}
- H2: {keywordOptimization.h2Rule}

### 시맨틱 키워드 (본문 전체에 문맥에 맞게 자연스럽게 분산 배치):
{semanticKeywords를 쉼표로 나열}

### 반드시 포함할 핵심 경험담:
{coreNarratives를 번호 매겨서 나열}

### 추가 HTML 구조 규칙:
- {htmlStructureRules.useBulletPoints}
- {htmlStructureRules.endingSection}
```

### 4. Route 핸들러 수정
**위치**: L1108 `generateArticlesRoutes`

- `req.body`에서 `contentStrategy` 수신
- `generateForSite()` 호출 시 전달

### 5. 기존 시스템과 충돌 방지 (중요)

| 항목 | 기존 | 전략 추가 시 | 해결 |
|------|------|-------------|------|
| 톤 | 페르소나 `tone` | `toneOverride` | 전략 톤 우선, 페르소나 특성 유지 지시 |
| H2 구조 | 앵글별 H2 5개 | "나의 총평" 추가 | 앵글 H2 뒤에 추가 섹션으로 배치 |
| FAQ | 기존 FAQ 4개 | Q&A 2~3개 | "나의 총평" 안에 자연스럽게 포함, 기존 FAQ 유지 |

---

## 검증 방법

```bash
cd bridge-api && npx tsc --noEmit   # TypeScript 빌드 확인
```

실제 글 생성 테스트:
- 설야갈비 데이터 + contentStrategy 전달 → 생성된 글에서 타겟 키워드, 경험담, Q&A 결말 확인

---

## 변경 이력
| 날짜 | 작성자 | 도구 | 변경 내용 |
|------|--------|------|-----------|
| 2026-03-14 | Hoon | Antigravity | Kevin 작업 요청서 초안 작성 |
