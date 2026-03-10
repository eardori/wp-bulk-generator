# Server Setup Guide

WordPress 다중 사이트를 호스팅할 EC2 서버 초기 설정 가이드.

## 대상 환경

- **OS**: Ubuntu 22.04 / 24.04
- **권장 사양**: 512MB-1GB RAM (t3.micro / t4.small)
- **스크립트**: `scripts/setup-server.sh`

---

## 설치 구성요소

### 1. Swap (4GB)
```bash
fallocate -l 4G /swapfile
chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
# Swappiness: 10 (RAM 우선 사용)
```
저사양 서버에서 메모리 부족 방지.

### 2. Nginx
- Worker connections: 512
- FastCGI 캐시: `/tmp/nginx-cache` (256MB, 60분 inactive)
- Gzip: level 4
- Client body size: 32MB

### 3. PHP 8.2
**확장 모듈**: fpm, mysql, curl, gd, mbstring, xml, zip, intl, soap, bcmath, redis, imagick, opcache

**PHP-FPM 설정**:
| 항목 | 값 | 이유 |
|------|-----|------|
| pm | ondemand | 유휴 시 메모리 해제 |
| pm.max_children | 7 | 저메모리 서버 |
| memory_limit | 128M | 프로세스당 |
| upload_max_filesize | 32M | 이미지 업로드 |
| max_execution_time | 300s | 장시간 작업 |
| opcache.memory | 64M | 컴파일 캐시 |
| opcache.max_files | 4000 | WordPress 파일 수 |

### 4. MariaDB
| 항목 | 값 |
|------|-----|
| InnoDB buffer pool | 128M |
| Query cache | 16M |
| Max connections | 50 |
| Character set | utf8mb4 |

자격증명 저장: `/root/.wp-bulk-credentials`

### 5. Redis
- Maxmemory: 32MB
- 정책: allkeys-lru (가장 적게 사용된 키 제거)
- 용도: WordPress 오브젝트 캐시

### 6. WP-CLI
- 설치 경로: `/usr/local/bin/wp`
- WordPress 명령줄 관리 도구

### 7. SSL / Certbot
- HTTPS 인증서 자동 발급
- 단일 도메인 또는 와일드카드 SAN 지원

### 8. UFW 방화벽
- 허용: 22 (SSH), 80 (HTTP), 443 (HTTPS)
- 기타 포트 차단

---

## 성능 튜닝 요약

| 컴포넌트 | 파라미터 | 값 | 대상 |
|----------|----------|-----|------|
| Nginx | worker_connections | 512 | 동시 연결 |
| PHP-FPM | pm | ondemand | 자동 스케일링 |
| PHP-FPM | max_children | 7 | 프로세스 제한 |
| MariaDB | innodb_buffer_pool | 128M | 인덱스 캐시 |
| Redis | maxmemory | 32MB | 오브젝트 캐시 |
| FastCGI | cache zone | 256M | HTML 캐시 |

모든 값은 512MB-1GB RAM 서버 기준 튜닝.

---

## 추가 튜닝

**파일**: `scripts/tune-wordpress-stack.sh`
- PHP-FPM 세부 튜닝 (이미 setup-server.sh에서 기본 설정 후 추가 조정 필요 시)

---

## 실행

```bash
# 서버에서 직접 실행
sudo bash scripts/setup-server.sh

# SSH로 원격 실행
scp scripts/setup-server.sh user@server:/tmp/
ssh user@server "sudo bash /tmp/setup-server.sh"
```

소요 시간: ~10-15분 (패키지 설치 + 서비스 시작)

---
## 변경 이력
| 날짜 | 작성자 | 도구 | 변경 내용 |
|------|--------|------|-----------|
| 2026-03-10 | - | Claude Code | 서버 설정 가이드 초안 작성 |
