---
paths:
  - "scripts/**"
---

# Server Scripts Rules

## 담당자: Kevin (BE), 프로덕션 변경은 Hoon 승인 필요

## 실행 환경
- Ubuntu 22.04/24.04 EC2
- root 권한 필요 (sudo)
- 로컬에서 직접 실행하지 않음 (Admin SSH 또는 서버 접속)

## 스크립트 목록

| 스크립트 | 용도 | 실행 시점 |
|---------|------|----------|
| `setup-server.sh` | VPS 초기 세팅 (Nginx, PHP 8.2, MariaDB, WP-CLI, Redis) | 1회 |
| `deploy-wp-sites.sh` | JSON 설정 기반 WordPress 사이트 대량 설치 | 사이트 추가 시 |
| `rebuild-admin.sh` | Admin 대시보드 빌드 & 서버 배포 | 코드 변경 시 |
| `backfill-existing-sites.sh` | 기존 사이트 역추적 등록 | 필요 시 |
| `seo-optimize-existing.sh` | 기존 포스트 SEO 일괄 최적화 | 필요 시 |
| `seo-optimize-existing.mjs` | SEO 최적화 Node.js 버전 | 필요 시 |
| `seo-optimize.php` | WP 플러그인용 SEO 최적화 | 필요 시 |
| `generate-static-sitemaps.sh` | 정적 사이트맵 생성 | 필요 시 |
| `tune-wordpress-stack.sh` | WordPress 스택 성능 튜닝 | 1회 |

## 작성 규칙
- `#!/bin/bash` + `set -euo pipefail` 필수
- 변수명: `UPPER_SNAKE_CASE`
- 한국어 주석 허용
- 에러 처리와 진행 로그 출력 필수
- credentials는 `/root/.wp-bulk-credentials` 에서 source

## 수정 프로세스
1. `script/{name}` 브랜치에서 작업
2. 로컬 테스트 불가능한 경우 서버에서 직접 테스트
3. PR 생성 → Hoon 승인 → main 머지