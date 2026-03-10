---
paths:
  - "admin/src/**"
  - "scripts/**"
---

# Code Style

## TypeScript (admin/)
- `type` 키워드 사용 (`interface` 대신)
- 타입 정의는 feature 폴더의 `types.ts`에 모아둠
- `@/` alias = `src/` 경로
- 한국어 주석 허용

## 파일 네이밍
- 컴포넌트: PascalCase (`SiteSelector.tsx`, `PublishProgress.tsx`)
- API route: Next.js 컨벤션 (`route.ts`)
- 페이지: Next.js 컨벤션 (`page.tsx`)
- 타입: `types.ts`

## React 컴포넌트
- "use client" 디렉티브 (인터랙티브 페이지)
- useState로 로컬 상태 관리 (Redux/Zustand 미사용)
- Tailwind CSS 유틸리티 클래스 (별도 CSS 지양)

## API Route
- `export async function POST(req: NextRequest)` 패턴
- 에러: `NextResponse.json({ error: "메시지" }, { status: 코드 })`
- 스트리밍: `text/event-stream` + `ReadableStream`

## Shell Scripts (scripts/)
- 첫 줄: `#!/bin/bash`
- `set -euo pipefail` 필수
- 변수명: `UPPER_SNAKE_CASE`
- 한국어 주석 허용
- 에러 처리 + 로그 출력 필수
