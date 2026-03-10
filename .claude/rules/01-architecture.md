---
paths:
  - "admin/src/app/**"
---

# Architecture

## 프로젝트 구조
- **admin/**: Next.js 16 App Router 기반 관리 대시보드
- **scripts/**: Ubuntu EC2 서버 배포/운영 Bash 스크립트
- **configs/**: 사이트 설정 JSON (페르소나, 색상, 카테고리 등)

## Next.js App Router
- 페이지: `admin/src/app/{feature}/page.tsx` ("use client" 디렉티브)
- API 라우트: `admin/src/app/api/{feature}/route.ts` (서버사이드)
- 컴포넌트: `admin/src/components/{feature}/` (기능별 그룹)
- 타입 정의: `admin/src/app/content/types.ts` (중앙 집중)

## 핵심 패턴

### SSE 스트리밍
모든 장시간 작업은 Server-Sent Events 스트리밍 사용:
```typescript
return new Response(new ReadableStream({
  async start(controller) {
    const encoder = new TextEncoder();
    const send = (data: object) => controller.enqueue(
      encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
    );
    // ... 작업 수행 ...
    controller.close();
  }
}), { headers: { "Content-Type": "text/event-stream" } });
```

### maxDuration 설정
- 콘텐츠 API (생성/발행/리뷰/SEO): `maxDuration = 300`
- 배포 API: `maxDuration = 600`
- 스크래핑: `maxDuration = 45`

### 콘텐츠 파이프라인
```
입력(URL+질문) → 스크래핑 → 리뷰 수집 → 사이트 선택 → AI 생성 → 미리보기 → WordPress 발행
```
ContentStep 타입으로 관리: `input → scraping → scraped → fetching-reviews → reviews-ready → content-config → selecting → generating → preview → publishing → done`

### 배치 처리
- AI 생성: 3개 병렬 (Gemini rate limit 대응)
- 리뷰 수집: 페이지별 순차 (300-500ms 딜레이)
- 사이트 배포: SSH 순차 실행

### 데이터 저장
- DB 없음. WordPress REST API가 데이터 레이어
- 인증 정보: `admin/.cache/sites-credentials.json` (런타임 캐시, git 추적 안함)
- 사이트 설정: `configs/sites-config.json` (git 추적)
