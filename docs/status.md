# 기능 진행 대시보드

## 핵심 기능 현황

| 기능 | 상태 | 담당 | 비고 |
|------|------|------|------|
| 사이트 설정 생성 (AI) | ✅ 완료 | Kevin | Gemini로 페르소나/사이트 템플릿 자동 생성 |
| 사이트 대량 배포 (SSH) | ✅ 완료 | Kevin | EC2에 Nginx+PHP+MariaDB+WP 일괄 설치 |
| 상품 스크래핑 | ✅ 완료 | Kevin | 6개 소스 (Naver, Coupang, OliveYoung, iHerb, 11st, NaverPlace) |
| 리뷰 수집 | ✅ 완료 | Kevin | Naver Smart Store, Olive Young |
| AI 아티클 생성 | ✅ 완료 | Kevin | Gemini 2.0 Flash, 16가지 앵글, 페르소나 기반 |
| WordPress 발행 | ✅ 완료 | Kevin | REST API, 이미지 업로드, SEO 메타 |
| SEO 최적화 | ✅ 완료 | Kevin | FAQ/Article Schema, Yoast 메타, alt 태그 |
| 사이트 그룹 관리 | ✅ 완료 | Justin | 사이트 그룹 CRUD, 프리셀렉트 |
| 대시보드 | ✅ 완료 | Justin | 사이트별 발행 포스트 현황 |
| 서버 상태 확인 | ✅ 완료 | Kevin | SSH 기반 메모리/디스크/사이트 수 |

## 관리 기능 현황

| 기능 | 상태 | 담당 | 비고 |
|------|------|------|------|
| 멤버 시스템 | ✅ 완료 | Hoon | 역할 기반 접근 제어 |
| 문서 체계 | ✅ 완료 | Hoon | CLAUDE.md + rules + docs 구조 |
| CI/CD | ✅ 완료 | Kevin | GitHub Actions: PR 검증 + Vercel 자동 배포 + Fly.io 배포 + EC2 Agent 배포 |
| Vercel 마이그레이션 | ✅ 완료 | Kevin | Vercel ↔ Bridge API E2E 연동 완료 (2026-03-12) |
| Fly.io 마이그레이션 | 🔧 진행 중 | Kevin | Bridge API → Fly.io 분리 (코드 완료, 배포 대기) |
| EC2 Agent | 🔧 진행 중 | Kevin | 경량 Fastify (:4001) — credentials/deploy/health/groups (코드 완료, 배포 대기) |
| Oracle Cloud 이전 | ⏸️ 보류 | - | Fly.io 분리 완료로 우선순위 하락 |
| 테스트 | ❌ 미구현 | - | 추후 테스트 프레임워크 도입 예정 |

## 상태 범례
- ✅ 완료
- 🔧 진행 중
- ❌ 미구현
- ⏸️ 보류

---
## 변경 이력
| 날짜 | 작성자 | 도구 | 변경 내용 |
|------|--------|------|-----------|
| 2026-03-10 | - | Claude Code | 기능 대시보드 초안 작성 |
| 2026-03-11 | Kevin | Claude Code | CI/CD 완료 상태 업데이트 |
| 2026-03-11 | Kevin | Claude Code | Vercel 마이그레이션, Bridge API, Oracle Cloud 항목 추가 |
| 2026-03-11 | Kevin | Claude Code | Vercel/Bridge 코드 완료 상태 업데이트, EC2 인프라 설정 남음 기록 |
| 2026-03-12 | Kevin | Claude Code | Bridge API 완료, Vercel 마이그레이션 거의 완료 상태 업데이트 |
| 2026-03-12 | Kevin | Claude Code | Vercel 마이그레이션 완료 (E2E 테스트 통과) |
| 2026-03-12 | Kevin | Claude Code | Fly.io 마이그레이션 + EC2 Agent 항목 추가 |
