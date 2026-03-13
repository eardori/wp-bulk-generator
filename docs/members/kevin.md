# Kevin (오현석) - Backend & Infra Developer

## 환영 메시지
> Kevin으로 확인되었습니다. 백엔드 + 인프라/CI·CD 전체를 담당합니다.
> 새 기능 작업 전 관련 아키텍처 문서(`docs/architecture/`)를 확인하세요.

## 담당 영역
- **API Routes**: `admin/src/app/api/` 전체 (11개 엔드포인트)
- **Bridge API**: `bridge-api/` 전체 (Fastify 서버)
- **스크래핑 엔진**: Naver, Coupang, Olive Young, iHerb, 11번가, Naver Place
- **AI 콘텐츠 생성**: Gemini 2.0 Flash 기반 아티클 생성 파이프라인
- **WordPress API**: REST API 통한 콘텐츠 발행, 미디어 업로드
- **인프라**: Lightsail Tokyo 서버 운영, Nginx, PM2, SSL 인증서
- **CI/CD**: GitHub Actions 워크플로우, Vercel 배포 관리
- **SSH 배포**: 서버 원격 명령 실행
- **서버 스크립트**: `scripts/` 전체 (Bash)
- **서버 사이드 MJS**: `admin/scripts/` (커스텀 서버)

## 수정 가능 경로
```
✅ admin/src/app/api/**
✅ admin/scripts/**
✅ bridge-api/**
✅ scripts/**
✅ configs/** (사이트 설정)
✅ .github/workflows/** (CI/CD)
✅ docs/architecture/**, docs/scraping/**, docs/deployment/**
⚠️ admin/src/app/(pages)/** → Justin에게 요청
⚠️ admin/src/components/** → Justin과 협의
⚠️ scripts/ 프로덕션 변경 → Hoon 승인 필요
❌ CLAUDE.md, .claude/rules/ → Hoon 담당
```

## Claude Code 지침
1. 백엔드 + 인프라 코드 작성에 집중
2. SSE 스트리밍 패턴 준수 (`ReadableStream` + `TextEncoder`)
3. UI 수정 필요 시 → "Justin에게 {요청 내용} 전달이 필요합니다" 안내
4. 새 스크래퍼 추가 시 기존 파서 패턴 준수 (parseNaverStore, parseCoupang 등 참고)
5. API 429 에러 → 지수 백오프 재시도 (Gemini: 30/60/120/180초)
6. 서버 스크립트 수정 → Hoon 승인 필요
7. `.env.example` 새 키 추가 시 동시 업데이트
8. CI/CD 워크플로우 수정 시 GitHub Secrets 영향 확인

## 코딩 스타일
- API Route: `export async function POST(req: NextRequest)` 패턴
- 스트리밍: SSE 응답 (`text/event-stream`)
- 에러: `NextResponse.json({ error: "..." }, { status: 4xx })`
- 스크래핑: Playwright → Cheerio → curl 순서로 fallback
- Shell: `#!/bin/bash` + `set -euo pipefail`

## PR 체크리스트
- [ ] API 응답 형식 일관성 확인
- [ ] 스트리밍 에러 핸들링 (try-catch, heartbeat)
- [ ] Rate limit 처리 (429 재시도 로직)
- [ ] 시크릿 하드코딩 없는지 확인
- [ ] `maxDuration` 설정 확인
- [ ] `.env.example` 업데이트 (새 키 추가 시)
- [ ] 관련 아키텍처 문서 업데이트 (`docs/architecture/`)
- [ ] CHANGELOG.md 업데이트

## 이 파일 수정하기
이 파일은 Kevin 본인만 자연어로 수정할 수 있습니다:
- "내 담당 영역에 {영역} 추가해줘"
- "체크리스트에 {항목} 추가해줘"
- "내 환영 메시지 바꿔줘"

---
## 변경 이력
| 날짜 | 작성자 | 도구 | 변경 내용 |
|------|--------|------|-----------|
| 2026-03-10 | - | Claude Code | 초기 역할 파일 생성 |
| 2026-03-14 | Kevin | Claude Code | 역할 확대: Backend → Backend & Infra (인프라, CI/CD, Bridge API 추가) |
