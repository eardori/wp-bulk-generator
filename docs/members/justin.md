# Justin (홍정의) - Frontend Developer

## 환영 메시지
> Justin으로 확인되었습니다. React 컴포넌트 및 UI 작업에 집중합니다.
> 작업 시작 전 관련 기능 문서(`docs/features/`)를 확인하세요.

## 담당 영역
- **페이지**: `admin/src/app/` 하위 모든 page.tsx
- **컴포넌트**: `admin/src/components/` 전체
- **스타일**: Tailwind CSS 유틸리티 클래스
- **사용자 흐름**: 스텝 기반 위자드 UI (콘텐츠 생성 워크플로우)
- **상태 관리**: useState 기반 로컬 상태
- **SSE 소비**: 스트리밍 API 응답 처리

## 수정 가능 경로
```
✅ admin/src/app/page.tsx
✅ admin/src/app/content/**
✅ admin/src/app/dashboard/**
✅ admin/src/app/groups/**
✅ admin/src/components/**
✅ admin/src/app/globals.css
✅ admin/src/app/layout.tsx
✅ configs/** (사이트 설정)
⚠️ admin/src/app/api/** → Kevin에게 요청
❌ scripts/** → Kevin 담당
❌ admin/scripts/** → Kevin 담당
```

## Claude Code 지침
1. UI 중심 코드 작성에 집중
2. 기존 컴포넌트 패턴 참고 (특히 `ContentConfigPanel.tsx`, `PublishProgress.tsx`)
3. API route 수정 필요 시 → "Kevin에게 {요청 내용} 전달이 필요합니다" 안내
4. 다크 테마 유지 (bg-gray-950, text-gray-100)
5. Tailwind CSS만 사용, 별도 CSS 파일 지양
6. 스크래핑 실패 시 수동 입력 폼 fallback 패턴 유지

## 코딩 스타일
- "use client" 디렉티브 필수 (인터랙티브 페이지)
- useState로 로컬 상태 관리 (Redux/Zustand 미사용)
- 컴포넌트명: PascalCase
- Tailwind: 인라인 클래스 (별도 CSS 지양)

## PR 체크리스트
- [ ] UI가 다크 테마에서 정상 표시되는지 확인
- [ ] 스트리밍 API 응답 처리가 정상 동작하는지 확인
- [ ] 에러 상태에서 적절한 fallback UI가 표시되는지 확인
- [ ] 기존 컴포넌트와 스타일 일관성 유지
- [ ] CHANGELOG.md 업데이트

## 이 파일 수정하기
이 파일은 Justin 본인만 자연어로 수정할 수 있습니다:
- "내 담당 영역에 {영역} 추가해줘"
- "체크리스트에 {항목} 추가해줘"
- "내 환영 메시지 바꿔줘"

---
## 변경 이력
| 날짜 | 작성자 | 도구 | 변경 내용 |
|------|--------|------|-----------|
| 2026-03-10 | - | Claude Code | 초기 역할 파일 생성 |
