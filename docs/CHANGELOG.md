# Changelog

## 2026-04-28: chowlog robots.txt http→https 회귀 보정 + 1회성 패치 엔드포인트 추가

- **문제 진단**: chowlog.xyz 가 빙 URL Inspection 에서 "Not Crawled" 상태로 머무는 직접 원인 발견. robots.txt 의 `Sitemap:` 줄이 `http://chowlog.xyz/sitemap_index.xml` 로 명시되어 있었음. 빙은 그 URL 그대로 호출 → 301 redirect → 신뢰도 하락 (redirected sitemap 은 후순위 처리). http→https siteurl 마이그레이션 시점에 robots.txt 만 회귀 안 됨.
- **근본 원인**: `scripts/backfill-existing-sites.sh:site_url_for_domain` 이 비-allmyreview 도메인에 대해 `http://` 를 반환하던 옛 fallback 잔재. `deploy-wp-sites.sh` 는 2026-04-22 에 https fallback 으로 이미 수정됨.
- **조치**:
  - `scripts/backfill-existing-sites.sh:site_url_for_domain` 도 https fallback 으로 통일. 모든 사이트가 Let's Encrypt 자동 발급되므로 안전.
  - `bridge-api/src/routes/deploy.ts`: 신규 엔드포인트 `POST /deploy/fix-robots-https` 추가. resolveSiteTarget 으로 사이트의 server target 결정 (primary/secondary/remote), 원격이면 execSsh, 로컬이면 execSync 로 `sed -i 's|^Sitemap: http://|Sitemap: https://|g' ${siteDir}/robots.txt` 실행. Sitemap 줄을 grep 으로 출력해 결과 검증. body: `{ slug }`.
  - `admin/src/app/api/deploy/fix-robots-https/route.ts`: 동일 페이로드를 그대로 Bridge 로 forward 하는 thin proxy.
- **다음 작업 (Hoon)**: CI 자동 배포 완료 후 트리거 `curl -sSk -X POST https://admin.allmyreview.site/api/deploy/fix-robots-https -d '{"slug":"chowlog"}' -H 'Content-Type: application/json'`. 이어서 `https://chowlog.xyz/robots.txt` 를 직접 확인하여 `Sitemap: https://...` 로 갱신됐는지 검증.

## 2026-04-20: Bing 인덱싱 파이프라인 복구 — IndexNow 활성화 + SubmitUrlBatch 연결 + 일괄 재제출 엔드포인트

- **문제 진단**: Bing URL Inspection에 글이 안 잡히는 원인 3가지 발견
  1. Bridge의 `INDEXNOW_API_KEY` env 미설정 → `isIndexNowEnabled()=false`, IndexNow 호출이 한 번도 안 됐음
  2. `deploy-wp-sites.sh`가 서버별로 랜덤 키 생성 → Primary/Secondary/Lightsail 서버 간 키 불일치 (교차 호출 시 403)
  3. `submitBingUrls` (Bing SubmitUrlBatch API) 구현만 있고 호출처 없음 — sitemap 제출 외 직접 URL 제출 경로 없음
- **조치**:
  - `bridge-api/src/lib/indexnow.ts`: env 키 해석 우선순위 확장 (`INDEXNOW_API_KEY` → `INDEXNOW_KEY` → `/root/.wp-bulk-indexnow-key` 파일 fallback)
  - `publish-articles.ts`: 발행 파이프라인에 `submitBingUrls` 추가 — IndexNow와 병렬로 두 경로 제출
  - `.env.example` + `deploy-bridge.yml`: `INDEXNOW_API_KEY` GitHub Secret을 bridge `.env`에 sync + `/root/.wp-bulk-indexnow-key`도 동기화
  - 신규 엔드포인트 `POST /deploy/resubmit-bing-urls` (Bridge) + `/api/deploy/resubmit-bing-urls` (admin 프록시): WP REST API로 기존 발행 글을 페이지네이션 수집 → `submitBingUrls` + `submitIndexNow` 일괄 재제출, SSE 스트리밍 진행률. body: `{ domainFilter?, slugs?, perSiteLimit? }`
- **Hoon 후속 작업**:
  - GitHub Secret `INDEXNOW_API_KEY` 등록 (값: `openssl rand -hex 16`)
  - Bridge 재배포 → 키가 서버 `.env` + `/root/.wp-bulk-indexnow-key`로 전파
  - `scripts/deploy-wp-sites.sh`를 필요한 서버에서 재실행해 각 WP 사이트 루트에 `{key}.txt` 파일 동기화 (기존 랜덤 키 덮어쓰기)
  - 재제출 트리거: `curl -X POST https://admin.allmyreview.site/api/deploy/resubmit-bing-urls -d '{}' -H 'Content-Type: application/json'`

## 2026-04-20: Redis 장애로 인한 발행 일괄 실패 — heal-redis 스크립트 추가

- **증상**: 컨텐츠 발행 시 다수 사이트에서 `spawnSync wp ETIMEDOUT` 발생 (14/157개 실패 확인). 일부 사이트는 `RedisException: read error on connection to 127.0.0.1:6379` 명시적 에러 (`local-food`, `foodie-tales`). 나머지 ETIMEDOUT 사이트도 동일 원인(Redis 응답 대기 중 wp-cli hang)으로 추정
- **근본 원인**: Lightsail Redis 서비스 crash/정지 → 각 사이트의 `wp-content/object-cache.php`가 부팅 중 Redis 연결 시도 → WP 로딩 자체가 멈춤 → wp-cli eval-file 명령이 Node spawnSync 타임아웃 초과
- **조치**:
  - `scripts/heal-redis.sh` 신규 추가: `systemctl restart redis-server` + PONG 헬스체크 + 선택 slug 대상 `object-cache.php` 임시 비활성화(`--restore`로 원복 가능)
  - 즉시 완화 절차: 서버 SSH 접속 후 `sudo ./scripts/heal-redis.sh` 실행. Redis가 재기동 불능이면 동일 명령에 `local-food foodie-tales` 같은 문제 slug 를 인자로 넘겨 object-cache.php 만 비활성화
- **Hoon 후속 작업**: Bridge publish-articles 경로에서 SSH fallback 타임아웃 상향 검토, Redis 모니터링/자동 복구 systemd override 추가 검토 (ADR 후보)

## 2026-04-19: Vercel DEPLOYMENT_DISABLED 임시 우회 — admin.allmyreview.site 개설

- **상황**: `wp.multiful.ai`가 Vercel 402 `DEPLOYMENT_DISABLED`로 접속 불가 (계정 한도/결제 이슈, 해당 Vercel 계정이 Hoon 팀 아래 없어 CLI 해결 불가)
- **조치**: Lightsail의 Admin Backup(:3000)을 `admin.allmyreview.site` 서브도메인으로 노출. DNS는 이미 Lightsail IP를 가리키고 있어 Nginx 리버스 프록시 + Let's Encrypt SSL만 세팅 (`.github/workflows/setup-admin-subdomain.yml`, workflow_dispatch 일회성 실행)
- **Bridge CORS 허용 추가**: `admin.allmyreview.site`를 기본 허용 origin에 추가 (`bridge-api/src/server.ts`, `.env.example`)
- **Hoon 후속 작업**: Vercel 계정에서 Usage/Billing 확인해 원복 — 복구되면 이 서브도메인은 fallback으로 유지

## 2026-04-18: 콘텐츠 생성 탭 = 범위 UX 개선

- **문제**: 도메인 그룹 탭으로 좁혀 보고 있어도 "전체 선택"/바닥 생성 버튼은 전역 기준으로 집계 — 탭에서 50개만 보이는데 200개가 생성되는 혼동 발생 (Hoon 보고)
- **조치**: 탭이 생성 범위를 결정하도록 변경. `ContentConfigPanel.tsx`에서 `scopedConfigs` / `scopedEnabled` 를 별도 산출해 상단 카운트·바닥 실시간/Job 버튼·handleGenerate/handleSubmitJob 모두 현재 탭 기준으로 작동
- **UX 개선**: 탭 헤더에 "선택한 탭이 생성 범위" 힌트 추가. 헤더 카운트에 "myground.website 범위" 라벨. 일괄 바에 (전체 N개) 보조 표시. 버튼 라벨에 "{탭명} {N}개 실시간 생성"
- **그대로 유지**: "전체" 탭에서는 기존대로 모든 사이트가 범위. 탭 간 선택 상태는 독립적으로 보존 (탭 전환 시 선택이 사라지지 않음)

## 2026-04-18: Gemini 설정 모델을 2.5-flash-lite로 전환

- **원인**: `gemini-2.0-flash`로 바꿨더니 이번엔 404 "no longer available to new users" — Google이 2.0-flash를 신규 프로젝트에는 deprecated 처리. 2.5-flash는 여전히 503(high demand)
- **조치**: `GEMINI_CONFIG_MODEL`을 `gemini-2.5-flash-lite`로 변경 — 이미 `generate-articles.ts`의 콘텐츠 생성에 쓰이는 모델로, 부하가 낮아 503/404 모두 회피. 폴백은 `gemini-2.5-flash`로 설정 (`bridge-api/src/routes/generate-configs.ts`, `.github/workflows/deploy-bridge.yml`)

## 2026-04-18: Bridge 서버 Gemini 모델 env 강제 전환

- **원인**: 2026-04-17에 코드 기본값을 `gemini-2.5-flash` → `gemini-2.0-flash`로 바꿨지만, Bridge 서버 `.env`에 남아있던 `GEMINI_CONFIG_MODEL=gemini-2.5-flash`가 여전히 오버라이드 — 재배포 후에도 사이트 생성이 503(high demand)로 실패
- **조치**: `deploy-bridge.yml`의 `Sync env secrets` 스텝에 `GEMINI_CONFIG_MODEL` / `GEMINI_CONFIG_FALLBACK_MODEL`을 `gemini-2.0-flash`로 강제 갱신하는 sed 블록 추가. 이후 매 배포마다 자동으로 안정 GA 모델을 유지

## 2026-04-17: 도메인별 사이트 그룹화 UI

- **공용 도메인 유틸 추출**: `getDomainGroup` / `getDomainGroupLabel` / `getDomainGroupColor`를 `admin/src/lib/domainGroup.ts`로 공용화 (기존 `ContentConfigPanel` 내부 로컬 정의 → 공용 모듈)
- **대시보드 도메인 탭 필터**: `dashboard/page.tsx`의 "사이트별 글 목록"에 도메인 탭(전체 / myground.website / allmyreview.site / 기타) 추가. 서버 탭·그룹 필터·텍스트 검색과 AND 결합
- **콘텐츠 생성 화면 섹션 조작**: `ContentConfigPanel.tsx` 전체 탭에서 각 도메인 섹션 헤더에 접기/펼치기, "전체 선택/해제", 일괄 글 수 버튼(1/2/3/5개) 추가 — myground과 allmyreview를 다른 글 수로 동시 설정 가능
- **상태 관리**: `collapsedGroups: Set<string>`, `domainFilter: "all" | DomainGroup` state 추가 (useState 유지, Zustand 미도입)

## 2026-04-17: 콘텐츠 제작 상태 복원 + 사이트 생성 AI 배치 에러 표면화

- **콘텐츠 제작 오배너 수정**: 이전 세션에서 스크랩 실패 후 `manual`/`scraping` 등 중간 단계로 저장된 sessionStorage가 새 진입 시 그대로 복원돼 URL 없이도 "자동 스크랩 실패(Invalid URL)" 배너가 뜨던 문제 해결 (`admin/src/app/content/page.tsx`)
  - `manual`을 non-restorable 스텝에 추가하고 첫 분기(articles 있음)에도 필터 적용
  - 복원 불가 단계면 이전 `log`/`product` 복원을 스킵해 에러 잔상 제거
  - `handleScrape` 시작부에 빈/공백 URL 가드 추가 (방어적 입력 정규화)
- **사이트 생성 배치 에러 원인 노출**: `batch_error` SSE 이벤트의 `message` 필드를 UI `partialWarning`에 함께 표시 (`admin/src/app/page.tsx`). 기존에는 "배치 1/1에서 중단됨"만 보이고 Gemini 호출 실패 원인(모델명·한도 등)이 숨겨져 원인 파악이 어려웠음
- **Gemini 모델 503 대응**: 사이트 생성이 `gemini-2.5-flash` 503(Service Unavailable: high demand)으로 실패 — 기본 모델을 안정 GA인 `gemini-2.0-flash`로 전환하고 `callGeminiWithRetry`에 503/500 재시도 로직 추가 (`bridge-api/src/routes/generate-configs.ts`)
- **Bridge 배포 SSH keepalive 추가**: Lightsail 빌드 중 SSH idle timeout(`Broken pipe`)으로 `deploy-bridge` 워크플로우가 실패하던 문제 해결 — `~/.ssh/config`에 `ServerAliveInterval 30` / `ServerAliveCountMax 40` / `TCPKeepAlive yes` 추가, Pull & build 스텝에 `timeout-minutes: 20` + `NODE_OPTIONS=--max-old-space-size=1024` + `npm ci --no-audit --no-fund` 적용 (`.github/workflows/deploy-bridge.yml`)

## 2026-04-15: WordPress siteurl https 일괄 수정 + UI 개선

- **WordPress siteurl/home https 수정**: Secondary 서버 28개 사이트의 `home`/`siteurl`을 `http://` → `https://`로 일괄 수정 (WP-CLI)
- **publish-articles.ts https 강제**: Bing URL 제출 시 WordPress 내부 `http://` siteurl 대신 항상 `https://`로 제출하도록 수정
- **배포 워크플로우 자동 보정**: `deploy-bridge.yml`에 robots.txt + WordPress siteurl http→https 자동 수정 스텝 추가 (매 배포 시 실행)
- **콘텐츠 생성 사이트 선택 UI**: 사이트 제목 아래에 사이트 URL 표시 추가 (`ContentConfigPanel.tsx`)

## 2026-04-14: myground.website 도메인 AEO + Bing 통합

- **Bing 듀얼 API 키**: `BING_WEBMASTER_API_KEY_MYGROUND` 환경변수 추가, 도메인 기반 자동 키 선택 (`bing-webmaster.ts`)
- **서브도메인 루트 통합**: 서브도메인을 개별 AddSite 안 하고, 루트 도메인 `myground.website`에 sitemap 제출하도록 `syncBingSite()` 변경
- **robots.txt https 수정**: 배포 시 Primary + Secondary 서버의 robots.txt `http://` → `https://` 자동 갱신 (`deploy-bridge.yml`)
- **refresh-static-files 엔드포인트**: Primary + Secondary 서버 robots.txt 일괄 갱신 API 추가 (`deploy.ts`)
- **submit-sitemaps 엔드포인트**: myground 사이트 Bing sitemap 일괄 제출 API 추가 (`deploy.ts`)
- **proxy-sync 엔드포인트**: SSL 인증서 + Nginx 설정 단독 갱신 API 추가 (`deploy.ts`)
- **GitHub Secret**: `BING_WEBMASTER_API_KEY_MYGROUND` 추가, deploy workflow에서 서버 `.env` 자동 동기화
- **myground SSL 인증서**: `sync-secondary-proxies.sh`에 myground 전용 공유 SAN 인증서 지원 추가

## 2026-03-14: GEO Phase 2 기존 글 일괄 적용 완료

- **seo-optimize 실행**: 전체 사이트 82개 글에 GEO Phase 2 일괄 적용 (Product/Review 스키마 + 내부 링크 + llms-full.txt)
- **Vercel 환경변수 설정 완료**: `ADMIN_USER`/`ADMIN_PASS` 적용 → Admin Basic Auth 활성화
- **Justin collaborator 추가 완료**: GitHub 협업 권한 부여

## 2026-03-14: GEO Phase 2 — Product 스키마 + 내부 링크 + llms-full.txt

- **Product/Review 스키마 추가**: 상품 리뷰 글에 Product + Review + AggregateOffer JSON-LD 자동 주입 (가격/평점 추출)
- **내부 링크 자동 생성**: 발행 시 같은 사이트의 관련 글 3개를 본문 하단에 "관련 글 추천" 섹션으로 추가 (Topical Authority 강화)
- **llms-full.txt 자동 갱신**: 발행/SEO최적화 완료 후 글 제목+링크+요약 포함한 llms-full.txt 자동 생성
- **기존 글 일괄 적용**: seo-optimize가 기존 글에도 Product 스키마 + 내부 링크 + llms-full.txt 모두 적용
- **Nginx llms-full.txt 서빙**: deploy-wp-sites.sh에 llms-full.txt location 블록 추가

## 2026-03-14: 레포 공개 전환 + Admin 보안

- **GitHub 레포 public 전환**: Vercel Hobby 플랜 협업 제한 해소 (collaborator push → 자동 배포)
- **main 브랜치 보호**: 삭제 차단 ruleset 활성화
- **MIT 라이선스 추가**: Copyright HOS
- **Admin Basic Auth**: Next.js middleware로 ID/PW 인증 추가 (`ADMIN_USER`/`ADMIN_PASS` 환경변수 기반, 미설정 시 스킵)

## 2026-03-13: 사이트 배포 중 개별 실패가 전체 중단시키던 문제 수정
- **사이트별 실패 격리**: `deploy-wp-sites.sh`가 한 사이트 설치 실패 시 전체 종료하지 않고, 실패를 기록한 뒤 다음 사이트 설치를 계속 진행하도록 변경
- **자동 재시도 추가**: 개별 사이트 설치 실패 시 1회 자동 재시도 후에도 실패하면 목록에 남기고 다음 사이트로 이동
- **DB 계정 충돌/비밀번호 불일치 보강**: DB 계정명을 slug 해시 기반으로 안정화하고, 기존 사용자도 `ALTER USER`로 비밀번호를 다시 맞춰 `1045 Access denied` 재발 가능성 완화
- **진행률/실패 요약 강화**: Bridge deploy SSE가 사이트별 시작/성공/실패를 파싱해 진행률을 갱신하고, 완료 시 성공/실패 개수와 실패한 사이트 사유를 함께 전달
- **배포 중복 보호 보강**: 기존 사이트 충돌 검사 시 credentials의 `slug`도 함께 보도록 수정

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

## 2026-03-13: 사이트 생성 UX 개선
- **다음 단계 즉시 이동**: `AI 설정 생성` 클릭 즉시 폼 화면에서 생성 진행/미리보기 단계로 전환되도록 변경
- **누적 미리보기 강화**: 배치로 받은 결과를 바로 표에 넣지 않고 한 개씩 순차 노출해 생성이 이어지는 느낌을 강화
- **진행 상태 분리**: `AI 생성 개수`, `배치 진행`, `목록 반영 개수`를 따로 보여 50개 생성 시 10개에서 멈춘 것처럼 보이던 문제 완화
- **생성 중 안전 리셋**: `처음으로`를 눌렀을 때 이전 SSE 스트림을 abort하고 뒤늦은 상태 덮어쓰기를 무시하도록 보강

## 2026-03-13: 대시보드 검은 화면 수정
- **원인 확인**: dashboard SSE의 `groups` payload가 일부 환경에서 배열이 아니라 `{ groups: [] }` 형태로 들어와 `groups.forEach(...)`에서 client-side exception 발생
- **브리지 정규화**: dashboard route가 `sites`, `groups`를 전송 전에 배열 형태로 정규화
- **프론트 방어 처리**: dashboard page도 SSE payload를 배열로 정규화하고, `error` 이벤트 수신 시 로딩 상태를 안전하게 종료

## 2026-03-13: 유령 사이트 정리 API 추가
- **EC2 Agent 정리 라우트**: `/credentials/delete-sites` 추가 — credentials/config/groups 파일에서 지정한 slug/domain을 실제로 제거
- **Vercel 프록시 추가**: `/api/content/delete-sites`에서 bridge key로 정리 라우트를 안전하게 호출 가능
- **그룹 동기화**: 삭제된 사이트 slug는 그룹 정의에서도 제거하고, 빈 그룹은 함께 정리

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
| 2026-03-14 | Kevin | Claude Code | 레포 public 전환 + Admin Basic Auth 기록 추가 |
| 2026-03-14 | Kevin | Claude Code | GEO Phase 2: Product 스키마 + 내부 링크 + llms-full.txt |
| 2026-04-17 | Hoon | Claude Code | 콘텐츠 제작 상태 복원 버그 수정 + 사이트 생성 batch_error 메시지 표면화 |
| 2026-04-17 | Hoon | Claude Code | 도메인별 사이트 그룹화 UI: 대시보드 도메인 탭 + 콘텐츠 생성 섹션 접기/펼치기·도메인별 일괄 조작 |
| 2026-04-17 | Hoon | Claude Code | deploy-bridge 워크플로우 SSH keepalive + 빌드 메모리 제한 추가 (Lightsail idle timeout 방지) |
| 2026-04-18 | Hoon | Claude Code | deploy-bridge에 GEMINI_CONFIG_MODEL=gemini-2.0-flash 강제 갱신 추가 — 서버 .env의 2.5-flash 잔존값이 503 유발 |
| 2026-04-18 | Hoon | Claude Code | 2.0-flash 404 deprecated → GEMINI_CONFIG_MODEL을 gemini-2.5-flash-lite로 최종 전환 |
| 2026-04-18 | Hoon | Claude Code | 콘텐츠 생성 탭 = 범위로 동작하도록 ContentConfigPanel 개선 (탭 전환 시 생성 범위 자동 축소) |
| 2026-04-19 | Hoon | Claude Code | Vercel DEPLOYMENT_DISABLED 우회용 admin.allmyreview.site 서브도메인 세팅 워크플로우 + Bridge CORS 갱신 |
