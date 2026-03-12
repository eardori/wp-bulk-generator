# Hoon Inbox

## 대기 중
| ID | 날짜 | 요청자 | 우선순위 | 내용 | 관련 파일 | 비고 |
|----|------|--------|----------|------|-----------|------|
| H-001 | 2026-03-11 | Kevin | 🔵 참고 | GitHub Actions CI/CD 추가됨 | `.github/workflows/ci.yml`, `deploy.yml` | PR → lint/build 자동 검증, main 머지 → EC2 자동 배포. GitHub Secrets 설정 필요 (SSH_PRIVATE_KEY, SSH_HOST, SSH_USER) |
| H-002 | 2026-03-13 | Kevin | 🟡 주의 | 대시보드 + EC2 Bridge 작업 중 | Nginx, bridge-api/.env | 대시보드(/dashboard)에서 사이트·글 목록 미표시 상태. EC2 Agent 미가동 + 환경변수 미설정. Kevin이 3/14 이어서 작업 예정 |

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
