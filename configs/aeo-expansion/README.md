# AEO Expansion Site Configs

## 파일

- `own-domains.json` — own 도메인 2개 (박상무 + 김셰프) WP 배포 설정 템플릿

## 사용 절차

### 1. 도메인 구매 후 정보 채우기

```json
"domain": "TBD-OWN-DOMAIN-2.com"  →  "domain": "gangnamtable.com"
```

### 2. 호스팅 프로비저닝 후 IP/유저 채우기

```json
"server_host": "TBD-VM-IP-1"      →  "server_host": "35.123.xxx.xxx"
"server_user": "TBD-USER"          →  "server_user": "ubuntu"
"server_repo_root": "/home/ubuntu/wp-bulk-generator"
```

### 3. 배포 명령

```bash
# Bridge 서버 또는 GCP VM 에서
sudo /home/ubuntu/wp-bulk-generator/scripts/deploy-wp-sites.sh \
  /home/ubuntu/wp-bulk-generator/configs/aeo-expansion/own-domains.json
```

또는 admin 대시보드에서 deploy 트리거.

### 4. 배포 후 검증

```bash
# robots.txt
curl -s https://gangnamtable.com/robots.txt | grep ^Sitemap:
# 기대: Sitemap: https://gangnamtable.com/sitemap_index.xml

# Schema
curl -s https://gangnamtable.com/sample-post/ | grep -E 'canonical|og:url|"@type":"Article"'

# Bing Webmaster
# https://www.bing.com/webmasters → Add a site
```

## chowlog 와의 차이

- chowlog: `configs/chowlog-site.json` (재민 페르소나, GCP 기존 VM)
- own 도메인 2개: `configs/aeo-expansion/own-domains.json` (박상무/김셰프, 새 VM 2개)

## 주의

- 도메인 미정 상태로 배포 X
- DNS A 레코드 전파 확인 후 배포 (Let's Encrypt SSL 발급 위해 필수)
- chowlog 와 같은 GCP 프로젝트 사용 시 VM region 다르게 (Tokyo + Singapore 권장)
