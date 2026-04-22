# chowlog.xyz 재배포 마이그레이션 계획

**배경**: 2026-04-22 Hoon 결정 — 기존 chowlog.xyz (GCP Seoul, 34.64.108.67) 는 WP 어드민 접속 불가 상태. 이 리포의 신규 시스템(Bridge + deploy-wp-sites.sh)으로 같은 도메인 재배포하여 AEO 개선사항을 처음부터 반영.

**관련 메모리**: `project_chowlog_new_system.md`, `project_aeo_goal.md`

---

## 목표

- 동일 도메인 `chowlog.xyz` 로 신규 WP 사이트 배포
- 기존 글 1개(`/seolyagalbi-cheongdam-review/`)를 **같은 slug** 로 복구 → 404 0건
- 이 세션 모든 AEO 개선이 처음부터 적용 (Yoast wordCount 필터, author slug, aggregateRating 가드, Bing 제출 차단)
- 페르소나 identity 100% 일관성 (`재민` / `/author/jaemin/` / Person schema)

---

## AEO 관점 위험 평가

| 항목 | 위험 | 완화 |
|------|------|------|
| 도메인 권위 | 낮음 — 동일 도메인 | DNS 만 변경, 레지스트라 기록 유지 |
| 기존 URL 404 | 중간 — Bing 이 "사이트 재건" 신호로 판독 시 일시 노출 하락 | 기존 글 1개를 같은 slug 로 복구 → 404 0건 |
| 재크롤링 기간 | 중간 — 1~2주 예상 | sitemap `lastmod` 자동 최신. robots.txt 도 Bingbot 허용 유지 |
| SSL | 낮음 | `deploy-wp-sites.sh` 가 Let's Encrypt 자동 |
| 스키마 연속성 | **오히려 개선** | 현재 chowlog 의 `wordCount=42`, `author=admin` 같은 버그 신호가 사라짐 |

**결론**: 단기 2주 재크롤링 기간을 제외하면 **장기 AEO 는 오히려 개선**. 현재 chowlog 의 Yoast 버그 / identity 불일치가 AI 답변 엔진에 저품질 신호인 반면, 재배포 후에는 모든 신호가 정확.

---

## 마이그레이션 대상

`chowlog.xyz/wp-json/wp/v2/posts/6` 기준 글 1개:

- **slug**: `seolyagalbi-cheongdam-review`
- **title**: "설야갈비 청담 방문 후기 — 접대·모임으로 쓸만한 청담 갈비 맛집"
- **date**: 2026-04-21T22:15:08
- **modified**: 2026-04-22T10:32:00
- **content.rendered**: 14,267 chars (1,471 어절)
- **카테고리**: "청담"
- **태그**: 강남맛집, 설야갈비, 접대, 청담, 콜키지프리, 프라이빗룸, 한우
- **featured_media**: 10 (이미지 URL — 새 사이트에 업로드 필요)

원본 저장 위치 (gitignored `.cache/`):
- `admin/.cache/chowlog-migration/seolyagalbi-cheongdam-review.html` (118KB)
- `admin/.cache/chowlog-migration/post-raw.json` (37KB)

---

## 배포 Config

`configs/chowlog-site.json` 에 작성:

- site_slug: `chowlog`
- domain: `chowlog.xyz`
- persona: `재민` / slug=`jaemin` / bio 포함
- 카테고리: 강남 지하철역 단위 (강남역/역삼/선릉/삼성/신논현/논현/청담/압구정)

---

## 실행 단계 (Hoon 승인 필요)

### Phase 1 — 새 사이트 배포
1. Lightsail 서버 용량 확인 (기존 사이트 수 + chowlog 1개 추가 여유)
2. `deploy-wp-sites.sh configs/chowlog-site.json` 실행 (서버에서)
   - 또는 Bridge `/deploy` 엔드포인트로 SSE 스트리밍
3. 새 chowlog 가 Lightsail IP (54.248.12.228) 에서 기본 WP 로 뜸
   - 단, DNS 는 아직 GCP 이므로 외부에서는 접근 불가. 내부 hosts 파일로 먼저 확인

### Phase 2 — 콘텐츠 마이그레이션
1. Featured image 다운로드 → 새 사이트 media 업로드
2. 카테고리/태그 생성 (기존과 동일 이름)
3. `seolyagalbi-cheongdam-review` 글 재생성 (같은 slug, 같은 date)
   - 본문 HTML 은 저장된 post-raw.json 에서 가져옴
   - `_yoast_wpseo_metadesc` 수동 설정 (기존과 동일)
4. 홈 페이지 세팅 (레이아웃)

### Phase 3 — DNS 전환
1. 도메인 레지스트라(Cloudflare 등?)에서 **TTL 낮추기** (예: 300초) — 최소 수 시간 전
2. A 레코드 변경: `chowlog.xyz` → `54.248.12.228` (Lightsail)
3. 전환 확인 (`dig +short chowlog.xyz`)
4. curl 로 새 사이트 접근 확인 + 라이브 HTML 검증
5. TTL 복원 (예: 3600)

### Phase 4 — 기존 GCP 서버 정리
1. 일주일 대기 — Bing 재크롤링 완료 모니터
2. 기존 GCP 서버 중지 또는 삭제
3. 필요 시 DB 백업 보관

---

## Hoon 필요 입력

1. **Lightsail 서버 용량** — chowlog 추가 여유 있는지 (`df -h /var/www`)
2. **DNS 관리 권한** — 어느 레지스트라? (Cloudflare / Namecheap / GoDaddy 등)
3. **기존 GCP 서버** — SSH 접근 가능한가? (기존 글 export 가 훨씬 깔끔)
4. **마이그레이션 시점** — 언제 실행? (트래픽 적은 시간대 권장)
5. **색상 스킴 / tagline / persona age** — `configs/chowlog-site.json` 초안 검토

---

## 변경 이력
| 날짜 | 작성자 | 도구 | 변경 내용 |
|------|--------|------|-----------|
| 2026-04-22 | Hoon | Claude Code | 마이그레이션 계획 초안 작성. config + AEO 위험 평가 + 4단계 실행 plan |
