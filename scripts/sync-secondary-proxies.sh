#!/bin/bash
# Sync reverse-proxy vhosts on the primary server for secondary-origin sites.

set -euo pipefail

CREDS_FILE="${CREDS_FILE:-/home/ubuntu/wp-bulk-generator/bridge-api/data/wp-sites-credentials.json}"
ALLMYREVIEW_CERT_NAME="${ALLMYREVIEW_CERT_NAME:-allmyreview-sites}"
ALLMYREVIEW_CERT_DIR="/etc/letsencrypt/live/$ALLMYREVIEW_CERT_NAME"
ALLMYREVIEW_CERT_MAX_NAMES="${ALLMYREVIEW_CERT_MAX_NAMES:-95}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
PROXY_PREFIX="secondary-proxy-"
ACME_WEBROOT="${ACME_WEBROOT:-/var/www/certbot}"

if [ ! -f "$CREDS_FILE" ]; then
  echo "⚠ credentials file missing: $CREDS_FILE"
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required"
  exit 1
fi

cert_covers_domain() {
  local domain="$1"

  [[ -f "$ALLMYREVIEW_CERT_DIR/fullchain.pem" ]] || return 1
  openssl x509 -in "$ALLMYREVIEW_CERT_DIR/fullchain.pem" -noout -text 2>/dev/null | grep -Fq "DNS:$domain"
}

build_tunnel_port() {
  local host="$1"
  local checksum
  checksum="$(printf '%s' "$host" | cksum | awk '{print $1}')"
  printf '%s' $((18000 + (checksum % 1000)))
}

ensure_host_tunnel() {
  local host="$1"
  local ssh_user="$2"
  local key_path="$3"
  local port="$4"
  local service_name="wp-secondary-tunnel-${host//./-}.service"
  local unit_path="/etc/systemd/system/${service_name}"

  cat > "$unit_path" <<UNIT
[Unit]
Description=Tunnel to secondary host $host
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/ssh -NT -L 127.0.0.1:${port}:127.0.0.1:80 -i ${key_path} -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes ${ssh_user}@${host}
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl enable --now "$service_name" >/dev/null
}

resolve_upstream_target() {
  local host="$1"
  local ssh_user="$2"
  local key_path="$3"

  if [ -n "$ssh_user" ] && [ -n "$key_path" ] && [ -f "$key_path" ]; then
    local port
    port="$(build_tunnel_port "$host")"
    ensure_host_tunnel "$host" "$ssh_user" "$key_path" "$port"
    printf '127.0.0.1:%s' "$port"
    return 0
  fi

  printf '%s' "$host"
}

write_proxy_config() {
  local slug="$1"
  local domain="$2"
  local upstream_target="$3"
  local mode="$4"
  local nginx_path="/etc/nginx/sites-available/${PROXY_PREFIX}${slug}"

  if [ "$mode" = "https" ]; then
    cat > "$nginx_path" <<NGINX
server {
    listen 80;
    server_name $domain;

    location ^~ /.well-known/acme-challenge/ {
        root $ACME_WEBROOT;
        default_type "text/plain";
        try_files \$uri =404;
    }

    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $domain;

    ssl_certificate $ALLMYREVIEW_CERT_DIR/fullchain.pem;
    ssl_certificate_key $ALLMYREVIEW_CERT_DIR/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 128m;

    location / {
        proxy_pass http://$upstream_target;
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
  else
    cat > "$nginx_path" <<NGINX
server {
    listen 80;
    server_name $domain;

    client_max_body_size 128m;

    location ^~ /.well-known/acme-challenge/ {
        root $ACME_WEBROOT;
        default_type "text/plain";
        try_files \$uri =404;
    }

    location / {
        proxy_pass http://$upstream_target;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto http;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Port 80;
        proxy_read_timeout 180s;
        proxy_send_timeout 180s;
        proxy_buffering off;
        proxy_redirect off;
    }
}
NGINX
  fi

  ln -sfn "$nginx_path" "/etc/nginx/sites-enabled/${PROXY_PREFIX}${slug}"
}

declare -a entries=()
declare -a domains=()

while IFS=$'\t' read -r slug domain upstream_host ssh_user key_path; do
  [ -n "$slug" ] || continue
  [ -n "$domain" ] || continue
  [ -n "$upstream_host" ] || continue
  entries+=("${slug}"$'\t'"${domain}"$'\t'"${upstream_host}"$'\t'"${ssh_user}"$'\t'"${key_path}")
  domains+=("$domain")
done < <(
  jq -r '
    .[]?
    | select((.server_id // "") != "" and (.server_id != "primary"))
    | select(.slug and .domain and .server_host)
    | [.slug, .domain, .server_host, (.server_user // ""), (.server_key_path // "")] | @tsv
  ' "$CREDS_FILE"
)

declare -A active=()
for entry in "${entries[@]}"; do
  slug="${entry%%$'\t'*}"
  active["$slug"]=1
done

shopt -s nullglob
for existing in /etc/nginx/sites-available/${PROXY_PREFIX}*; do
  base="$(basename "$existing")"
  slug="${base#${PROXY_PREFIX}}"
  if [ -z "${active[$slug]:-}" ]; then
    rm -f "/etc/nginx/sites-enabled/$base" "$existing"
  fi
done
shopt -u nullglob

if [ "${#entries[@]}" -eq 0 ]; then
  nginx -t && systemctl reload nginx
  echo "✓ secondary proxy 대상 사이트 없음"
  exit 0
fi

mkdir -p "$ACME_WEBROOT/.well-known/acme-challenge"

echo "--- secondary proxy HTTP 구성 (${#entries[@]}개) ---"
for entry in "${entries[@]}"; do
  IFS=$'\t' read -r slug domain upstream_host ssh_user key_path <<< "$entry"
  upstream_target="$(resolve_upstream_target "$upstream_host" "$ssh_user" "$key_path")"
  if [ -L "/etc/nginx/sites-enabled/$slug" ]; then
    rm -f "/etc/nginx/sites-enabled/$slug"
  fi
  write_proxy_config "$slug" "$domain" "$upstream_target" "http"
  echo "  + $domain -> $upstream_target"
done

nginx -t && systemctl reload nginx

if command -v certbot >/dev/null 2>&1; then
  if [ "${#domains[@]}" -le "$ALLMYREVIEW_CERT_MAX_NAMES" ]; then
    missing=()
    for domain in "${domains[@]}"; do
      if ! cert_covers_domain "$domain"; then
        missing+=("$domain")
      fi
    done

    if [ "${#missing[@]}" -gt 0 ]; then
      echo "--- primary SSL 확장 (${#missing[@]}개 신규) ---"
      printf '  + %s\n' "${missing[@]}"

      certbot_args=(
        certbot certonly
        --webroot
        -w "$ACME_WEBROOT"
        --non-interactive
        --cert-name "$ALLMYREVIEW_CERT_NAME"
      )

      if [ -n "$CERTBOT_EMAIL" ]; then
        certbot_args+=(--agree-tos --email "$CERTBOT_EMAIL")
      else
        certbot_args+=(--agree-tos --register-unsafely-without-email)
      fi

      if [ -f "$ALLMYREVIEW_CERT_DIR/fullchain.pem" ]; then
        certbot_args+=(--expand)
      fi

      for domain in "${domains[@]}"; do
        certbot_args+=(-d "$domain")
      done

      if "${certbot_args[@]}"; then
        echo "  ✓ primary SSL 확장 완료"
      else
        echo "  ⚠ primary SSL 확장 실패"
      fi
    else
      echo "  ✓ primary SSL 도메인 포함 상태 정상"
    fi
  else
    echo "  ⚠ secondary proxy 도메인이 ${#domains[@]}개로 많습니다. wildcard 인증서 전환이 필요합니다."
  fi
else
  echo "  ⚠ certbot이 없어 primary SSL 확장을 건너뜁니다."
fi

echo "--- secondary proxy HTTPS 구성 ---"
for entry in "${entries[@]}"; do
  IFS=$'\t' read -r slug domain upstream_host ssh_user key_path <<< "$entry"
  upstream_target="$(resolve_upstream_target "$upstream_host" "$ssh_user" "$key_path")"
  if cert_covers_domain "$domain"; then
    write_proxy_config "$slug" "$domain" "$upstream_target" "https"
    echo "  ✓ $domain HTTPS proxy"
  else
    write_proxy_config "$slug" "$domain" "$upstream_target" "http"
    echo "  ⚠ $domain HTTP proxy only"
  fi
done

nginx -t && systemctl reload nginx
echo "✓ secondary proxy sync complete"
