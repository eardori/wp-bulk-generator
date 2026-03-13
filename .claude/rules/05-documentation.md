---
paths:
  - "docs/**"
  - "CLAUDE.md"
---

# Documentation Rules

## 언어 규칙
- 코드 주석: 한국어 또는 영어
- 문서 파일(docs/): 한국어
- 커밋 메시지: 한국어 또는 영어

## CHANGELOG.md (IMPORTANT - 반드시 준수)
- `docs/CHANGELOG.md`에 모든 변경사항 기록
- 형식: `## YYYY-MM-DD: 제목` + 변경 내용 목록
- **코드 또는 인프라를 수정하는 모든 세션에서 CHANGELOG 업데이트 필수**
  - 커밋 전이 아니라, 세션 중 의미 있는 변경이 발생하면 바로 기록
  - 같은 날짜에 여러 항목이 쌓일 수 있음
  - 문서만 수정한 경우는 생략 가능

## 문서 종류별 위치
- 아키텍처: `docs/architecture/` (시스템 개요, API, 파이프라인)
- 스크래핑: `docs/scraping/` (엔진별 가이드)
- 배포: `docs/deployment/` (서버 세팅, 사이트 배포)
- 기능: `docs/features/` (AI 생성, 페르소나, SEO)
- 요청 보드: `docs/tasks/` (멤버 간 작업 요청)
- 의사결정: `docs/decisions/` (ADR)
- 멤버: `docs/members/` (역할, 권한)

## 파일 네이밍
- 문서: `UPPER_SNAKE_CASE.md` (예: `SYSTEM_OVERVIEW.md`)
- ADR: `ADR-{NNN}-{title}.md` (예: `ADR-001-streaming-sse.md`)
- 멤버: `{name}.md` (소문자)

## 파일 변경 이력 (IMPORTANT - 반드시 준수)

모든 `docs/**/*.md` 파일을 생성/수정할 때,
파일 하단에 변경 이력 테이블을 반드시 추가/업데이트한다.

### 형식
```markdown
---
## 변경 이력
| 날짜 | 작성자 | 도구 | 변경 내용 |
|------|--------|------|-----------|
| 2026-03-10 | Kevin | Claude Code | 초안 작성 |
```

### 필드 설명
- **날짜**: YYYY-MM-DD
- **작성자**: 현재 세션 멤버 이름 (Justin / Kevin / Hoon)
- **도구**: `Claude Code`, `직접 작성`, `GitHub Copilot` 등
- **변경 내용**: 무엇을 변경했는지 간단히 기술

### Claude Code 자동 동작
1. 파일 하단에 `## 변경 이력` 섹션이 없으면 → 새로 생성
2. 이미 있으면 → 테이블에 새 행 추가 (최신이 아래)
3. 작성자 = 현재 세션 멤버 이름
4. 도구 = `Claude Code`
5. 역할 미선언 상태면 작성자 = `-` (역할 확인 먼저 요청)
