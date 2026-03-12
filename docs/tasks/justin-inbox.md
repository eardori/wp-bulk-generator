# Justin Inbox

## 대기 중
| ID | 날짜 | 요청자 | 우선순위 | 내용 | 관련 파일 | 비고 |
|----|------|--------|----------|------|-----------|------|
| J-001 | 2026-03-11 | Kevin | 🔵 참고 | GitHub Actions CI/CD 추가됨 | `.github/workflows/ci.yml`, `deploy.yml` | PR 시 admin/ 코드 lint + type check + build 자동 실행됨. 별도 작업 필요 없음 |
| J-002 | 2026-03-13 | Kevin | 🟡 주의 | 대시보드 API 수정 작업 중 — EC2 Bridge 연동 미완료 | `admin/src/app/api/dashboard/route.ts` | 대시보드(/dashboard)에서 사이트·글 목록 안 보일 수 있음. EC2 Agent 미가동 상태. Kevin이 내일 이어서 작업 예정 |

## 진행 중
| ID | 시작일 | 요청자 | 내용 | 관련 파일 |
|----|--------|--------|------|-----------|

## 완료
| ID | 완료일 | 요청자 | 내용 |
|----|--------|--------|------|

---
## 변경 이력
| 날짜 | 작성자 | 도구 | 변경 내용 |
|------|--------|------|-----------|
| 2026-03-10 | - | Claude Code | inbox 초기 구조 생성 |
| 2026-03-11 | Kevin | Claude Code | CI/CD 추가 알림 등록 |
| 2026-03-13 | Kevin | Claude Code | 대시보드 작업 중 알림 등록 |
