# Changelog

## 2026-03-13: 사이트 생성 Load failed 수정
- **원인 확인**: `wp.multiful.ai`에서 `bridge.allmyreview.site`로 직접 SSE 연결 시 CORS 허용 origin이 예전 Vercel 도메인만 가리켜 브라우저에서 `Load failed` 발생
- **Bridge CORS 보강**: `wp.multiful.ai`, `wp-bulk-generator.vercel.app`, 로컬 개발 origin과 `*.vercel.app` preview를 허용하도록 수정
- **SSE 응답 헤더 보존**: `setupSSE()`가 기존 CORS 헤더를 덮어쓰지 않도록 수정해 실제 스트림 응답에도 `Access-Control-Allow-Origin` 유지
- **환경 예제 정리**: `admin/.env.example`, `bridge-api/.env.example`를 Lightsail + 멀티 origin 기준으로 업데이트

## 2026-03-13: 사이트 배포 404 수정
- **원인 확인**: admin은 `POST /deploy`로 SSE 연결하지만, Lightsail Bridge 서버(:4000)에 `deploy` 라우트가 등록되지 않아 `Route POST:/deploy not found` 발생
- **Bridge 라우트 복구**: 외부 SSE 진입점인 Bridge API에도 `deployRoutes`를 다시 등록해 사이트 생성 후 배포 흐름 복구

## 2026-03-13: 배포 완료 후 검은 화면 수정
- **원인 확인**: deploy SSE가 `credentials` 배열 전체를 보내는데, 프론트는 `{ admin_user, admin_pass, sites }` 객체를 전제로 렌더링해 `status.credentials.sites.map(...)`에서 client-side exception 발생
- **배포 응답 정규화**: Bridge deploy route가 요청한 사이트만 추려 `admin_user`, `admin_pass`, `sites[]` 형태로 요약해 전송
- **완료/오류 상태 명시**: deploy SSE의 `done`, `error` 이벤트에 `status`를 같이 보내 완료 화면과 오류 화면 전환 보강
- **프론트 방어 렌더링**: DeployProgress가 예기치 않은 `credentials` 형태를 받아도 검은 화면 없이 안전하게 렌더링

## 2026-03-13: Lightsail Tokyo 인프라 마이그레이션 완료
- **서버 이전**: EC2 Ireland (108.129.225.228) → Lightsail Tokyo (54.248.12.228)
  - 2 vCPU, 1.9GB RAM, 58GB Disk, Ubuntu 22.04
- **서비스 통합**: Bridge API + EC2 Agent를 Lightsail에 통합 (Fly.io 제거)
  - Bridge API (:4000) — `https://bridge.allmyreview.site` (Nginx reverse proxy + SSL)
  - EC2 Agent (:4001) — localhost only
- **WP 5개 사이트 재배포**: nutri-daily, vitacheck-kr, momvita, fitfuel-lab, healwell-note
- **서버 튜닝**: PHP max_children=15, MariaDB buffer_pool=256M, Redis 64MB, Nginx 1024 connections
- **CI/CD 업데이트**: deploy-bridge.yml (Bridge+Agent 동시 배포), deploy-fly.yml 비활성화
- **GitHub Secrets + Vercel 환경변수**: 새 IP/도메인으로 업데이트 완료

## 2026-03-13: Naver Place 스크랩을 Vercel 직접 처리로 전환
- **Bridge 의존성 우회**: `/api/content/scrape-product`가 Naver Place URL에 대해 `pcmap-api.place.naver.com/graphql`를 직접 호출하도록 변경
- **리뷰 50개 직접 수집**: 방문자 리뷰를 cursor 기반으로 10개씩 조회해 최대 50개를 바로 product payload에 포함
- **백엔드 장애 내성 강화**: Bridge API가 죽어 있어도 Naver Place는 Vercel route 단독으로 스크랩 가능
- **기본 장소 정보 보강**: 리뷰 응답의 `businessName`, 키워드, 리뷰 이미지를 활용해 제목/설명/대표 이미지 구성

## 2026-03-13: Naver Place 리뷰 50개 수집 보강
- **리뷰 더보기 로직 수정**: 일반 `더보기` 대신 리뷰 하단 `펼쳐서 더보기`만 클릭하도록 변경해 Naver Place 리뷰 누락 문제 수정
- **50개 수집 보장**: 방문자 리뷰를 10개씩 추가 로드하며 최대 50개까지 안정적으로 수집하도록 보강
- **본문 확장 + 중복 제거**: 잘린 리뷰 본문을 펼친 뒤 `작성자 + 날짜 + 본문` 기준으로 중복 제거
- **리뷰 메타데이터 정리**: 리뷰 카드 기준으로 작성자/날짜/리뷰 이미지를 다시 추출하고 날짜 문자열을 정규화

## 2026-03-13: GEO(Generative Engine Optimization) 전면 적용
- **Gemini 프롬프트 GEO 규칙 주입**: 제품/맛집 프롬프트에 Citability 규칙 G1~G9 추가 (인용 가능 단락, 정의 패턴, 통계 밀도, 질문형 소제목, 비교 테이블, 핵심 용어 볼드, 상투적 표현 금지, 답변 우선 구조)
- **robots.txt 최적화**: Bytespider 제거, OAI-SearchBot/Amazonbot/FacebookBot/cohere-ai 추가
- **Schema.org 강화**: Article 스키마에 author persona(jobTitle/knowsAbout/bio) + speakable 속성 추가
- **MU-Plugin 스키마 3종 추가**: Organization(전 페이지), WebSite+SearchAction(프론트), BreadcrumbList(포스트)
- **llms.txt 자동 생성**: 사이트 배포 시 llms.txt 생성 함수 + Nginx location 블록 추가
- **기존 포스트 일괄 적용**: 175개 포스트에 GEO 스키마 재적용 완료

## 2026-03-13: 대시보드 405 에러 수정
- **Dashboard API 405 수정**: `/api/dashboard/route.ts`에 POST 핸들러 추가 — `bridgeSSE`가 토큰 발급 시 항상 POST로 요청하지만 GET만 있어서 405 발생하던 문제 해결

## 2026-03-13: 기존 발행 글 GEO 재적용 로직 보강
- **기존 글 GEO 재적용 수정**: 기존 JSON-LD가 이미 있는 포스트도 구버전 schema를 제거하고 최신 GEO schema로 다시 주입하도록 변경
- **Bridge SEO Optimize 개선**: `seo-optimize`가 `speakable`, persona author 필드, FAQ schema를 최신 규격으로 재계산 후 덮어쓰도록 수정
- **서버 스크립트 보강**: `seo-optimize.php`, `seo-optimize-existing.mjs`, `seo-optimize-existing.sh`가 최신 GEO 기준으로 재적용하도록 업데이트
- **스킵 조건 정교화**: 본문/alt/schema가 모두 최신 상태인 글만 skip 처리

## 2026-03-12: Fly.io 마이그레이션 — Bridge API 분리
- **Bridge API → Fly.io 분리**: compute-heavy 작업(AI 생성, 스크래핑, 발행)을 Fly.io 무료 티어로 이전
- **EC2 Agent 신규**: EC2에 경량 Fastify 서버 (`:4001`) — credentials, deploy, health, groups, reserved-slugs만 담당
- **ec2-client.ts**: Fly.io → EC2 Agent HTTP 클라이언트 유틸리티
- **Hybrid 라우트 수정**: generate-configs, seo-optimize, dashboard — 로컬 파일 읽기 → EC2 Agent API 호출
- **server.ts 분리**: EC2-only 라우트 제거, HOST `0.0.0.0`, 경량 `/health` 엔드포인트
- **Dockerfile**: node:20-slim + Playwright Chromium (Fly.io 배포용)
- **fly.toml**: nrt 리전, shared-cpu-1x, 256MB, auto_stop
- **CI/CD**: deploy-fly.yml (Fly.io 자동 배포) + deploy-bridge.yml → EC2 Agent 전용으로 변경
- **환경변수**: EC2_AGENT_URL, EC2_AGENT_KEY 추가

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
| 2026-03-12 | Kevin | Claude Code | Fly.io 마이그레이션 기록 추가 |
| 2026-03-13 | Justin | Claude Code | 기존 발행 글 GEO 재적용 로직 보강 기록 추가 |
