# Changelog

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
