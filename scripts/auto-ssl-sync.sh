#!/bin/bash
# auto-ssl-sync.sh
# Nginx에 설정된 모든 *.allmyreview.site 도메인을 감지하고
# Let's Encrypt 인증서에 자동으로 추가하는 스크립트.
# cron에 등록하여 새 사이트 추가 시 자동 SSL을 보장합니다.
#
# 사용법:
#   sudo bash auto-ssl-sync.sh          # 일반 실행
#   sudo bash auto-ssl-sync.sh --dry    # dry-run (변경 없이 상태만 표시)

set -uo pipefail

DRY_RUN=0
if [ "${1:-}" = "--dry" ] || [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
fi

LOCK_FILE="/tmp/auto-ssl-sync.lock"
LOG_FILE="/var/log/auto-ssl-sync.log"

# 다른 인스턴스가 이미 실행 중이면 종료
if [ -f "$LOCK_FILE" ]; then
  LOCK_PID="$(cat "$LOCK_FILE" 2>/dev/null || true)"
  if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') 이미 다른 인스턴스 실행 중 (PID=$LOCK_PID)" | tee -a "$LOG_FILE"
    exit 0
  fi
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG_FILE"
}

# ---- 서버 역할 감지 ----
SERVER_ROLE_FILE="/etc/wp-bulk-server-role"
SERVER_ROLE=""
if [ -f "$SERVER_ROLE_FILE" ]; then
  SERVER_ROLE="$(tr -d '\r\n' < "$SERVER_ROLE_FILE")"
fi

case "$SERVER_ROLE" in
  primary)   CERT_NAME="allmyreview-primary-sites" ;;
  secondary) CERT_NAME="allmyreview-secondary-sites" ;;
  *)         CERT_NAME="allmyreview-sites" ;;
esac

CERT_DIR="/etc/letsencrypt/live/$CERT_NAME"
MAX_DOMAINS="${ALLMYREVIEW_CERT_MAX_NAMES:-100}"

# ---- 1. Nginx 설정에서 모든 *.allmyreview.site 도메인 수집 ----
# nginx의 server_name 디렉티브에서 정확한 FQDN을 추출
collect_nginx_domains() {
  grep -rhP 'server_name\s+' /etc/nginx/sites-enabled/ 2>/dev/null \
    | sed 's/server_name//g' \
    | tr ';' '\n' \
    | sed 's/^\s*//;s/\s*$//' \
    | grep '\.allmyreview\.site$' \
    | sort -u
}

# ---- 2. /var/www 에서 WP home URL 기반 도메인 수집 ----
collect_wp_domains() {
  for site_dir in /var/www/*/; do
    [ -f "$site_dir/wp-config.php" ] || continue
    local home
    home="$(timeout 8 wp option get home --path="$site_dir" --allow-root 2>/dev/null || true)"
    home="${home#https://}"
    home="${home#http://}"
    home="${home%%/*}"
    if [[ "$home" == *.allmyreview.site ]]; then
      echo "$home"
    fi
  done | sort -u
}

# ---- 3. 현재 인증서에 포함된 도메인 ----
collect_cert_domains() {
  if [ -f "$CERT_DIR/fullchain.pem" ]; then
    openssl x509 -in "$CERT_DIR/fullchain.pem" -noout -text 2>/dev/null \
      | grep -oP 'DNS:[^\s,]+' \
      | sed 's/DNS://' \
      | sort -u
  fi
}

# ---- 4. HTTP-only proxy 설정에 HTTPS 블록 자동 추가 ----
fix_proxy_ssl_configs() {
  local updated=0
  for conf in /etc/nginx/sites-enabled/secondary-proxy-*; do
    [ -f "$conf" ] || continue
    
    # 이미 443 listen이 있으면 건너뜀
    grep -q 'listen 443' "$conf" 2>/dev/null && continue
    
    local domain
    domain="$(grep -oP 'server_name\s+\K[a-z0-9][-a-z0-9.]*\.allmyreview\.site' "$conf" 2>/dev/null | head -1)"
    [ -z "$domain" ] && continue
    
    local backend_port
    backend_port="$(grep -oP 'proxy_pass\s+http://127\.0\.0\.1:\K[0-9]+' "$conf" 2>/dev/null | head -1)"
    [ -z "$backend_port" ] && continue
    
    # 인증서 파일 확인
    [ -f "$CERT_DIR/fullchain.pem" ] || continue
    [ -f "$CERT_DIR/privkey.pem" ] || continue
    
    cat > "$conf" <<NGINX
server {
    listen 80;
    server_name $domain;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
        try_files \$uri =404;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name $domain;

    ssl_certificate $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 128m;
    include /etc/nginx/snippets/wp-bulk-scanner-blocks.conf;

    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;
    add_header Referrer-Policy "strict-origin-when-cross-origin";

    location / {
        proxy_pass http://127.0.0.1:$backend_port;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Port 443;
        proxy_read_timeout 180s;
        proxy_send_timeout 180s;
        proxy_buffering off;
        proxy_redirect off;
    }
}
NGINX
    log "  ✓ HTTPS 설정 추가: $domain (backend: :$backend_port)"
    updated=$((updated + 1))
  done
  
  if [ "$updated" -gt 0 ]; then
    log "HTTPS proxy 설정 ${updated}개 업데이트됨"
  fi
}

# ---- 실행 ----
log "===== SSL 동기화 시작 (서버역할=$SERVER_ROLE, 인증서=$CERT_NAME) ====="

# 모든 소스에서 도메인 수집 후 합치기
ALL_DOMAINS="$(
  {
    collect_nginx_domains
    collect_wp_domains
    collect_cert_domains
  } | sort -u
)"

DOMAIN_COUNT="$(echo "$ALL_DOMAINS" | grep -c '.' || true)"
log "수집된 전체 도메인: ${DOMAIN_COUNT}개"

if [ "$DOMAIN_COUNT" -eq 0 ]; then
  log "도메인이 없으므로 종료"
  exit 0
fi

if [ "$DOMAIN_COUNT" -gt "$MAX_DOMAINS" ]; then
  log "⚠ 도메인 ${DOMAIN_COUNT}개 > 최대 ${MAX_DOMAINS}개. wildcard 인증서 전환이 필요합니다."
  exit 1
fi

# 현재 인증서에 없는 도메인 찾기
CERT_DOMAINS="$(collect_cert_domains)"
MISSING=()
while IFS= read -r domain; do
  [ -z "$domain" ] && continue
  if [ -z "$CERT_DOMAINS" ] || ! echo "$CERT_DOMAINS" | grep -Fxq "$domain"; then
    MISSING+=("$domain")
  fi
done <<< "$ALL_DOMAINS"

if [ "${#MISSING[@]}" -eq 0 ]; then
  log "✓ 모든 도메인이 인증서에 포함되어 있음. 변경 필요 없음."
  # 인증서 갱신은 불필요하지만 proxy SSL 설정은 확인
  fix_proxy_ssl_configs
  if nginx -t 2>/dev/null; then
    systemctl reload nginx 2>/dev/null || true
  fi
  exit 0
fi

log "누락된 도메인 ${#MISSING[@]}개 발견:"
for d in "${MISSING[@]}"; do
  log "  + $d"
done

if [ "$DRY_RUN" -eq 1 ]; then
  log "[DRY-RUN] certbot 실행을 건너뜁니다."
  exit 0
fi

# certbot 명령어 구성
CERTBOT_ARGS=(
  certbot certonly
  --nginx
  --non-interactive
  --agree-tos
  --register-unsafely-without-email
  --cert-name "$CERT_NAME"
)

if [ -f "$CERT_DIR/fullchain.pem" ]; then
  CERTBOT_ARGS+=(--expand)
fi

while IFS= read -r domain; do
  [ -z "$domain" ] && continue
  CERTBOT_ARGS+=(-d "$domain")
done <<< "$ALL_DOMAINS"

log "certbot 실행 중..."
if "${CERTBOT_ARGS[@]}" >> "$LOG_FILE" 2>&1; then
  log "✓ 인증서 갱신 성공"
  
  # HTTPS proxy 설정 자동 수정
  fix_proxy_ssl_configs
  
  # nginx 설정 검증 후 리로드
  if nginx -t 2>/dev/null; then
    systemctl reload nginx
    log "✓ nginx 리로드 완료"
  else
    log "⚠ nginx 설정 검증 실패. 수동 확인 필요."
  fi
else
  log "✗ certbot 실행 실패"
  exit 1
fi

log "===== SSL 동기화 완료 ====="
