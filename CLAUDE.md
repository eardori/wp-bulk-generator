# WP Bulk Generator - 프로젝트 가이드

## 프로젝트 개요

WordPress 사이트를 대량 생성하고, AI로 콘텐츠를 자동 생성·발행하는 도구.
건강기능식품/영양제 리뷰 블로그 사이트를 타겟으로 한다.

### 핵심 기능
- **사이트 대량 배포**: JSON 설정 기반으로 WordPress 사이트 일괄 설치 (Nginx + PHP + MariaDB)
- **콘텐츠 생성**: AI(Gemini/Claude/OpenAI)로 제품 리뷰 아티클 자동 생성
- **상품 스크래핑**: 쿠팡 등 쇼핑몰에서 상품 정보 + 리뷰 자동 수집 (Playwright)
- **SEO 최적화**: 기존 콘텐츠에 대한 SEO 메타데이터 자동 최적화
- **Admin 대시보드**: Next.js 기반 관리 UI

---

## 폴더 구조

```
wp-bulk-generator/
├── admin/                    # Next.js 16 관리 대시보드
│   ├── src/
│   │   ├── app/              # Next.js App Router 페이지
│   │   │   ├── api/          # API Route Handlers
│   │   │   │   ├── content/  # 콘텐츠 관련 API (생성, 발행, 스크래핑, SEO)
│   │   │   │   ├── dashboard/
│   │   │   │   ├── deploy-sites/
│   │   │   │   ├── generate-configs/
│   │   │   │   └── server-status/
│   │   │   ├── content/      # 콘텐츠 관리 페이지
│   │   │   ├── dashboard/    # 대시보드 페이지
│   │   │   └── groups/       # 사이트 그룹 관리
│   │   └── components/       # React 컴포넌트
│   │       └── content/      # 콘텐츠 관련 컴포넌트
│   ├── scripts/              # Admin 전용 서버 스크립트 (MJS)
│   ├── .env.local            # 로컬 환경변수 (git 추적 안함)
│   ├── .env.example          # 환경변수 템플릿
│   └── package.json
├── scripts/                  # 서버 배포/운영 쉘 스크립트
│   ├── setup-server.sh       # VPS 초기 세팅 (Nginx, PHP, MariaDB, WP-CLI)
│   ├── deploy-wp-sites.sh    # WordPress 사이트 대량 설치
│   ├── backfill-existing-sites.sh
│   ├── rebuild-admin.sh      # Admin 빌드 & 배포
│   ├── seo-optimize.php      # WP 플러그인용 SEO 최적화
│   ├── seo-optimize-existing.sh
│   ├── seo-optimize-existing.mjs
│   ├── generate-static-sitemaps.sh
│   └── tune-wordpress-stack.sh
├── configs/                  # 사이트 설정 파일
│   └── sites-config.json     # 사이트 목록 및 설정 정의
├── CLAUDE.md                 # 이 파일
└── .gitignore
```

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| Admin Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| AI 엔진 | Google Gemini, Anthropic Claude, OpenAI |
| 스크래핑 | Playwright + Stealth Plugin, Cheerio |
| 서버 연결 | SSH2 (Node.js에서 원격 서버 제어) |
| WordPress 서버 | Nginx, PHP 8.2, MariaDB, WP-CLI, Redis |
| 배포 스크립트 | Bash (Ubuntu 22.04/24.04 대상) |

---

## 개발 환경 셋업

### 1. Admin (Next.js) 실행
```bash
cd admin
cp .env.example .env.local   # 환경변수 설정
npm install
npm run dev                  # http://localhost:3000
```

### 2. 환경변수 (.env.local)
`admin/.env.example` 참조. 실제 API 키와 SSH 설정 값은 팀원에게 별도 공유.

### 3. SSH 키 설정
서버 접속용 PEM 키를 로컬에 저장 후, `.env.local`의 `SSH_KEY_PATH`에 경로 지정.

---

## 공동작업 규칙

### Git 컨벤션

#### 브랜치 전략
- `main`: 안정 버전. 직접 push 금지, PR을 통해서만 머지
- `feature/<기능명>`: 새 기능 개발
- `fix/<이슈>`: 버그 수정
- `script/<스크립트명>`: 서버 스크립트 변경

#### 커밋 메시지
```
<type>: <설명 (한국어 OK)>

# 예시
feat: 콘텐츠 SEO 최적화 API 추가
fix: 스크래핑 시 타임아웃 오류 수정
script: deploy-wp-sites.sh 인증서 갱신 로직 추가
chore: 불필요한 로그 파일 정리
```

**Type 종류**: `feat`, `fix`, `refactor`, `script`, `style`, `chore`, `docs`

### 코드 스타일

#### TypeScript (admin/)
- **파일 네이밍**: 컴포넌트는 PascalCase (`SiteSelector.tsx`), API route는 Next.js 컨벤션 (`route.ts`)
- **타입**: `type` 키워드 사용 (`interface` 대신). 타입 정의는 해당 feature 폴더의 `types.ts`에 모아둠
- **import**: `@/` alias 사용 (= `src/`)
- **스타일**: Tailwind CSS 유틸리티 클래스 사용, 별도 CSS 파일 지양

#### Shell Scripts (scripts/)
- 첫 줄: `#!/bin/bash`
- `set -euo pipefail` 반드시 포함
- 한국어 주석 허용
- 변수명: `UPPER_SNAKE_CASE`
- 에러 처리와 로그 출력 필수

### 시크릿 관리

**절대 커밋 금지 항목:**
- `.env`, `.env.local` (API 키, SSH 정보)
- `sites-credentials.json` (WP 비밀번호, DB 비밀번호)
- `*.pem`, `*.key` (SSH 키)
- 서버 IP 주소를 소스코드에 하드코딩하지 말 것

시크릿은 `.env.local` 파일을 통해 로컬 관리하고, 팀원 간 안전한 채널로 공유.

### API Route 작성 규칙
- `admin/src/app/api/` 아래에 Next.js Route Handler 패턴 사용
- 스트리밍 응답이 필요한 경우 `ReadableStream` + `TextEncoder` 패턴 사용
- 에러 응답은 적절한 HTTP 상태 코드와 JSON 메시지 반환

### 새 사이트 추가
1. `configs/sites-config.json`에 사이트 설정 추가
2. Admin 대시보드에서 "Generate Configs" → "Deploy Sites" 실행
3. credentials는 서버에서 자동 생성됨 (admin/.cache/에 캐시)

---

## 주요 API 엔드포인트 (admin)

| 경로 | 기능 |
|------|------|
| `POST /api/generate-configs` | sites-config.json 기반 WP 설정 생성 |
| `POST /api/deploy-sites` | SSH로 서버에 WP 사이트 일괄 배포 |
| `GET /api/server-status` | 서버 상태 확인 |
| `GET /api/dashboard` | 대시보드 데이터 조회 |
| `POST /api/content/scrape-product` | 상품 URL에서 정보 스크래핑 |
| `POST /api/content/fetch-reviews` | 상품 리뷰 수집 |
| `POST /api/content/generate-articles` | AI 아티클 생성 |
| `POST /api/content/publish-articles` | WordPress에 아티클 발행 |
| `POST /api/content/seo-optimize` | SEO 메타데이터 최적화 |
| `GET /api/content/fetch-sites` | 배포된 사이트 목록 조회 |
| `POST /api/content/site-groups` | 사이트 그룹 관리 |

---

## 서버 스크립트 (scripts/)

서버 스크립트는 **Ubuntu 22.04/24.04 EC2** 에서 실행됨.
로컬에서 직접 실행하지 않고, Admin 대시보드의 SSH 기능을 통해 원격 실행하거나,
SSH로 서버에 접속하여 실행.

```bash
# 서버 초기 세팅 (1회)
./scripts/setup-server.sh

# WordPress 사이트 대량 배포
./scripts/deploy-wp-sites.sh configs/sites-config.json
```

---

## 주의사항

- admin/ 내부의 `node_modules/`는 커밋하지 않음 (npm install로 복원)
- Playwright 브라우저는 첫 실행 시 자동 설치됨
- 서버 스크립트는 root 권한이 필요함 (sudo)
- `.cache/` 디렉토리는 런타임 캐시이므로 git에 포함하지 않음
