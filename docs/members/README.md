# Member System

## 온보딩 가이드

이 프로젝트는 **역할 기반 접근 제어**를 사용합니다.
Claude Code 세션을 시작할 때, 반드시 자신의 역할을 선언해야 합니다.

### 역할 선언 방법

세션 시작 시 아래 중 하나를 입력하세요:

```
나는 Justin이야
나는 Kevin이야
나는 Hoon이야
```

역할을 선언하지 않으면 Claude가 먼저 물어봅니다:
> "안녕하세요! 작업을 시작하기 전에 역할을 확인하겠습니다.
> Justin(FE), Kevin(BE), Hoon(PM) 중 누구신가요?"

---

## 멤버 목록

| 이름 | 본명 | 역할 | 주요 담당 | 파일 |
|------|------|------|-----------|------|
| **Justin** | 홍정의 | Frontend Developer | React 컴포넌트, 페이지, Tailwind UI | [justin.md](justin.md) |
| **Kevin** | 오현석 | Backend Developer | API routes, 스크래핑, AI 생성, WordPress API, SSH | [kevin.md](kevin.md) |
| **Hoon** | 송훈 | Project Manager | 기획, 문서 총괄, 배포 승인, SEO 전략 | [hoon.md](hoon.md) |

---

## 역할별 권한 매트릭스

| 경로 | Justin (FE) | Kevin (BE) | Hoon (PM) |
|------|-------------|------------|-----------|
| `admin/src/app/` (pages) | ✅ 소유 | ⚠️ 협의 | ❌ 지시 |
| `admin/src/app/api/` (API routes) | ⚠️ 협의 | ✅ 소유 | ❌ 지시 |
| `admin/src/components/` | ✅ 소유 | ⚠️ 협의 | ❌ |
| `scripts/` (서버 스크립트) | ❌ | ✅ 소유 | ⚠️ 승인 |
| `admin/scripts/` (서버 MJS) | ❌ | ✅ 소유 | ⚠️ 승인 |
| `configs/` (사이트 설정) | ✅ | ✅ | ✅ |
| `docs/` | ✅ 자기 영역 | ✅ 자기 영역 | ✅ 전체 관리 |
| `docs/tasks/` | ✅ 자기 inbox | ✅ 자기 inbox | ✅ 자기 inbox |
| `docs/architecture/`, `docs/scraping/` | 읽기 | ✅ 소유 | 읽기 |
| `docs/features/` | ✅ | ✅ | ✅ |
| `docs/deployment/` | 읽기 | ✅ 소유 | ⚠️ 승인 |
| `CLAUDE.md`, `.claude/rules/` | 읽기 | 읽기 | ✅ 소유 |

✅ = 자유롭게 수정 가능
⚠️ = 해당 소유자와 협의 후 수정
❌ = 수정 불가 (해당 담당자에게 요청/지시)

---

## 협업 흐름

```
[Hoon] 기능 기획 / SEO 전략
    ↓
[Kevin] API 구현 + 스크래핑 엔진 개발
    ↓
[Justin] UI 구현 ←→ [Kevin] API 연동
    ↓
[All] 테스트 + PR 리뷰
    ↓
[Hoon] 배포 승인 → [Kevin] 서버 배포
```

---

## Claude에게 다른 멤버 작업 요청하기

자신의 권한 밖의 작업이 필요할 때:
```
"Kevin에게 {작업내용} 요청해줘"
"Justin이 {기능명} UI를 만들어야 해"
"Hoon에게 이 변경사항 승인 요청해줘"
```

Claude는 해당 멤버의 inbox(`docs/tasks/{name}-inbox.md`)에 요청을 기록합니다.

---
## 변경 이력
| 날짜 | 작성자 | 도구 | 변경 내용 |
|------|--------|------|-----------|
| 2026-03-10 | - | Claude Code | 멤버 시스템 가이드 및 권한 매트릭스 작성 |
