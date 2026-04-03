---
description: Bridge API를 AWS Lightsail 서버에 배포하는 워크플로우
---

# Bridge API 배포 워크플로우

## 서버 정보
- **Host**: 54.248.12.228
- **User**: ubuntu
- **SSH Key**: `~/.ssh/lightsail-key.pem` (원본: 바탕화면 `LightsailDefaultKey-ap-northeast-1.pem`)
- **Bridge API 코드 경로**: `/home/ubuntu/wp-bulk-generator/bridge-api/`
- **프로세스 매니저**: PM2 (프로세스명: `wp-bridge-api`, ID: 113)
- **⚠️ 주의**: `bridge-api` (ID: 107)은 레거시. 반드시 `wp-bridge-api`만 사용
- **Bridge API .env 위치**: `/home/ubuntu/wp-bulk-generator/bridge-api/.env`

## Bridge API 배포 단계

// turbo-all

1. 로컬 빌드 확인
```powershell
cd "c:\Users\hsong\OneDrive\바탕 화면\Dev\WP Generator\bridge-api"
npm run build
```

2. tar 압축 (한글 경로 SCP 우회)
```powershell
Push-Location "c:\Users\hsong\OneDrive\바탕 화면\Dev\WP Generator\bridge-api"
tar -czf "$env:USERPROFILE\.ssh\bridge-dist.tar.gz" -C . dist package.json
Pop-Location
```

3. 서버에 업로드
```powershell
scp -i "$env:USERPROFILE\.ssh\lightsail-key.pem" "$env:USERPROFILE\.ssh\bridge-dist.tar.gz" ubuntu@54.248.12.228:~/bridge-dist.tar.gz
```

4. 서버에서 압축 해제 + npm install + PM2 재시작
```powershell
ssh -i "$env:USERPROFILE\.ssh\lightsail-key.pem" ubuntu@54.248.12.228 "cd /home/ubuntu/wp-bulk-generator/bridge-api && rm -rf dist && tar -xzf ~/bridge-dist.tar.gz && npm install --production 2>&1 | tail -3 && pm2 restart wp-bridge-api && sleep 3 && curl -s http://localhost:4000/health"
```

## 상태 확인

```powershell
ssh -i "$env:USERPROFILE\.ssh\lightsail-key.pem" ubuntu@54.248.12.228 "pm2 list && curl -s http://localhost:4000/health"
```

## 헬스체크 URL
- Bridge API: http://54.248.12.228:4000/health
- Admin (Vercel): https://wp-bulk-generator.vercel.app
