# WP Bulk Generator

WordPress 사이트 대량 생성 + AI 콘텐츠 자동화 도구.
상품 스크래핑 → 리뷰 수집 → AI 아티클 생성 → WordPress 발행까지 자동화.

## Tech Stack
- Next.js 16 | React 19 | TypeScript | Tailwind CSS 4
- Google Gemini 2.0 Flash (AI 콘텐츠 생성)
- Playwright + Cheerio (스크래핑)
- SSH2 (원격 서버 제어)
- WordPress REST API (콘텐츠 발행)
- Ubuntu EC2 | Nginx | PHP 8.2 | MariaDB | WP-CLI | Redis

## Quick Commands
```bash
cd admin && npm install                # 의존성 설치
cd admin && npm run dev                # 개발 서버 (http://localhost:3000)
cd admin && npm run build              # 프로덕션 빌드
cd admin && npm run lint               # ESLint 검사
./scripts/setup-server.sh              # EC2 서버 초기 세팅 (1회)
./scripts/deploy-wp-sites.sh configs/sites-config.json  # WP 사이트 대량 배포
./scripts/rebuild-admin.sh             # Admin 빌드 & 서버 배포
```

## Member System
IMPORTANT: 새 세션 시작 시 반드시 "나는 {이름}이야"로 역할을 선언할 것.
역할 미선언 시 Claude는 아래 질문으로 역할 확인을 먼저 진행해야 함:

> "안녕하세요! 작업을 시작하기 전에 역할을 확인하겠습니다.
> Justin(FE), Kevin(BE), Hoon(PM) 중 누구신가요?"

역할 선언 후 해당 멤버 파일(@docs/members/{name}.md)을 읽고 권한/지침을 적용.
역할 확인 후 Quick Guide를 자동 출력. 이후 "가이드", "도움말" 등으로 재확인 가능.
각 멤버는 자신의 역할 파일을 자연어로 수정 가능 ("내 역할 수정해줘", "체크리스트 추가해줘" 등).
상세: @docs/members/README.md | @.claude/rules/09-onboarding.md | @.claude/rules/10-member-self-edit.md

## Rules Index (`.claude/rules/`)
| File | 내용 |
|------|------|
| 01-architecture.md | Next.js App Router, API route 구조, 스트리밍 패턴, 콘텐츠 파이프라인 |
| 02-code-style.md | TypeScript/React 네이밍, Tailwind, Shell Script 규칙 |
| 03-git-workflow.md | 브랜치 전략, 커밋 메시지, PR 규칙 |
| 04-environment.md | 환경변수, SSH 키, 시크릿 관리 |
| 05-documentation.md | 문서 작성 규칙, CHANGELOG, 변경 이력 기록 |
| 06-frontend.md | React 컴포넌트, 페이지, 상태 관리, UI 패턴 |
| 07-backend.md | API route, 스크래핑, AI 생성, WordPress API |
| 08-scripts.md | 서버 배포 스크립트, 실행 환경, 승인 프로세스 |
| 09-onboarding.md | 세션 시작 온보딩, 역할 선언, Quick Guide |
| 10-member-self-edit.md | 멤버 파일 자연어 수정 규칙 |
| 11-collaboration.md | 요청 보드, 기능 대시보드, 세션 종료 요약, ADR |

## Docs Index (`docs/`)
| Folder | 용도 | 관리자 |
|--------|------|--------|
| members/ | 멤버별 역할, 권한, 체크리스트 | All |
| architecture/ | 시스템 아키텍처, API 레퍼런스, 파이프라인 | Kevin |
| scraping/ | 스크래핑 엔진 가이드 | Kevin |
| deployment/ | 서버 세팅, 사이트 배포 가이드 | Kevin |
| features/ | AI 생성, 페르소나, SEO 등 기능 문서 | All |
| tasks/ | 멤버 간 요청 보드 (inbox별 추적) | All |
| decisions/ | 의사결정 기록 (ADR) | All |
| status.md | 기능별 진행 현황 대시보드 | All |
| CHANGELOG.md | 변경 이력 | All |

## Critical Rules (반드시 준수)
- `.env`, `.env.local`, `*.pem`, `credentials*.json` 절대 커밋 금지
- 서버 IP 주소를 소스코드에 하드코딩하지 말 것
- 서버 스크립트(`scripts/`) 수정은 Hoon 승인 후 진행
- API route 작성 시 SSE 스트리밍 패턴 준수 (`ReadableStream` + `TextEncoder`)
- IMPORTANT: 문서(`docs/**/*.md`) 작성/수정 시 파일 하단 변경 이력에 작성자와 AI 에이전트 사용 여부를 반드시 기록
  - 형식: `| 날짜 | 작성자 | 도구 | 변경 내용 |`
  - 도구: `Claude Code`, `직접 작성`, `GitHub Copilot` 등
  - 상세: @.claude/rules/05-documentation.md
