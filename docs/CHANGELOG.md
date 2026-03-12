# Changelog

## 2026-03-12: EC2 Bridge API 인프라 완료
- **EC2 인프라 설정 완료**:
  - DNS A 레코드: `bridge.allmyreview.site → 108.129.225.228` 확인
  - GitHub deploy key 등록 (ed25519)
  - Git clone: `/home/ubuntu/wp-bulk-generator`
  - Bridge API: npm install + tsc build + `.env` 설정
  - Nginx: reverse proxy + HTTPS + SSE 지원 (proxy_buffering off, 700s timeout)
  - SSL 인증서: certbot webroot 방식 발급 (`/etc/letsencrypt/live/bridge.allmyreview.site/`)
  - PM2: `wp-bridge-api` 등록 + 저장
- **TypeScript 빌드 오류 수정**:
  - `auth.ts`: FastifyRequest 캐스팅 + jwt.SignOptions 타입 수정
  - `generate-configs.ts`: isSubdomain 타입 `boolean | string` → `boolean` 통일
- **HTTPS 정상 확인**: `https://bridge.allmyreview.site/health` 응답 확인
- **Vercel 연동 완료**: 환경변수 설정 + E2E 테스트 통과 (server-status, fetch-sites, site-groups)
- **dotenv 추가**: Bridge API .env 파일 로드를 위해 dotenv 패키지 추가
- **.env.example 수정**: BRIDGE_API_URL에서 `/api` 접미사 제거

## 2026-03-11: Vercel 배포 성공
- **Vercel 배포 성공**: Root Directory=admin 설정, 환경변수 설정 완료
- **생성된 시크릿**: BRIDGE_API_KEY, BRIDGE_JWT_SECRET (Vercel + EC2 .env에 설정 필요)

## 2026-03-11: Vercel 마이그레이션 + Bridge API 구축
- **Bridge API** (`bridge-api/`): EC2 Fastify 서버 구축 (17개 엔드포인트)
  - 장시간 작업 위임: generate-articles, publish-articles, seo-optimize, deploy 등
  - Playwright 스크래핑: oliveyoung, naver-place
  - 인증: API Key (서버간) + JWT (클라이언트 직접 SSE)
- **Vercel 전환**: Next.js admin을 Vercel Free로 이전
  - 60s 제한 대응: 장시간 API → JWT 토큰 발급 + 클라이언트→Bridge 직접 SSE
  - 경량 프록시: fetch-sites, site-groups, server-status → bridge 호출
  - scrape-product: Playwright 부분만 bridge 위임, cheerio는 Vercel에서 처리
- **프론트엔드**: `bridge-sse.ts` 유틸리티로 모든 SSE 호출 패턴 통일
- **의존성 정리**: playwright, ssh2, @google/generative-ai 등 admin에서 제거
- **CI/CD**: deploy.yml 삭제 → deploy-bridge.yml 신규 (bridge-api 자동 배포)
- **하드코딩 IP 제거**: 4개 파일에서 `108.129.225.228` 제거

## 2026-03-11: CI/CD 파이프라인 구축
- GitHub Actions CI 워크플로우 (PR: lint + type check + build)
- GitHub Actions Deploy 워크플로우 (main push → EC2 자동 배포)
- SSH 키 및 시크릿 설정

## 2026-03-10: 프로젝트 문서 체계 구축
- CLAUDE.md를 kokoro 패턴으로 재작성 (간결한 개요 + 참조 구조)
- `.claude/rules/` 11개 규칙 파일 생성 (아키텍처, 코드스타일, 협업 등)
- `docs/members/` 멤버 시스템 구축 (Justin/Kevin/Hoon 역할 파일)
- `docs/` 전체 문서 구조 생성 (architecture, scraping, deployment, features, tasks)
- 아키텍처 문서 작성 (시스템 개요, API 레퍼런스, 콘텐츠 파이프라인)
- 기능 문서 작성 (스크래핑 엔진, AI 생성, 페르소나, SEO)
- 배포 문서 작성 (서버 세팅, 사이트 배포)

## 2026-03-09: 프로젝트 초기 설정
- 루트 단일 git 리포로 재구성 (admin/ 내부 .git 제거)
- .gitignore: 시크릿, node_modules, 캐시, 로그 제외
- .env.example: 환경변수 템플릿 제공
- GitHub private 리포 생성 (eardori/wp-bulk-generator)

---
## 변경 이력
| 날짜 | 작성자 | 도구 | 변경 내용 |
|------|--------|------|-----------|
| 2026-03-10 | - | Claude Code | CHANGELOG 초안 작성 |
| 2026-03-11 | Kevin | Claude Code | CI/CD + Vercel 마이그레이션 + Bridge API 기록 추가 |
| 2026-03-11 | Kevin | Claude Code | Vercel 배포 성공 + EC2 인프라 대기 상태 기록 |
| 2026-03-12 | Kevin | Claude Code | EC2 Bridge API 인프라 완료 기록 추가 |
| 2026-03-12 | Kevin | Claude Code | Vercel E2E 연동 완료 + dotenv 추가 기록 |
