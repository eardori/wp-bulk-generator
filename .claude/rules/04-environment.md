---
paths:
  - "admin/.env*"
  - "admin/src/app/api/**"
---

# Environment & Secrets

## 필수 환경변수 (admin/.env.local)
```
GEMINI_API_KEY=        # Google Gemini API 키
SSH_HOST=              # EC2 서버 IP
SSH_USER=              # SSH 사용자 (보통 ubuntu)
SSH_KEY_PATH=          # PEM 키 파일 경로
WEB_ROOT=              # WordPress 설치 경로 (보통 /var/www)
```

## 환경변수 관리
- `.env.example`: 키 이름만 포함 (값 없음). git 추적 O
- `.env.local`: 실제 값 포함. git 추적 X
- 새 환경변수 추가 시 `.env.example` 동시 업데이트 필수

## 절대 커밋 금지
- `.env`, `.env.local` (API 키, SSH 정보)
- `sites-credentials.json` (WP 비밀번호, DB 비밀번호)
- `*.pem`, `*.key` (SSH 키)
- 서버 IP를 소스코드에 하드코딩하지 말 것

## .cache/ 디렉토리
- `admin/.cache/sites-credentials.json`: 배포 후 생성되는 WP 인증 정보 캐시
- `admin/.cache/sites-config.json`: 사이트 설정 로컬 캐시
- `admin/.cache/site-groups.json`: 사이트 그룹 설정
- 모두 런타임 캐시이며 git 추적 안함

## Local vs EC2 모드
- `deploy-sites` API에 `isLocalDevMode()` 패턴 사용
- 로컬: SSH를 통해 원격 서버에 명령 전송
- EC2: 직접 스크립트 실행 (SSH 불필요)
