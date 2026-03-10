# Changelog

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
