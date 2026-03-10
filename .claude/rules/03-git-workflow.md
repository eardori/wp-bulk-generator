# Git Workflow

## Branch Strategy
- **main**: 안정 버전. 직접 push 금지, PR을 통해서만 머지
- **feature/{feature-name}**: 새 기능 개발 → main으로 PR
- **fix/{bug-description}**: 버그 수정 → main으로 PR
- **script/{script-name}**: 서버 스크립트 변경 → main으로 PR

## Commit Convention
```
type: 설명 (한국어 OK)

types: feat, fix, refactor, script, style, chore, docs
```
예: `feat: 콘텐츠 SEO 최적화 API 추가`
예: `script: deploy-wp-sites.sh 인증서 갱신 로직 추가`

## PR Rules
- main ← feature/fix/script 브랜치로 PR 생성
- PR 설명은 한국어로 작성
- 파일 소유자 기준으로 리뷰어 지정:
  - `admin/src/app/`, `admin/src/components/` → Justin
  - `admin/src/app/api/`, `scripts/` → Kevin
  - `docs/`, `configs/` → Hoon
- CHANGELOG.md 업데이트 포함 필수

## 시크릿 체크
커밋 전 반드시 확인:
- `.env`, `.env.local` 포함되지 않았는지
- `credentials*.json` 포함되지 않았는지
- `*.pem`, `*.key` 포함되지 않았는지
- 서버 IP가 하드코딩되지 않았는지
