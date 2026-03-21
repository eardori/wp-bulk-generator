#!/bin/bash
# Sync reverse-proxy vhosts on the primary server for secondary-origin sites.

set -euo pipefail

CREDS_FILE="${CREDS_FILE:-/home/ubuntu/wp-bulk-generator/bridge-api/data/wp-sites-credentials.json}"
ALLMYREVIEW_CERT_NAME="${ALLMYREVIEW_CERT_NAME:-allmyreview-secondary-sites}"
ALLMYREVIEW_CERT_DIR="/etc/letsencrypt/live/$ALLMYREVIEW_CERT_NAME"
ALLMYREVIEW_CERT_MAX_NAMES="${ALLMYREVIEW_CERT_MAX_NAMES:-100}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
PROXY_PREFIX="secondary-proxy-"
ACME_WEBROOT="${ACME_WEBROOT:-/var/www/certbot}"
SCANNER_BLOCK_SNIPPET="${SCANNER_BLOCK_SNIPPET:-/etc/nginx/snippets/wp-bulk-scanner-blocks.conf}"

if [ ! -f "$CREDS_FILE" ]; then
  echo "⚠ credentials file missing: $CREDS_FILE"
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required"
  exit 1
fi

normalize_domain() {
  printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]'
}

primary_site_exists() {
  local slug="$1"
  [ -n "$slug" ] || return 1
  [ -f "/etc/nginx/sites-available/$slug" ] || [ -L "/etc/nginx/sites-enabled/$slug" ]
}

ensure_nginx_hash_settings() {
  local nginx_conf="/etc/nginx/nginx.conf"

  if [ ! -f "$nginx_conf" ]; then
    return 0
  fi

  perl -0pi -e '
    s/^\h*server_names_hash_max_size\h+\d+;\n?//mg;
    s/^\h*server_names_hash_bucket_size\h+\d+;\n?//mg;
    s/(^\h*types_hash_max_size\h+\d+;\n)/$1    server_names_hash_max_size 4096;\n    server_names_hash_bucket_size 128;\n/m;
  ' "$nginx_conf"
}

ensure_scanner_block_snippet() {
  mkdir -p "$(dirname "$SCANNER_BLOCK_SNIPPET")"
  cat > "$SCANNER_BLOCK_SNIPPET" <<'NGINX'
# Fast reject common scanner and fake app routes before they hit upstream WordPress.
location = /index.html { return 404; }
location = /sitemap.xml { return 404; }
location ~* ^/(?:\.env|config(?:\.|/|$)|storage/|backup/|secrets(?:\.json|\.txt)?$|credentials(?:\.json|\.txt)?$|server-info$|swagger\.json$|manifest\.json$|info\.php$|debug/default/view$|webhooks/settings\.json$|aws/credentials$|api/payment/config$|api/shared/config/|manage/env$|stripe(?:\.json|\.conf|\.rb|\.env|/)|wp-content/uploads/wc-logs/|checkout$|cart$|billing$|signup$|register$|subscribe$|payment$|donate$|plans$|pricing$|order$|account$|shop$|dashboard$|admin$) {
    access_log off;
    log_not_found off;
    return 444;
}
NGINX
}

cert_covers_domain() {
  local domain
  domain="$(normalize_domain "$1")"

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
ExecStart=/usr/bin/ssh -NT -L 127.0.0.1:${port}:127.0.0.1:443 -i ${key_path} -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes ${ssh_user}@${host}
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

ensure_allmyreview_certificate() {
  if ! command -v certbot >/dev/null 2>&1; then
    echo "  ⚠ certbot이 없어 primary SSL 확장을 건너뜁니다."
    return 0
  fi

  if [ "${#cert_domains[@]}" -eq 0 ]; then
    echo "  ⚠ allmyreview 도메인이 없어 primary SSL 확장을 건너뜁니다."
    return 0
  fi

  if [ "${#cert_domains[@]}" -gt "$ALLMYREVIEW_CERT_MAX_NAMES" ]; then
    echo "  ⚠ allmyreview 도메인이 ${#cert_domains[@]}개로 많습니다. wildcard 인증서 전환이 필요합니다."
    return 0
  fi

  missing=()
  for domain in "${cert_domains[@]}"; do
    if ! cert_covers_domain "$domain"; then
      missing+=("$domain")
    fi
  done

  if [ "${#missing[@]}" -eq 0 ]; then
    echo "  ✓ primary SSL 도메인 포함 상태 정상"
    return 0
  fi

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

  for domain in "${cert_domains[@]}"; do
    certbot_args+=(-d "$domain")
  done

  if "${certbot_args[@]}"; then
    echo "  ✓ primary SSL 확장 완료"
  else
    echo "  ⚠ primary SSL 확장 실패"
  fi
}

write_proxy_config() {
  local slug="$1"
  local domain
  domain="$(normalize_domain "$2")"
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
    include $SCANNER_BLOCK_SNIPPET;

    location / {
        proxy_pass https://$upstream_target;
        proxy_http_version 1.1;
        proxy_ssl_server_name on;
        proxy_ssl_name \$host;
        proxy_ssl_verify off;
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
    include $SCANNER_BLOCK_SNIPPET;

    location ^~ /.well-known/acme-challenge/ {
        root $ACME_WEBROOT;
        default_type "text/plain";
        try_files \$uri =404;
    }

    location / {
        proxy_pass https://$upstream_target;
        proxy_http_version 1.1;
        proxy_ssl_server_name on;
        proxy_ssl_name \$host;
        proxy_ssl_verify off;
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
declare -a cert_domains=()

while IFS=$'\t' read -r slug domain upstream_host ssh_user key_path; do
  [ -n "$slug" ] || continue
  [ -n "$domain" ] || continue
  [ -n "$upstream_host" ] || continue

  if primary_site_exists "$slug"; then
    echo "  - skip secondary proxy for $domain (local primary site exists)"
    continue
  fi

  entries+=("${slug}"$'\t'"${domain}"$'\t'"${upstream_host}"$'\t'"${ssh_user}"$'\t'"${key_path}")
done < <(
  jq -r '
    .[]?
    | select((.server_id // "") != "" and (.server_id != "primary"))
    | select(.slug and .domain and .server_host)
    | [.slug, (.domain | ascii_downcase), .server_host, (.server_user // ""), (.server_key_path // "")] | @tsv
  ' "$CREDS_FILE"
)

for entry in "${entries[@]}"; do
  IFS=$'\t' read -r _slug domain _upstream_host _ssh_user _key_path <<< "$entry"
  if [ -n "$domain" ] && [[ "$domain" == *.allmyreview.site ]]; then
    cert_domains+=("$domain")
  fi
done

if [ "${#cert_domains[@]}" -gt 0 ]; then
  mapfile -t cert_domains < <(printf '%s\n' "${cert_domains[@]}" | sort -u)
fi

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
  ensure_nginx_hash_settings
  ensure_scanner_block_snippet
  nginx -t && systemctl reload nginx
  ensure_allmyreview_certificate
  echo "✓ secondary proxy 대상 사이트 없음"
  exit 0
fi

mkdir -p "$ACME_WEBROOT/.well-known/acme-challenge"
ensure_scanner_block_snippet

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

ensure_nginx_hash_settings
nginx -t && systemctl reload nginx

ensure_allmyreview_certificate

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
