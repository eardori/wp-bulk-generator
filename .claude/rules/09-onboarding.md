# Onboarding & Usage Guide

## 세션 시작 시 동작 (IMPORTANT)

Claude는 세션 시작 시 역할이 선언되지 않으면 반드시 아래 순서대로 진행:

### Step 1: 역할 확인
```
안녕하세요! WP Bulk Generator 프로젝트에 오신 것을 환영합니다.

작업을 시작하기 전에 역할을 확인하겠습니다.
아래 중 본인을 선택해주세요:

1. Justin (홍정의) - Frontend Developer
2. Kevin (오현석) - Backend Developer
3. Hoon (송훈) - Project Manager
```

### Step 2: 마지막 접속 기록 확인 + 변경사항 브리핑

역할 확인 후:
1. `docs/members/{name}-last-seen.txt` 파일에서 마지막 접속 날짜 읽기
   - 파일이 없으면 → 최초 접속으로 간주, 최근 3일 CHANGELOG 표시
2. `docs/CHANGELOG.md`에서 마지막 접속 날짜 이후의 항목만 추출하여 표시
3. `docs/tasks/{name}-inbox.md` 에서 대기 중인 요청 확인
4. 현재 날짜를 `docs/members/{name}-last-seen.txt`에 기록 (덮어쓰기)

```
━━━ {이름}님, 환영합니다! ━━━━━━━━━━━━━━

📌 마지막 접속({YYYY-MM-DD}) 이후 변경사항:
• {CHANGELOG 항목 1줄 요약}
• {CHANGELOG 항목 1줄 요약}
(변경 없으면: "마지막 접속 이후 변경사항 없음")

📬 내 요청함 (inbox):
• {대기 중 요청 목록}
(없으면: "대기 중인 요청 없음")
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**last-seen 파일 관리**:
- 경로: `docs/members/{name}-last-seen.txt` (name은 소문자)
- 내용: `YYYY-MM-DD` 한 줄만 기록
- git 추적 대상 (다른 멤버가 pull 받아야 동기화됨)

### Step 3: 환영 + Quick Guide
```
{멤버 파일의 환영 메시지}

━━━ Quick Guide ━━━━━━━━━━━━━━━━━━━━━━

📋 할 수 있는 것들:
• 코드 작성/수정 (담당 영역 내)
• "가이드 보여줘" → 전체 사용법 안내
• "내 역할 수정해줘" → 역할 파일 수정
• "내 체크리스트 보여줘" → PR 체크리스트
• "프로젝트 현황 보여줘" → CHANGELOG + 진행 상황
• "내 요청함", "내 inbox" → 나에게 온 요청 목록
• "{멤버}에게 요청해줘" → 다른 멤버 작업 요청 기록
• "기능 현황", "대시보드" → 전체 기능 진행 상황

📁 주요 문서:
• docs/architecture/ → 시스템 아키텍처, API 레퍼런스
• docs/features/ → AI 생성, 페르소나, SEO 문서
• docs/scraping/ → 스크래핑 엔진 가이드
• docs/deployment/ → 서버 세팅, 배포 가이드
• docs/tasks/ → 멤버 간 요청 보드
• docs/status.md → 기능 진행 대시보드

⚠️ 주의사항:
• 담당 영역 외 수정 시 해당 멤버에게 요청하세요
• PR 전 체크리스트를 반드시 확인하세요
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 중간 가이드 트리거

| 트리거 | 동작 |
|--------|------|
| "가이드", "도움말", "help" | Quick Guide 출력 |
| "내 역할", "내 권한" | 멤버 파일에서 담당 영역 출력 |
| "내 체크리스트" | PR 체크리스트 출력 |
| "프로젝트 현황" | CHANGELOG + status.md 출력 |
| "내 요청함", "내 inbox" | docs/tasks/{name}-inbox.md 출력 |
| "기능 현황", "대시보드" | docs/status.md 출력 |