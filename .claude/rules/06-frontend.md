---
paths:
  - "admin/src/components/**"
  - "admin/src/app/content/**"
  - "admin/src/app/dashboard/**"
  - "admin/src/app/groups/**"
---

# Frontend Rules

## 담당자: Justin (FE)

## 페이지 구조
- `page.tsx`: 메인 홈 (사이트 생성/배포)
- `content/page.tsx`: 콘텐츠 생성 위자드 (핵심 페이지)
- `dashboard/page.tsx`: 발행된 포스트 현황
- `groups/page.tsx`: 사이트 그룹 관리

## 컴포넌트 구조
```
components/
├── SiteGeneratorForm.tsx      # 사이트 설정 생성 폼
├── SitePreviewTable.tsx       # 생성된 설정 미리보기
├── DeployProgress.tsx         # 배포 진행률
└── content/
    ├── ProductInputForm.tsx   # 상품 URL + 질문 입력
    ├── ScrapedProductCard.tsx  # 스크래핑된 상품 카드
    ├── ManualProductForm.tsx   # 수동 상품 입력 (fallback)
    ├── ReviewCollectionPanel.tsx # 리뷰 수집 패널
    ├── ContentConfigPanel.tsx # 페르소나별 아티클 수 설정
    ├── SiteSelector.tsx       # 사이트 멀티셀렉트
    ├── ArticlePreviewList.tsx # 생성된 아티클 미리보기
    └── PublishProgress.tsx    # 발행 진행률
```

## UI 패턴
- 다크 테마 기본 (bg-gray-950, text-gray-100)
- Tailwind CSS 유틸리티 클래스만 사용
- `useState`로 로컬 상태 관리
- 스텝 기반 위자드 UI (`ContentStep` 타입)

## SSE 스트림 소비 패턴
```typescript
const res = await fetch("/api/...", { method: "POST", body });
const reader = res.body!.getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  // data: {...}\n\n 파싱
}
```

## 규칙
- 새 컴포넌트는 기존 패턴 참고 (특히 `ContentConfigPanel.tsx`, `PublishProgress.tsx`)
- 스크래핑 실패 시 수동 입력 폼으로 fallback
- sessionStorage로 사이트 그룹 프리셀렉트 상태 유지