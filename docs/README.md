# WP Bulk Generator - Documentation Index

## 문서 구조

| 폴더 | 용도 | 관리자 |
|------|------|--------|
| [architecture/](architecture/) | 시스템 아키텍처, API 레퍼런스, 콘텐츠 파이프라인 | Kevin |
| [scraping/](scraping/) | 스크래핑 엔진별 동작 방식 | Kevin |
| [deployment/](deployment/) | EC2 서버 세팅, WP 사이트 배포 가이드 | Kevin |
| [features/](features/) | AI 생성, 페르소나, SEO 등 기능 문서 | All |
| [tasks/](tasks/) | 멤버 간 요청 보드 (inbox별 추적) | All |
| [decisions/](decisions/) | 의사결정 기록 (ADR) | All |
| [members/](members/) | 멤버별 역할, 권한, 체크리스트 | All |

## 주요 문서

### 아키텍처
- [SYSTEM_OVERVIEW.md](architecture/SYSTEM_OVERVIEW.md) - 시스템 전체 아키텍처 + 데이터 흐름도
- [API_REFERENCE.md](architecture/API_REFERENCE.md) - 전체 API 엔드포인트 상세 문서
- [CONTENT_PIPELINE.md](architecture/CONTENT_PIPELINE.md) - 콘텐츠 생성 파이프라인 상세

### 스크래핑
- [SCRAPING_ENGINE_GUIDE.md](scraping/SCRAPING_ENGINE_GUIDE.md) - 6개 스크래핑 엔진 동작 방식

### 배포
- [SERVER_SETUP_GUIDE.md](deployment/SERVER_SETUP_GUIDE.md) - EC2 서버 초기 세팅 가이드
- [SITE_DEPLOYMENT_GUIDE.md](deployment/SITE_DEPLOYMENT_GUIDE.md) - WordPress 사이트 배포 워크플로우

### 기능
- [AI_CONTENT_GENERATION.md](features/AI_CONTENT_GENERATION.md) - AI 아티클 생성 파이프라인
- [PERSONA_SYSTEM.md](features/PERSONA_SYSTEM.md) - 페르소나 기반 콘텐츠 시스템
- [SEO_OPTIMIZATION.md](features/SEO_OPTIMIZATION.md) - SEO 최적화 기능

### 프로젝트 관리
- [CHANGELOG.md](CHANGELOG.md) - 변경 이력
- [status.md](status.md) - 기능별 진행 현황 대시보드
- [tasks/index.md](tasks/index.md) - 전체 요청 인덱스

---
## 변경 이력
| 날짜 | 작성자 | 도구 | 변경 내용 |
|------|--------|------|-----------|
| 2026-03-10 | - | Claude Code | 문서 인덱스 초안 작성 |
