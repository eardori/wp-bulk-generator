# ADR-001: Vercel + Bridge API 아키텍처

## 상태
승인 (2026-03-11)

## 맥락
Next.js admin이 EC2(t2.micro)에서 PM2로 서빙되고 있었다.
같은 서버에 WordPress/MariaDB/Nginx가 공존하여 성능 한계가 있었고,
빌드/배포/SSL 관리를 수동으로 해야 했다.

## 결정
**웹서버(Next.js)만 Vercel Free로 이전**, DB와 WordPress는 EC2에 유지.

### 아키텍처
```
[브라우저] → [Vercel: Next.js (UI + 경량 프록시)]
                ├─→ [EC2 Bridge API :4000] → 장시간 작업 전부
                └─→ 짧은 API만 직접 처리
```

### Vercel Free 60s 제한 대응
- **경량 프록시** (60s 이내): fetch-sites, site-groups, server-status
- **Bridge 위임** (60s 초과): generate-articles, publish-articles, seo-optimize, deploy 등
- **클라이언트 직접 SSE**: Vercel API가 JWT 토큰 발급 → 클라이언트가 bridge에 직접 연결

### Bridge API
- EC2에서 Fastify 서버 (port 4000) 운영
- Nginx 리버스 프록시: `bridge.allmyreview.site/api/` → `:4000`
- 인증: API Key (서버간) + JWT Bearer (클라이언트 직접)
- 17개 엔드포인트: 스크래핑, AI 생성, WP REST API, SSH 등

## 대안
1. **Vercel Pro ($20/월)**: 300s 한도지만 비용 발생
2. **EC2 유지**: 빌드/배포/SSL 수동 관리 부담
3. **전체 서버리스**: Playwright/SSH 등 무거운 의존성을 서버리스에서 사용 불가

## 결과
- Vercel: 자동 배포, SSL, CDN, Preview URL 확보
- EC2: WP + Bridge API만 유지 (리소스 부담 감소)
- 추후 Oracle Cloud Free Tier로 EC2 이전 검토 가능

---
## 변경 이력
| 날짜 | 작성자 | 도구 | 변경 내용 |
|------|--------|------|-----------|
| 2026-03-11 | Kevin | Claude Code | ADR 초안 작성 |
