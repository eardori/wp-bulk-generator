#!/bin/bash
# fix-proxy-ssl.sh
# Secondary proxy nginx 설정에 HTTPS(443) 블록을 추가하고,
# Let's Encrypt 인증서에 누락된 도메인을 추가합니다.
# 또한 자동 SSL 동기화 cron을 설치합니다.
#
# 사용법: sudo bash fix-proxy-ssl.sh

set -uo pipefail

echo "====================================="
echo "  SSL Proxy 수정 및 자동화 스크립트"
echo "====================================="
echo ""

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
echo "서버 역할: $SERVER_ROLE"
echo "인증서명: $CERT_NAME"
echo "인증서 경로: $CERT_DIR"
echo ""

# ---- 1단계: secondary proxy에서 도메인 수집 ----
echo "--- 1단계: secondary proxy 도메인 수집 ---"
PROXY_DOMAINS=()
PROXY_CONFIGS=()

for conf in /etc/nginx/sites-enabled/secondary-proxy-*; do
  [ -f "$conf" ] || continue
  domain="$(grep -oP 'server_name\s+\K[a-z0-9][-a-z0-9]*\.allmyreview\.site' "$conf" 2>/dev/null | head -1)"
  if [ -z "$domain" ]; then
    continue
  fi
  
  # 이미 443 listen이 있는지 확인
  if grep -q 'listen 443' "$conf" 2>/dev/null; then
    echo "  ✓ $domain - 이미 SSL 설정 있음"
    continue
  fi
  
  PROXY_DOMAINS+=("$domain")
  PROXY_CONFIGS+=("$conf")
done

echo ""
echo "SSL 설정이 없는 proxy: ${#PROXY_DOMAINS[@]}개"
for d in "${PROXY_DOMAINS[@]}"; do
  echo "  - $d"
done
echo ""

# ---- 2단계: 모든 도메인 수집 (인증서용) ----
echo "--- 2단계: 인증서 도메인 수집 ---"
ALL_DOMAINS="$(
  {
    # nginx sites-enabled에서 수집
    grep -rh 'server_name' /etc/nginx/sites-enabled/ 2>/dev/null \
      | tr ';' '\n' \
      | grep -oP '[a-z0-9][-a-z0-9]*\.allmyreview\.site' \
      | sort -u
    
    # /var/www WP에서 수집
    for site_dir in /var/www/*/; do
      [ -f "$site_dir/wp-config.php" ] || continue
      home="$(timeout 8 wp option get home --path="$site_dir" --allow-root 2>/dev/null || true)"
      home="${home#https://}"
      home="${home#http://}"
      home="${home%%/*}"
      if [[ "$home" == *.allmyreview.site ]]; then
        echo "$home"
      fi
    done
    
    # 기존 인증서에서 수집
    if [ -f "$CERT_DIR/fullchain.pem" ]; then
      openssl x509 -in "$CERT_DIR/fullchain.pem" -noout -text 2>/dev/null \
        | grep -oP 'DNS:[^\s,]+' \
        | sed 's/DNS://' 
    fi
  } | sort -u
)"

TOTAL="$(echo "$ALL_DOMAINS" | grep -c '.' || true)"
echo "전체 도메인 수: ${TOTAL}개"

if [ "$TOTAL" -gt 100 ]; then
  echo "⚠ 도메인 ${TOTAL}개 > 100개. Let's Encrypt 한도 초과 가능성."
  echo "  계속 진행하되, 실패 시 wildcard 인증서 전환이 필요합니다."
fi

# ---- 3단계: certbot으로 인증서 확장 ----
echo ""
echo "--- 3단계: certbot 인증서 확장 ---"

# 현재 인증서에 없는 도메인 확인
CERT_DOMAINS=""
if [ -f "$CERT_DIR/fullchain.pem" ]; then
  CERT_DOMAINS="$(openssl x509 -in "$CERT_DIR/fullchain.pem" -noout -text 2>/dev/null \
    | grep -oP 'DNS:[^\s,]+' \
    | sed 's/DNS://' \
    | sort -u)"
fi

MISSING_CERT=()
while IFS= read -r domain; do
  [ -z "$domain" ] && continue
  if ! echo "$CERT_DOMAINS" | grep -Fxq "$domain"; then
    MISSING_CERT+=("$domain")
  fi
done <<< "$ALL_DOMAINS"

if [ "${#MISSING_CERT[@]}" -gt 0 ]; then
  echo "인증서에 누락된 도메인: ${#MISSING_CERT[@]}개"
  for d in "${MISSING_CERT[@]}"; do
    echo "  + $d"
  done
  
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
  
  echo ""
  echo "certbot 실행 중... (시간이 걸릴 수 있습니다)"
  if "${CERTBOT_ARGS[@]}"; then
    echo "✓ 인증서 갱신 성공"
  else
    echo "✗ certbot 실행 실패!"
    echo "  수동으로 확인해주세요."
    exit 1
  fi
else
  echo "✓ 모든 도메인이 이미 인증서에 포함됨"
fi

# ---- 4단계: proxy 설정에 HTTPS 블록 추가 ----
echo ""
echo "--- 4단계: secondary proxy에 HTTPS 설정 추가 ---"

UPDATED_COUNT=0
for i in "${!PROXY_CONFIGS[@]}"; do
  conf="${PROXY_CONFIGS[$i]}"
  domain="${PROXY_DOMAINS[$i]}"
  
  # 기존 설정에서 proxy_pass 대상 포트 추출
  backend_port="$(grep -oP 'proxy_pass\s+http://127\.0\.0\.1:\K[0-9]+' "$conf" 2>/dev/null | head -1)"
  if [ -z "$backend_port" ]; then
    backend_port="$(grep -oP 'proxy_pass\s+http://[^:]+:\K[0-9]+' "$conf" 2>/dev/null | head -1)"
  fi
  if [ -z "$backend_port" ]; then
    echo "  ⚠ $domain - backend 포트를 찾을 수 없음, 건너뜀"
    continue
  fi
  
  # 인증서 파일 확인
  if [ ! -f "$CERT_DIR/fullchain.pem" ] || [ ! -f "$CERT_DIR/privkey.pem" ]; then
    echo "  ⚠ $domain - 인증서 파일이 없음, 건너뜀"
    continue
  fi
  
  # 새 설정 생성 (HTTP 80 redirect + HTTPS 443 proxy)
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

  echo "  ✓ $domain - HTTPS 설정 추가 (backend: :$backend_port)"
  UPDATED_COUNT=$((UPDATED_COUNT + 1))
done

echo ""
echo "업데이트된 proxy 설정: ${UPDATED_COUNT}개"

# ---- 5단계: nginx 검증 및 리로드 ----
echo ""
echo "--- 5단계: nginx 검증 및 리로드 ---"
if nginx -t 2>&1; then
  systemctl reload nginx
  echo "✓ nginx 리로드 완료"
else
  echo "✗ nginx 설정 검증 실패!"
  echo "  수동으로 확인해주세요."
  exit 1
fi

# ---- 6단계: auto-ssl-sync cron 설치 ----
echo ""
echo "--- 6단계: 자동 SSL 동기화 cron 설치 ---"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AUTO_SSL_SCRIPT="$SCRIPT_DIR/auto-ssl-sync.sh"

if [ ! -f "$AUTO_SSL_SCRIPT" ]; then
  # 현재 디렉토리에 있는지 확인
  AUTO_SSL_SCRIPT="$(pwd)/auto-ssl-sync.sh"
fi

if [ ! -f "$AUTO_SSL_SCRIPT" ]; then
  # 홈 디렉토리에 있는지 확인
  AUTO_SSL_SCRIPT="$HOME/auto-ssl-sync.sh"
fi

if [ -f "$AUTO_SSL_SCRIPT" ]; then
  # auto-ssl-sync.sh를 /usr/local/bin으로 복사
  cp "$AUTO_SSL_SCRIPT" /usr/local/bin/auto-ssl-sync.sh
  chmod 755 /usr/local/bin/auto-ssl-sync.sh
  
  # cron 설정 (6시간마다 실행)
  cat > /etc/cron.d/auto-ssl-sync <<CRON
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# 6시간마다 SSL 인증서 동기화 (누락된 도메인 자동 추가)
0 */6 * * * root /usr/local/bin/auto-ssl-sync.sh >> /var/log/auto-ssl-sync.log 2>&1
CRON
  chmod 644 /etc/cron.d/auto-ssl-sync
  echo "✓ cron 설치 완료 (/etc/cron.d/auto-ssl-sync)"
  echo "  - 실행 주기: 6시간마다"
  echo "  - 스크립트: /usr/local/bin/auto-ssl-sync.sh"
  echo "  - 로그: /var/log/auto-ssl-sync.log"
else
  echo "⚠ auto-ssl-sync.sh를 찾을 수 없습니다."
  echo "  수동으로 /usr/local/bin/auto-ssl-sync.sh에 복사하고 cron을 설정해주세요."
fi

echo ""
echo "====================================="
echo "  완료!"
echo "====================================="
echo ""
echo "요약:"
echo "  - 인증서 누락 도메인 추가: ${#MISSING_CERT[@]}개"
echo "  - HTTPS proxy 설정 추가: ${UPDATED_COUNT}개"
echo "  - 자동 SSL cron: 설치됨"
echo ""
echo "확인: https://family-friendly.allmyreview.site 접속 테스트"
echo "====================================="
