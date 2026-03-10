---
paths:
  - "admin/src/app/api/**"
  - "admin/scripts/**"
---

# Backend Rules

## 담당자: Kevin (BE)

## API Route 패턴
- Next.js Route Handler: `export async function POST(req: NextRequest)`
- 장시간 작업: SSE 스트리밍 (`text/event-stream`)
- 에러: `NextResponse.json({ error: "..." }, { status: 4xx/5xx })`
- `maxDuration` 설정 필수 (300s 기본, 배포는 600s)

## 스크래핑 엔진 (scrape-product)
6개 소스별 파서:
- **Naver Smart Store**: `__PRELOADED_STATE__` JSON 추출 (curl fallback)
- **Coupang**: CSS 셀렉터 + 모바일 fallback
- **Olive Young**: Playwright + Cloudflare 우회 (`page.evaluate()`)
- **Naver Place**: Playwright + 리뷰 페이지네이션 (50건 목표)
- **iHerb**: Schema.org `itemprop` 셀렉터
- **11번가**: CSS 셀렉터
- **Generic**: OG tags + JSON-LD fallback

새 스크래퍼 추가 시 기존 파서 패턴 준수.

## 리뷰 수집 (fetch-reviews)
- Naver: curl + JSON API (iPhone user-agent, Node.js fetch 차단 우회)
- Olive Young: Playwright `page.evaluate()` (브라우저 컨텍스트 fetch)
- 리뷰 테마 추출: 키워드 감성 분석 (positive/negative/neutral)

## AI 콘텐츠 생성 (generate-articles)
- Google Gemini 2.0 Flash (JSON 응답 모드)
- 3개 병렬 처리 (rate limit 대응)
- 429 에러: 5회 재시도, 지수 백오프 (30/60/120/180초)
- 8개 상품 앵글 + 8개 맛집 앵글 = 16가지 콘텐츠 프레임워크
- 리뷰 이미지 플레이스홀더: `<!-- REVIEW_IMG:reviewIndex:imageIndex -->`

## WordPress 발행 (publish-articles)
- REST API + Basic Auth (app_pass)
- 이미지 업로드: curl → `/wp-json/wp/v2/media`
- 카테고리/태그 자동 생성
- FAQ + Article Schema JSON-LD 삽입
- Yoast SEO 메타 설정
- 캐시 워밍: 홈, robots.txt, sitemap, 포스트 URL

## SSH 배포 (deploy-sites)
- 로컬 모드: SSH2로 원격 명령 실행
- EC2 모드: 직접 스크립트 실행
- 진행률 파싱: `[N/M]` 메시지 추적
- 인증 정보: `/root/wp-sites-credentials.json` → `.cache/`로 동기화