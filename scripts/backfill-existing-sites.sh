#!/bin/bash
# Repair and normalize SEO/runtime settings for existing WordPress sites.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_FILE_OWNER="${APP_FILE_OWNER:-$(stat -c '%U:%G' "$REPO_ROOT" 2>/dev/null || echo root:root)}"

CREDS_FILE="/root/wp-sites-credentials.json"
APP_CACHE_DIR="${APP_CACHE_DIR:-$REPO_ROOT/admin/.cache}"
APP_CREDS_FILE="$APP_CACHE_DIR/sites-credentials.json"
SERVER_ROLE_FILE="${SERVER_ROLE_FILE:-/etc/wp-bulk-server-role}"
SERVER_ROLE="${WP_BULK_SERVER_ROLE:-}"
if [ -z "$SERVER_ROLE" ] && [ -f "$SERVER_ROLE_FILE" ]; then
  SERVER_ROLE="$(tr -d '\r\n' < "$SERVER_ROLE_FILE")"
fi
case "$SERVER_ROLE" in
  primary)
    DEFAULT_ALLMYREVIEW_CERT_NAME="allmyreview-primary-sites"
    ;;
  secondary)
    DEFAULT_ALLMYREVIEW_CERT_NAME="allmyreview-secondary-sites"
    ;;
  *)
    DEFAULT_ALLMYREVIEW_CERT_NAME="allmyreview-sites"
    ;;
esac
ALLMYREVIEW_CERT_NAME="${ALLMYREVIEW_CERT_NAME:-$DEFAULT_ALLMYREVIEW_CERT_NAME}"
ALLMYREVIEW_CERT_DIR="/etc/letsencrypt/live/$ALLMYREVIEW_CERT_NAME"
ALLMYREVIEW_CERT_MAX_NAMES="${ALLMYREVIEW_CERT_MAX_NAMES:-100}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
WP_CRON_RUNNER_PATH="/usr/local/bin/wp-bulk-run-cron.sh"
WP_CRON_SCHEDULE_PATH="/etc/cron.d/wp-bulk-run-cron"
WP_CLI_TIMEOUT="${WP_CLI_TIMEOUT:-20}"
WP_LIGHT_MODE="${WP_LIGHT_MODE:-1}"
REMOTE_VALIDATE_TIMEOUT="${REMOTE_VALIDATE_TIMEOUT:-12}"
TARGET_SLUGS_RAW=""
INDEXNOW_KEY_FILE="${INDEXNOW_KEY_FILE:-/root/.wp-bulk-indexnow-key}"
SCANNER_BLOCK_SNIPPET="${SCANNER_BLOCK_SNIPPET:-/etc/nginx/snippets/wp-bulk-scanner-blocks.conf}"

if [ -z "${BING_SITE_VERIFICATION:-}" ]; then
  echo "⚠ BING_SITE_VERIFICATION is not set; Bing ownership meta tag will not be injected during backfill."
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --slugs)
      TARGET_SLUGS_RAW="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

if [ -f /root/.wp-bulk-credentials ]; then
  # shellcheck disable=SC1091
  source /root/.wp-bulk-credentials
fi

declare -A TARGET_SLUGS=()
if [ -n "$TARGET_SLUGS_RAW" ]; then
  IFS=',' read -r -a __slug_array <<< "$TARGET_SLUGS_RAW"
  for __slug in "${__slug_array[@]}"; do
    __slug="$(echo "$__slug" | xargs)"
    if [ -n "$__slug" ]; then
      TARGET_SLUGS["$__slug"]=1
    fi
  done
fi

if [ ! -f "$CREDS_FILE" ]; then
  echo "Error: $CREDS_FILE 파일을 찾을 수 없습니다."
  exit 1
fi

mkdir -p "$APP_CACHE_DIR"

sync_cache() {
  cp "$CREDS_FILE" "$APP_CREDS_FILE" 2>/dev/null || true
  chown "$APP_FILE_OWNER" "$APP_CREDS_FILE" 2>/dev/null || true
}

purge_fastcgi_cache() {
  if [ -d /tmp/nginx-cache ]; then
    find /tmp/nginx-cache -mindepth 1 -delete 2>/dev/null || true
  fi
}

ensure_scanner_block_snippet() {
  mkdir -p "$(dirname "$SCANNER_BLOCK_SNIPPET")"
  cat > "$SCANNER_BLOCK_SNIPPET" <<'NGINX'
# Fast reject common scanner and fake app routes before they hit PHP.
location = /index.html { return 404; }
location = /sitemap.xml { return 404; }
location ~* ^/(?:\.env|config(?:\.|/|$)|storage/|backup/|secrets(?:\.json|\.txt)?$|credentials(?:\.json|\.txt)?$|server-info$|swagger\.json$|manifest\.json$|info\.php$|debug/default/view$|webhooks/settings\.json$|aws/credentials$|api/payment/config$|api/shared/config/|manage/env$|stripe(?:\.json|\.conf|\.rb|\.env|/)|wp-content/uploads/wc-logs/|checkout$|cart$|billing$|signup$|register$|subscribe$|payment$|donate$|plans$|pricing$|order$|account$|shop$|dashboard$|admin$) {
    access_log off;
    log_not_found off;
    return 444;
}
NGINX
}

wp_try() {
  timeout "$WP_CLI_TIMEOUT" wp "$@"
}

normalize_domain() {
  printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]'
}

build_home_description() {
  python3 - "$1" "$2" <<'PY'
import re
import sys

title = re.sub(r"\s+", " ", (sys.argv[1] or "")).strip()
tagline = re.sub(r"\s+", " ", (sys.argv[2] or "")).strip()
source = f"{title} {tagline}"
is_ko = any('\uac00' <= ch <= '\ud7a3' for ch in source)

if is_ko:
    extra = "방문 팁, 메뉴 정보, 최신 게시글을 한곳에서 확인하세요."
    fallback = "핵심 정보와 정리된 가이드를 빠르게 확인할 수 있습니다."
    base = tagline or "실용적인 방문 가이드와 추천 정보를 제공하는 사이트입니다."
    for phrase in (extra, fallback):
        base = re.sub(re.escape(phrase), "", base).strip(" .!")
    base = re.sub(r"실용적인 방문 팁과 메뉴 정보, 최신[^.]*\.?", "", base).strip(" .!")
    base = re.sub(r"방문 팁, 메뉴 정보, 최신[^.]*\.?", "", base).strip(" .!")
    base = re.sub(r"믿을 수 있는 핵심 정보와 정리된 가이드[^.]*\.?", "", base).strip(" .!")
    base = re.sub(r"핵심 정보와 정리된 가이드[^.]*\.?", "", base).strip(" .!")
    if title:
        base = re.sub(rf"^{re.escape(title)}[.! ]*", "", base, flags=re.I).strip()
    base = re.sub(r"\s*[.!?]+\s*", ". ", base).strip(" .!")
    if title and title not in base:
        desc = f"{title}. {base}"
    else:
        desc = base
    desc = desc.rstrip(".! ")
    if extra not in desc:
        desc += f". {extra}"
else:
    extra = "Find practical tips, menu details, and recent posts in one place."
    fallback = "Get concise guides and trustworthy highlights without extra noise."
    base = tagline or "Practical guides, recommendations, and local tips."
    for phrase in (extra, fallback):
        base = re.sub(re.escape(phrase), "", base, flags=re.I).strip(" .!")
    base = re.sub(r"Explore practical recommendations[^.]*\.?", "", base, flags=re.I).strip(" .!")
    base = re.sub(r"Find practical tips, menu details, and recent posts[^.]*\.?", "", base, flags=re.I).strip(" .!")
    base = re.sub(r"Find trustworthy highlights[^.]*\.?", "", base, flags=re.I).strip(" .!")
    base = re.sub(r"Get concise guides and trustworthy highlights[^.]*\.?", "", base, flags=re.I).strip(" .!")
    if title:
        base = re.sub(rf"^{re.escape(title)}[.! ]*", "", base, flags=re.I).strip()
    base = re.sub(r"\s*[.!?]+\s*", ". ", base).strip(" .!")
    if title and title.lower() not in base.lower():
        desc = f"{title}. {base}"
    else:
        desc = base
    desc = desc.rstrip(".! ")
    if extra.lower() not in desc.lower():
        desc += f". {extra}"

desc = re.sub(r"\s+", " ", desc).strip()
if len(desc) < 70:
    tail = f" {fallback}"
    if fallback.lower() not in desc.lower():
        desc = (desc + tail).strip()
if len(desc) > 150:
    desc = desc[:147].rsplit(" ", 1)[0].rstrip(" .,!?:;") + "..."
print(desc)
PY
}

slug_selected() {
  local slug="$1"
  if [ "${#TARGET_SLUGS[@]}" -eq 0 ]; then
    return 0
  fi

  [[ -n "${TARGET_SLUGS[$slug]:-}" ]]
}

site_url_for_domain() {
  local domain
  domain="$(normalize_domain "$1")"
  if [[ "$domain" == *.allmyreview.site ]]; then
    printf 'https://%s' "$domain"
  else
    printf 'http://%s' "$domain"
  fi
}

read_wp_config_value() {
  local site_dir="$1"
  local key="$2"
  local wp_config="$site_dir/wp-config.php"

  [ -f "$wp_config" ] || return 1

  php -r '
    $path = $argv[1];
    $key = $argv[2];
    $text = @file_get_contents($path);
    if ($text === false) {
      exit(1);
    }
    $pattern = "/define\\(\\s*[\"\\x27]" . preg_quote($key, "/") . "[\"\\x27]\\s*,\\s*[\"\\x27]([^\"\\x27]+)[\"\\x27]\\s*\\)/";
    if (preg_match($pattern, $text, $matches)) {
      echo $matches[1];
    }
  ' "$wp_config" "$key" 2>/dev/null || true
}

ensure_site_database_access() {
  local slug="$1"
  local site_dir="$2"
  local cred_db_name="$3"
  local cred_db_user="$4"
  local cred_db_pass="$5"

  if [ -z "${DB_ROOT_PASS:-}" ]; then
    echo "  ⚠ DB_ROOT_PASS 없음 — DB 권한 복구는 건너뜀"
    return 0
  fi

  local config_db_name config_db_user config_db_pass db_name db_user db_pass
  config_db_name="$(read_wp_config_value "$site_dir" "DB_NAME")"
  config_db_user="$(read_wp_config_value "$site_dir" "DB_USER")"
  config_db_pass="$(read_wp_config_value "$site_dir" "DB_PASSWORD")"

  db_name="${config_db_name:-$cred_db_name}"
  db_user="${config_db_user:-$cred_db_user}"
  db_pass="${config_db_pass:-$cred_db_pass}"

  if [ -z "$db_name" ] || [ -z "$db_user" ] || [ -z "$db_pass" ] || [ "$db_pass" = "(existing)" ]; then
    echo "  ⚠ DB 정보 부족 — DB 권한 복구는 건너뜀"
    return 0
  fi

  mysql -u root -p"$DB_ROOT_PASS" <<SQL >/dev/null 2>&1 || {
CREATE DATABASE IF NOT EXISTS \`$db_name\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$db_user'@'localhost' IDENTIFIED BY '$db_pass';
ALTER USER '$db_user'@'localhost' IDENTIFIED BY '$db_pass';
GRANT ALL PRIVILEGES ON \`$db_name\`.* TO '$db_user'@'localhost';
FLUSH PRIVILEGES;
SQL
    echo "  ⚠ DB 권한 복구 실패"
    return 1
  }

  return 0
}

validate_local_wordpress_runtime() {
  local site_dir="$1"
  local expected_url="$2"

  wp_try core is-installed --path="$site_dir" --allow-root >/dev/null 2>&1 || return 1
  wp_try option get home --path="$site_dir" --allow-root >/dev/null 2>&1 || return 1
  wp_try option get siteurl --path="$site_dir" --allow-root >/dev/null 2>&1 || return 1

  if [ -n "$expected_url" ]; then
    local home_url
    home_url="$(wp_try option get home --path="$site_dir" --allow-root 2>/dev/null || true)"
    if [ -n "$home_url" ] && [ "$home_url" != "$expected_url" ]; then
      wp_try option update home "$expected_url" --path="$site_dir" --allow-root --quiet >/dev/null 2>&1 || true
      wp_try option update siteurl "$expected_url" --path="$site_dir" --allow-root --quiet >/dev/null 2>&1 || true
    fi
  fi

  return 0
}

validate_remote_wordpress() {
  local domain="$1"
  local url
  url="$(site_url_for_domain "$domain")"

  local body
  body="$(curl -fsS --connect-timeout 4 --max-time "$REMOTE_VALIDATE_TIMEOUT" \
    -H "Accept: application/json" \
    "$url/wp-json/" 2>/dev/null || true)"

  [[ "$body" == *"namespaces"* ]]
}

ensure_application_password() {
  local slug="$1"
  local site_dir="$2"
  local existing_app_pass="$3"

  if [ -n "$existing_app_pass" ] && [ "$existing_app_pass" != "N/A" ] && [ "$existing_app_pass" != "null" ]; then
    return 0
  fi

  local app_pass
  app_pass="$(wp user application-password create 1 "auto-posting-$(date +%s)" \
    --porcelain --path="$site_dir" --allow-root 2>/dev/null || true)"

  if [ -z "$app_pass" ]; then
    echo "  ⚠ 앱 비밀번호 재생성 실패"
    return 1
  fi

  jq \
    --arg slug "$slug" \
    --arg app_pass "$app_pass" \
    'map(if .slug == $slug then .app_pass = $app_pass else . end)' \
    "$CREDS_FILE" > "${CREDS_FILE}.tmp" && mv "${CREDS_FILE}.tmp" "$CREDS_FILE"

  return 0
}

cert_covers_domain() {
  local domain="$1"

  [[ -f "$ALLMYREVIEW_CERT_DIR/fullchain.pem" ]] || return 1
  openssl x509 -in "$ALLMYREVIEW_CERT_DIR/fullchain.pem" -noout -text 2>/dev/null | grep -Fq "DNS:$domain"
}

collect_allmyreview_domains() {
  python3 - <<'PY'
from pathlib import Path
import subprocess

domains = set()
root = Path("/var/www")
if root.exists():
    for site_dir in root.iterdir():
        if not site_dir.is_dir() or not (site_dir / "wp-config.php").exists():
            continue
        try:
            home = subprocess.check_output(
                ["wp", "option", "get", "home", f"--path={site_dir}", "--allow-root"],
                stderr=subprocess.DEVNULL,
                text=True,
                timeout=8,
            ).strip().lower()
        except Exception:
            continue

        if home.startswith("https://"):
            home = home[len("https://"):]
        elif home.startswith("http://"):
            home = home[len("http://"):]
        domain = home.split("/", 1)[0]
        if domain.endswith(".allmyreview.site"):
            domains.add(domain)

for domain in sorted(domains):
    print(domain)
PY
}

ensure_allmyreview_certificate() {
  if ! command -v certbot >/dev/null 2>&1; then
    echo "  ⚠ certbot이 없어 SSL 인증서를 갱신하지 못했습니다."
    return 0
  fi

  mapfile -t domains < <(collect_allmyreview_domains)
  if [ "${#domains[@]}" -eq 0 ]; then
    return 0
  fi

  if [ "${#domains[@]}" -gt "$ALLMYREVIEW_CERT_MAX_NAMES" ]; then
    echo "  ⚠ SSL 인증서 SAN 도메인이 ${#domains[@]}개입니다. wildcard 인증서 전환이 필요합니다."
    return 0
  fi

  local missing=()
  local domain
  for domain in "${domains[@]}"; do
    if ! cert_covers_domain "$domain"; then
      missing+=("$domain")
    fi
  done

  if [ "${#missing[@]}" -eq 0 ]; then
    echo "  ✓ SSL 인증서 도메인 포함 상태 정상"
    return 0
  fi

  echo "--- SSL 인증서 확장 (${#missing[@]}개 신규) ---"
  printf '  + %s\n' "${missing[@]}"

  local certbot_args=(
    certbot certonly
    --nginx
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
    nginx -t && systemctl reload nginx
    echo "  ✓ SSL 인증서 갱신 완료"
  else
    echo "  ⚠ SSL 인증서 갱신 실패"
  fi
}

ensure_system_cron_runner() {
  cat > "$WP_CRON_RUNNER_PATH" <<'CRONRUN'
#!/bin/bash
set -euo pipefail

for site_dir in /var/www/*; do
  [ -d "$site_dir" ] || continue
  [ -f "$site_dir/wp-config.php" ] || continue
  timeout 15 wp cron event run --due-now --path="$site_dir" --allow-root >/dev/null 2>&1 || true
done
CRONRUN

  chmod 755 "$WP_CRON_RUNNER_PATH"

  cat > "$WP_CRON_SCHEDULE_PATH" <<CRONSCHED
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

*/5 * * * * root $WP_CRON_RUNNER_PATH >/var/log/wp-bulk-run-cron.log 2>&1
CRONSCHED

  chmod 644 "$WP_CRON_SCHEDULE_PATH"
}

write_robots_txt() {
  local domain="$1"
  local site_dir="$2"
  local site_url
  site_url="$(site_url_for_domain "$domain")"

  cat > "$site_dir/robots.txt" <<ROBOTS
User-agent: *
Allow: /

User-agent: Bingbot
Allow: /

User-agent: msnbot
Allow: /

User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Anthropic-ai
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: Amazonbot
Allow: /

User-agent: FacebookBot
Allow: /

User-agent: cohere-ai
Allow: /

Sitemap: ${site_url}/sitemap_index.xml
ROBOTS
}

write_llms_txt() {
  local domain="$1"
  local site_dir="$2"
  local site_title="$3"
  local tagline="$4"
  local persona_name="$5"
  local categories="$6"
  local site_url
  site_url="$(site_url_for_domain "$domain")"

  cat > "$site_dir/llms.txt" << LLMS
# ${site_title}
> ${tagline}

## About
- Author: ${persona_name}
- Site: ${site_url}
- Content: Product reviews and buying guides in Korean

## Categories
$(echo "$categories" | tr ',' '\n' | sed 's/^ */- /')

## Navigation
- [Homepage](${site_url}): Latest reviews and recommendations
- [Sitemap](${site_url}/sitemap_index.xml): All published articles
LLMS
  chown www-data:www-data "$site_dir/llms.txt"
}

ensure_indexnow_key() {
  if [ -n "${INDEXNOW_KEY:-}" ]; then
    return 0
  fi

  if [ -f "$INDEXNOW_KEY_FILE" ]; then
    INDEXNOW_KEY="$(tr -d '\r\n' < "$INDEXNOW_KEY_FILE")"
    [ -n "$INDEXNOW_KEY" ] && return 0
  fi

  INDEXNOW_KEY="$(openssl rand -hex 16)"
  printf '%s' "$INDEXNOW_KEY" > "$INDEXNOW_KEY_FILE"
  chmod 600 "$INDEXNOW_KEY_FILE" 2>/dev/null || true
}

indexnow_key_url_for_domain() {
  local domain="$1"
  if [ -n "${INDEXNOW_KEY_LOCATION:-}" ]; then
    printf '%s' "$INDEXNOW_KEY_LOCATION"
  else
    printf '%s/%s.txt' "$(site_url_for_domain "$domain")" "$INDEXNOW_KEY"
  fi
}

write_indexnow_key_file() {
  local domain="$1"
  local site_dir="$2"

  ensure_indexnow_key
  [ -n "${INDEXNOW_KEY:-}" ] || return 0

  printf '%s' "$INDEXNOW_KEY" > "$site_dir/${INDEXNOW_KEY}.txt"
  chown www-data:www-data "$site_dir/${INDEXNOW_KEY}.txt" 2>/dev/null || true
}

ensure_seo_site_options() {
  local domain="$1"
  local site_dir="$2"
  local indexnow_url=""

  ensure_indexnow_key
  write_indexnow_key_file "$domain" "$site_dir"

  if [ -n "${INDEXNOW_KEY:-}" ]; then
    indexnow_url="$(indexnow_key_url_for_domain "$domain")"
    wp_try option update ai_indexnow_key "$INDEXNOW_KEY" --path="$site_dir" --allow-root --quiet 2>/dev/null || true
    wp_try option update ai_indexnow_key_url "$indexnow_url" --path="$site_dir" --allow-root --quiet 2>/dev/null || true
  else
    wp_try option delete ai_indexnow_key --path="$site_dir" --allow-root --quiet 2>/dev/null || true
    wp_try option delete ai_indexnow_key_url --path="$site_dir" --allow-root --quiet 2>/dev/null || true
  fi

  if [ -n "${GOOGLE_SITE_VERIFICATION:-}" ]; then
    wp_try option update ai_google_site_verification "$GOOGLE_SITE_VERIFICATION" --path="$site_dir" --allow-root --quiet 2>/dev/null || true
  else
    wp_try option delete ai_google_site_verification --path="$site_dir" --allow-root --quiet 2>/dev/null || true
  fi

  if [ -n "${BING_SITE_VERIFICATION:-}" ]; then
    wp_try option update ai_bing_site_verification "$BING_SITE_VERIFICATION" --path="$site_dir" --allow-root --quiet 2>/dev/null || true
  else
    wp_try option delete ai_bing_site_verification --path="$site_dir" --allow-root --quiet 2>/dev/null || true
  fi
}

write_nginx_config() {
  local slug="$1"
  local domain="$2"
  local site_dir="$3"
  local nginx_path="/etc/nginx/sites-available/$slug"

  if [[ "$domain" == *.allmyreview.site ]] \
    && [[ -f "$ALLMYREVIEW_CERT_DIR/fullchain.pem" ]] \
    && [[ -f "$ALLMYREVIEW_CERT_DIR/privkey.pem" ]]; then
    cat > "$nginx_path" <<NGINX
server {
    listen 80;
    server_name $domain;

    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $domain;
    root $site_dir;
    index index.php index.html;

    ssl_certificate $ALLMYREVIEW_CERT_DIR/fullchain.pem;
    ssl_certificate_key $ALLMYREVIEW_CERT_DIR/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    set \$skip_cache 0;
    if (\$request_method = POST) { set \$skip_cache 1; }
    if (\$request_uri ~* "/wp-admin/|/xmlrpc.php|wp-.*.php|/feed/|index.php|sitemap(_index)?.xml") {
        set \$skip_cache 1;
    }
    if (\$http_cookie ~* "comment_author|wordpress_[a-f0-9]+|wp-postpass|wordpress_no_cache|wordpress_logged_in") {
        set \$skip_cache 1;
    }

    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;
    add_header Referrer-Policy "strict-origin-when-cross-origin";
    include $SCANNER_BLOCK_SNIPPET;

    if (\$args ~ "(^|&)p=") { set \$skip_cache 1; }
    if (\$args ~ "(^|&)p=") { set \$invalid_post_query 1; }
    if (\$arg_p ~ "^[0-9]+\$") { set \$invalid_post_query 0; }
    if (\$invalid_post_query = 1) { return 301 https://\$host\$uri; }

    location / {
        try_files \$uri \$uri/ /index.php?\$args;
    }

    location ~ \\.php\$ {
        include fastcgi_params;
        fastcgi_pass unix:/run/php/php8.2-fpm.sock;
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
        fastcgi_param HTTPS on;
        fastcgi_param SERVER_PORT 443;
        fastcgi_connect_timeout 30s;
        fastcgi_send_timeout 120s;
        fastcgi_read_timeout 120s;

        fastcgi_cache WPCACHE;
        fastcgi_cache_valid 200 10d;
        fastcgi_cache_valid 404 1m;
        fastcgi_cache_lock on;
        fastcgi_cache_use_stale error timeout invalid_header updating http_500 http_503;
        fastcgi_cache_bypass \$skip_cache;
        fastcgi_no_cache \$skip_cache;
        add_header X-Cache \$upstream_cache_status;
    }

    location = /robots.txt {
        access_log off;
        log_not_found off;
    }

    location = /llms.txt {
        access_log off;
        log_not_found off;
        default_type text/plain;
    }

    location ~ /sitemap.*\\.xml\$ {
        try_files \$uri /index.php?\$args;
        expires 5m;
        add_header Cache-Control "public";
    }

    location ~* \\.(aspx|asp|ashx|axd|bak|old|orig|save|sql|ini|log|sh|pem|yml|yaml|dist)\$ {
        return 404;
    }

    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2|woff|ttf|eot)\$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    location ~ /\\. { deny all; }
    location ~* /wp-config.php { deny all; }
    location ~* /readme.html { deny all; }
    location ~* /license.txt { deny all; }
}
NGINX
  else
    cat > "$nginx_path" <<NGINX
server {
    listen 80;
    server_name $domain;
    root $site_dir;
    index index.php index.html;

    set \$skip_cache 0;
    if (\$request_method = POST) { set \$skip_cache 1; }
    if (\$request_uri ~* "/wp-admin/|/xmlrpc.php|wp-.*.php|/feed/|index.php|sitemap(_index)?.xml") {
        set \$skip_cache 1;
    }
    if (\$http_cookie ~* "comment_author|wordpress_[a-f0-9]+|wp-postpass|wordpress_no_cache|wordpress_logged_in") {
        set \$skip_cache 1;
    }

    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;
    add_header Referrer-Policy "strict-origin-when-cross-origin";
    include $SCANNER_BLOCK_SNIPPET;

    if (\$args ~ "(^|&)p=") { set \$skip_cache 1; }
    if (\$args ~ "(^|&)p=") { set \$invalid_post_query 1; }
    if (\$arg_p ~ "^[0-9]+\$") { set \$invalid_post_query 0; }
    if (\$invalid_post_query = 1) { return 301 https://\$host\$uri; }

    location / {
        try_files \$uri \$uri/ /index.php?\$args;
    }

    location ~ \\.php\$ {
        include fastcgi_params;
        fastcgi_pass unix:/run/php/php8.2-fpm.sock;
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
        fastcgi_connect_timeout 30s;
        fastcgi_send_timeout 120s;
        fastcgi_read_timeout 120s;

        fastcgi_cache WPCACHE;
        fastcgi_cache_valid 200 10d;
        fastcgi_cache_valid 404 1m;
        fastcgi_cache_lock on;
        fastcgi_cache_use_stale error timeout invalid_header updating http_500 http_503;
        fastcgi_cache_bypass \$skip_cache;
        fastcgi_no_cache \$skip_cache;
        add_header X-Cache \$upstream_cache_status;
    }

    location = /robots.txt {
        access_log off;
        log_not_found off;
    }

    location = /llms.txt {
        access_log off;
        log_not_found off;
        default_type text/plain;
    }

    location ~ /sitemap.*\\.xml\$ {
        try_files \$uri /index.php?\$args;
        expires 5m;
        add_header Cache-Control "public";
    }

    location ~* \\.(aspx|asp|ashx|axd|bak|old|orig|save|sql|ini|log|sh|pem|yml|yaml|dist)\$ {
        return 404;
    }

    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2|woff|ttf|eot)\$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    location ~ /\\. { deny all; }
    location ~* /wp-config.php { deny all; }
    location ~* /readme.html { deny all; }
    location ~* /license.txt { deny all; }
}
NGINX
  fi

  ln -sf "$nginx_path" "/etc/nginx/sites-enabled/$slug"
}

ensure_wordpress_runtime_config() {
  local site_dir="$1"
  local wp_config="$site_dir/wp-config.php"

  if [ "$WP_LIGHT_MODE" = "1" ]; then
    if ! grep -q "DISABLE_WP_CRON" "$wp_config" 2>/dev/null; then
      sed -i "/require_once ABSPATH . 'wp-settings.php';/i define( 'DISABLE_WP_CRON', true );" "$wp_config"
    fi
    return 0
  fi

  wp_try config set DISABLE_WP_CRON true --raw --type=constant --path="$site_dir" --allow-root --quiet 2>/dev/null || true

  if [ -f "$wp_config" ] && ! grep -q "HTTP_X_FORWARDED_PROTO" "$wp_config" 2>/dev/null; then
    sed -i "/require_once ABSPATH . 'wp-settings.php';/i if (isset(\$_SERVER['HTTP_X_FORWARDED_PROTO']) \\&\\& strpos(\$_SERVER['HTTP_X_FORWARDED_PROTO'], 'https') !== false) { \$_SERVER['HTTPS'] = 'on'; }\nif (isset(\$_SERVER['HTTP_X_FORWARDED_HOST']) \\&\\& \$_SERVER['HTTP_X_FORWARDED_HOST'] !== '') { \$_SERVER['HTTP_HOST'] = \$_SERVER['HTTP_X_FORWARDED_HOST']; }" "$wp_config"
  fi
}

ensure_plugin_active() {
  local site_dir="$1"
  local plugin="$2"

  if [ "$WP_LIGHT_MODE" = "1" ]; then
    return 0
  fi

  if ! wp_try plugin is-installed "$plugin" --path="$site_dir" --allow-root >/dev/null 2>&1; then
    echo "  ⚠ $plugin 미설치 또는 확인 타임아웃 — 건너뜀"
    return 0
  fi

  wp_try plugin activate "$plugin" --path="$site_dir" --allow-root --quiet 2>/dev/null || true
}

ensure_site_plugins() {
  local site_dir="$1"

  if [ "$WP_LIGHT_MODE" = "1" ]; then
    return 0
  fi

  ensure_plugin_active "$site_dir" "wordpress-seo"
  ensure_plugin_active "$site_dir" "redis-cache"
  ensure_plugin_active "$site_dir" "wp-fastest-cache"

  wp_try redis enable --path="$site_dir" --allow-root --quiet 2>/dev/null || true
}

ensure_enable_app_passwords_mu_plugin() {
  local site_dir="$1"
  local mu_dir="$site_dir/wp-content/mu-plugins"

  mkdir -p "$mu_dir"
  cat > "$mu_dir/enable-app-passwords.php" <<'PHP'
<?php
/**
 * Force-enable Application Passwords over HTTP (no HTTPS required).
 */
add_filter('wp_is_application_passwords_available', '__return_true');
add_filter('wp_is_application_passwords_available_for_user', '__return_true');
PHP
}

ensure_seo_mu_plugin() {
  local site_dir="$1"
  local mu_dir="$site_dir/wp-content/mu-plugins"

  mkdir -p "$mu_dir"
  cat > "$mu_dir/ai-seo-optimize.php" <<'SEOPHP'
<?php
/**
 * AI SEO optimization MU-plugin.
 */

add_action('wp', function() {
    if (class_exists('WPSEO_Frontend')) {
        remove_action('wp_head', 'rel_canonical');
    }
}, 1);

add_action('wp_head', function() {
    if (class_exists('WPSEO_Frontend')) {
        remove_action('wp_head', 'rel_canonical');
    }
}, 0);

add_filter('wpseo_canonical', '__return_false', PHP_INT_MAX);

function ai_get_home_document_title() {
    $title = trim((string) get_bloginfo('name'));
    if ($title === '') {
        $title = trim((string) wp_parse_url(home_url('/'), PHP_URL_HOST));
    }

    if (function_exists('mb_substr')) {
        return mb_substr($title, 0, 60);
    }

    return substr($title, 0, 60);
}

function ai_trim_text_for_head($text, $limit) {
    $value = trim(preg_replace('/\s+/u', ' ', wp_strip_all_tags((string) $text)));
    if ($value === '') {
        return '';
    }

    if (function_exists('mb_strlen') && function_exists('mb_substr')) {
        if (mb_strlen($value) <= $limit) {
            return $value;
        }

        $trimmed = mb_substr($value, 0, $limit);
        $trimmed = preg_replace('/\s+\S*$/u', '', $trimmed) ?: $trimmed;
        return trim($trimmed);
    }

    if (strlen($value) <= $limit) {
        return $value;
    }

    $trimmed = substr($value, 0, $limit);
    $trimmed = preg_replace('/\s+\S*$/', '', $trimmed) ?: $trimmed;
    return trim($trimmed);
}

function ai_get_singular_document_title() {
    if (!is_singular('post')) {
        return '';
    }

    $title = trim((string) get_post_meta(get_the_ID(), '_yoast_wpseo_title', true));
    if ($title === '') {
        $title = trim((string) get_the_title());
    }

    return ai_trim_text_for_head($title, 60);
}

function ai_get_document_title_for_current_request() {
    if (is_front_page() || is_home()) {
        return ai_get_home_document_title();
    }

    if (is_singular('post')) {
        return ai_get_singular_document_title();
    }

    return '';
}

function ai_get_singular_meta_description() {
    if (!is_singular('post')) {
        return '';
    }

    $description = trim((string) get_post_meta(get_the_ID(), '_yoast_wpseo_metadesc', true));
    if ($description === '') {
        $description = trim((string) get_the_excerpt());
    }
    if ($description === '') {
        $description = wp_trim_words(wp_strip_all_tags((string) get_post_field('post_content', get_the_ID())), 32, '...');
    }

    return ai_trim_text_for_head($description, 155);
}

add_filter('pre_get_document_title', function($title) {
    $normalized = ai_get_document_title_for_current_request();
    if ($normalized !== '') {
        return $normalized;
    }

    return $title;
}, PHP_INT_MAX);

add_filter('document_title_parts', function($parts) {
    $normalized = ai_get_document_title_for_current_request();
    if ($normalized !== '') {
        return ['title' => $normalized];
    }
    
    return $parts;
}, PHP_INT_MAX);

function ai_get_canonical_url() {
    if (is_front_page() || is_home()) {
        return home_url('/');
    }

    if (is_singular()) {
        $canonical = function_exists('wp_get_canonical_url') ? wp_get_canonical_url() : '';
        if (!$canonical) {
            $canonical = get_permalink();
        }
        return $canonical ? esc_url_raw($canonical) : '';
    }

    if (is_search()) {
        return '';
    }

    $host = $_SERVER['HTTP_HOST'] ?? (string) wp_parse_url(home_url('/'), PHP_URL_HOST);
    $request_uri = $_SERVER['REQUEST_URI'] ?? '/';
    $request_path = strtok($request_uri, '?') ?: '/';
    if ($host === '') {
        return '';
    }

    $scheme = is_ssl() ? 'https' : 'http';
    return esc_url_raw($scheme . '://' . $host . $request_path);
}

function ai_get_requested_post_slug() {
    $request_uri = $_SERVER['REQUEST_URI'] ?? '/';
    $request_path = trim((string) parse_url($request_uri, PHP_URL_PATH), '/');
    if ($request_path === '' || str_contains($request_path, '/') || str_contains($request_path, '.')) {
        return '';
    }

    return sanitize_title($request_path);
}

function ai_maybe_redirect_invalid_post_query() {
    if (is_admin() || wp_doing_ajax() || is_feed()) {
        return;
    }

    if (defined('REST_REQUEST') && REST_REQUEST) {
        return;
    }

    if (!array_key_exists('p', $_GET)) {
        return;
    }

    $raw = $_GET['p'];
    if (is_array($raw)) {
        $raw = '';
    }

    $raw = trim((string) wp_unslash($raw));
    if ($raw !== '' && preg_match('/^[0-9]+$/', $raw)) {
        return;
    }

    $target_url = remove_query_arg('p');
    if (!is_string($target_url) || $target_url === '') {
        $target_url = home_url('/');
    }

    wp_safe_redirect($target_url, 301, 'AI SEO MU Plugin');
    exit;
}

function ai_get_duplicate_redirect_map() {
    static $map = null;
    if (is_array($map)) {
        return $map;
    }

    $map = [];
    $raw = get_option('ai_duplicate_redirect_map', '');
    if (!is_string($raw) || trim($raw) === '') {
        return $map;
    }

    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        return $map;
    }

    foreach ($decoded as $from_slug => $target) {
        $from_slug = sanitize_title((string) $from_slug);
        if ($from_slug === '') {
            continue;
        }

        $target_url = '';
        if (is_string($target) && preg_match('#^https?://#i', $target)) {
            $target_url = esc_url_raw($target);
        } else {
            $target_slug = sanitize_title((string) $target);
            if ($target_slug === '') {
                continue;
            }

            $post = get_page_by_path($target_slug, OBJECT, 'post');
            if (!($post instanceof WP_Post) || $post->post_status !== 'publish') {
                continue;
            }

            $target_url = get_permalink($post);
        }

        if ($target_url !== '') {
            $map[$from_slug] = esc_url_raw($target_url);
        }
    }

    return $map;
}

function ai_maybe_redirect_mapped_duplicate_slug() {
    if (is_admin() || wp_doing_ajax() || is_feed()) {
        return;
    }

    if (defined('REST_REQUEST') && REST_REQUEST) {
        return;
    }

    $slug = ai_get_requested_post_slug();
    if ($slug === '') {
        return;
    }

    $map = ai_get_duplicate_redirect_map();
    if (!isset($map[$slug])) {
        return;
    }

    $target_url = $map[$slug];
    if (!is_string($target_url) || $target_url === '') {
        return;
    }

    $request_path = '/' . trim((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/') . '/';
    $target_path = '/' . trim((string) parse_url($target_url, PHP_URL_PATH), '/') . '/';
    if ($request_path === $target_path) {
        return;
    }

    wp_safe_redirect($target_url, 301, 'AI SEO MU Plugin');
    exit;
}

function ai_maybe_redirect_numbered_duplicate_slug() {
    if (!is_404() || is_admin() || wp_doing_ajax() || is_feed()) {
        return;
    }

    if (defined('REST_REQUEST') && REST_REQUEST) {
        return;
    }

    $slug = ai_get_requested_post_slug();
    if ($slug === '' || !preg_match('/^(.*)-([0-9]+)$/', $slug, $matches)) {
        return;
    }

    $target_slug = sanitize_title($matches[1]);
    if ($target_slug === '' || $target_slug === $slug) {
        return;
    }

    $post = get_page_by_path($target_slug, OBJECT, 'post');
    if (!($post instanceof WP_Post) || $post->post_status !== 'publish') {
        return;
    }

    $target_url = get_permalink($post);
    if (!$target_url) {
        return;
    }

    wp_safe_redirect($target_url, 301, 'AI SEO MU Plugin');
    exit;
}

function ai_dedupe_canonical_tags($html) {
    if (!is_string($html)) {
        return $html;
    }

    if (!preg_match_all('/<link[^>]+rel=["\\\']canonical["\\\'][^>]*>\\s*/i', $html, $matches) || count($matches[0]) <= 1) {
        return $html;
    }

    $last = end($matches[0]);
    $clean = preg_replace('/<link[^>]+rel=["\\\']canonical["\\\'][^>]*>\\s*/i', '', $html);

    if ($clean === null || !is_string($last)) {
        return $html;
    }

    return preg_replace('/<\\/head>/i', $last . "\n</head>", $clean, 1) ?? $html;
}

function ai_normalize_document_title($html) {
    if (!is_string($html)) {
        return $html;
    }

    $normalized = ai_get_document_title_for_current_request();
    if ($normalized === '') {
        return $html;
    }

    $title = esc_html($normalized);
    $tag = '<title>' . $title . '</title>';

    if (preg_match('/<title>.*?<\\/title>/is', $html)) {
        return preg_replace('/<title>.*?<\\/title>/is', $tag, $html, 1) ?? $html;
    }

    return preg_replace('/<\\/head>/i', $tag . "\n</head>", $html, 1) ?? $html;
}

function ai_normalize_meta_description_tag($html) {
    if (!is_string($html)) {
        return $html;
    }

    $description = '';
    if (is_front_page() || is_home()) {
        $description = trim((string) get_bloginfo('description'));
        if ($description === '') {
            $description = trim((string) get_option('blogdescription', ''));
        }
        $description = ai_trim_text_for_head($description, 155);
    } elseif (is_singular('post')) {
        $description = ai_get_singular_meta_description();
    }

    if ($description === '') {
        return $html;
    }

    $tag = '<meta name="description" content="' . esc_attr($description) . '" />';

    if (preg_match('/<meta[^>]+name=["\\\']description["\\\'][^>]*>/i', $html)) {
        return preg_replace('/<meta[^>]+name=["\\\']description["\\\'][^>]*>/i', $tag, $html, 1) ?? $html;
    }

    return preg_replace('/<\\/head>/i', $tag . "\n</head>", $html, 1) ?? $html;
}

function ai_normalize_post_content_structure($content) {
    if (!is_string($content) || $content === '') {
        return $content;
    }

    $content = preg_replace('/\s*<link[^>]+rel=["\\\']canonical["\\\'][^>]*>\s*/i', "\n", $content);
    $content = preg_replace('/<h1(\\b[^>]*)>/i', '<h2$1>', $content);
    $content = preg_replace('/<\\/h1>/i', '</h2>', $content);

    return $content;
}

add_filter('wpfc_buffer_callback_filter', function($buffer) {
    $buffer = ai_dedupe_canonical_tags($buffer);
    $buffer = ai_normalize_document_title($buffer);
    return ai_normalize_meta_description_tag($buffer);
}, 10, 1);

add_filter('the_content', 'ai_normalize_post_content_structure', 1);

add_action('template_redirect', 'ai_maybe_redirect_invalid_post_query', -1001);
add_action('template_redirect', 'ai_maybe_redirect_mapped_duplicate_slug', -1000);
add_action('template_redirect', 'ai_maybe_redirect_numbered_duplicate_slug', -1000);

add_action('template_redirect', function() {
    if (is_admin() || wp_doing_ajax() || is_feed()) {
        return;
    }

    ob_start(function($buffer) {
        $buffer = ai_dedupe_canonical_tags($buffer);
        $buffer = ai_normalize_document_title($buffer);
        return ai_normalize_meta_description_tag($buffer);
    });
}, 0);

add_filter('wpseo_title', function($title) {
    if (is_singular('post')) {
        return ai_get_singular_document_title();
    }

    if (is_front_page() || is_home()) {
        return ai_get_home_document_title();
    }

    return $title;
}, PHP_INT_MAX);

add_filter('wpseo_metadesc', function($description) {
    if (is_singular('post')) {
        return ai_get_singular_meta_description();
    }

    if (is_front_page() || is_home()) {
        return ai_trim_text_for_head((string) $description, 155);
    }

    return $description;
}, PHP_INT_MAX);

add_action('wp_head', function() {
    $canonical = ai_get_canonical_url();
    if ($canonical === '') {
        return;
    }

    echo '<link rel="canonical" href="' . esc_url($canonical) . '" />' . "\n";
}, 1);

add_action('wp_head', function() {
    if (is_search() || (is_archive() && !have_posts())) {
        echo '<meta name="robots" content="noindex, follow" />' . "\n";
    }
}, 1);

add_action('wp_head', function() {
    $google = trim((string) get_option('ai_google_site_verification', ''));
    if ($google !== '') {
        echo '<meta name="google-site-verification" content="' . esc_attr($google) . '" />' . "\n";
    }

    $bing = trim((string) get_option('ai_bing_site_verification', ''));
    if ($bing !== '') {
        echo '<meta name="msvalidate.01" content="' . esc_attr($bing) . '" />' . "\n";
    }
}, 1);

add_action('wp_head', function() {
    if (!is_singular('post')) {
        return;
    }

    $yoast_desc = trim((string) get_post_meta(get_the_ID(), '_yoast_wpseo_metadesc', true));
    if ($yoast_desc !== '') {
        return;
    }

    $excerpt = get_the_excerpt();
    if (!$excerpt) {
        $excerpt = wp_trim_words(wp_strip_all_tags((string) get_post_field('post_content', get_the_ID())), 32, '...');
    }
    if ($excerpt) {
        echo '<meta name="description" content="' . esc_attr($excerpt) . '" />' . "\n";
    }
}, 1);

add_action('wp_head', function() {
    if (is_singular('post') && !class_exists('WPSEO_Frontend')) {
        $title = get_the_title();
        $desc = get_the_excerpt();
        if (!$desc) {
            $desc = wp_trim_words(wp_strip_all_tags((string) get_post_field('post_content', get_the_ID())), 32, '...');
        }
        $url = get_permalink();
        $img = get_the_post_thumbnail_url(null, 'large');
        echo '<meta property="og:type" content="article" />' . "\n";
        echo '<meta property="og:title" content="' . esc_attr($title) . '" />' . "\n";
        echo '<meta property="og:description" content="' . esc_attr($desc) . '" />' . "\n";
        echo '<meta property="og:url" content="' . esc_url($url) . '" />' . "\n";
        if ($img) echo '<meta property="og:image" content="' . esc_url($img) . '" />' . "\n";
    }
}, 1);

// GEO: Organization Schema (모든 페이지)
add_action('wp_head', function() {
    $org = [
        '@context' => 'https://schema.org',
        '@type' => 'Organization',
        'name' => get_bloginfo('name'),
        'url' => home_url('/'),
        'description' => get_bloginfo('description'),
    ];
    echo '<script type="application/ld+json">' . wp_json_encode($org, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . '</script>' . "\n";
}, 2);

// GEO: WebSite + SearchAction Schema (프론트 페이지)
add_action('wp_head', function() {
    if (!is_front_page()) return;
    $ws = [
        '@context' => 'https://schema.org',
        '@type' => 'WebSite',
        'name' => get_bloginfo('name'),
        'url' => home_url('/'),
        'potentialAction' => [
            '@type' => 'SearchAction',
            'target' => home_url('/?s={search_term_string}'),
            'query-input' => 'required name=search_term_string',
        ],
    ];
    echo '<script type="application/ld+json">' . wp_json_encode($ws, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . '</script>' . "\n";
}, 2);

// GEO: BreadcrumbList Schema (개별 포스트)
add_action('wp_head', function() {
    if (!is_singular('post')) return;
    $cats = get_the_category();
    $items = [
        ['@type' => 'ListItem', 'position' => 1, 'name' => get_bloginfo('name'), 'item' => home_url('/')],
    ];
    if (!empty($cats)) {
        $items[] = ['@type' => 'ListItem', 'position' => 2, 'name' => $cats[0]->name, 'item' => get_category_link($cats[0]->term_id)];
        $items[] = ['@type' => 'ListItem', 'position' => 3, 'name' => get_the_title()];
    } else {
        $items[] = ['@type' => 'ListItem', 'position' => 2, 'name' => get_the_title()];
    }
    echo '<script type="application/ld+json">' . wp_json_encode(['@context' => 'https://schema.org', '@type' => 'BreadcrumbList', 'itemListElement' => $items], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . '</script>' . "\n";
}, 2);

function ai_submit_indexnow_url($url) {
    $key = trim((string) get_option('ai_indexnow_key', ''));
    $key_url = trim((string) get_option('ai_indexnow_key_url', ''));
    $host = wp_parse_url(home_url('/'), PHP_URL_HOST);

    if ($key === '' || $key_url === '' || !$host || !$url) {
        return;
    }

    wp_remote_post('https://api.indexnow.org/indexnow', [
        'timeout' => 5,
        'headers' => ['Content-Type' => 'application/json; charset=utf-8'],
        'body' => wp_json_encode([
            'host' => $host,
            'key' => $key,
            'keyLocation' => $key_url,
            'urlList' => [$url],
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);
}

add_action('transition_post_status', function($new_status, $old_status, $post) {
    if (!$post instanceof WP_Post || $post->post_type !== 'post') {
        return;
    }

    if (wp_is_post_revision($post)) {
        return;
    }

    if ($new_status !== 'publish') {
        return;
    }

    $permalink = get_permalink($post);
    if ($permalink) {
        ai_submit_indexnow_url($permalink);
    }
}, 10, 3);

// GEO: Author ProfilePage Schema (소개 페이지)
add_action('wp_head', function() {
    if (!is_page('소개') && !is_page('about')) return;
    $site_name = get_bloginfo('name');
    $home_url = home_url('/');
    $author_page_url = get_permalink();
    $description = trim((string) get_option('ai_persona_bio', ''));
    $expertise = trim((string) get_option('ai_persona_expertise', ''));
    $concern = trim((string) get_option('ai_persona_concern', ''));
    $author_name = trim((string) get_option('ai_persona_name', $site_name));

    $person = [
        '@context' => 'https://schema.org',
        '@type' => 'ProfilePage',
        'mainEntity' => [
            '@type' => 'Person',
            '@id' => $home_url . '#author',
            'name' => $author_name,
            'url' => $author_page_url,
        ],
    ];
    if ($expertise !== '') {
        $person['mainEntity']['jobTitle'] = $expertise;
        $person['mainEntity']['knowsAbout'] = $expertise;
    }
    if ($concern !== '') {
        $person['mainEntity']['knowsAbout'] = $concern;
    }
    if ($description !== '') {
        $person['mainEntity']['description'] = $description;
    }
    echo '<script type="application/ld+json">' . wp_json_encode($person, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . '</script>' . "\n";
}, 2);

// llms-full.txt static generation on post publish/update
function ai_regenerate_llms_full_txt() {
    $site_name = get_bloginfo('name');
    $site_desc = get_bloginfo('description');
    $home_url = home_url('/');
    $author_name = trim((string) get_option('ai_persona_name', $site_name));

    $output = "# {$site_name}\n\n";
    $output .= "> {$site_desc}\n\n";
    $output .= "## About\n";
    $output .= "- Author: {$author_name}\n";
    $output .= "- Site: {$home_url}\n\n";

    $cats = get_categories(['hide_empty' => true]);
    if (!empty($cats)) {
        $output .= "## Categories\n";
        foreach ($cats as $cat) {
            $output .= "- [{$cat->name}](" . get_category_link($cat->term_id) . "): {$cat->count} articles\n";
        }
        $output .= "\n";
    }

    $posts = get_posts(['post_type' => 'post', 'post_status' => 'publish', 'numberposts' => 200, 'orderby' => 'date', 'order' => 'DESC']);
    if (!empty($posts)) {
        $output .= "## Articles\n\n";
        foreach ($posts as $p) {
            $title = wp_strip_all_tags($p->post_title);
            $url = get_permalink($p);
            $date = get_the_date('Y-m-d', $p);
            $excerpt = wp_strip_all_tags($p->post_excerpt ?: wp_trim_words($p->post_content, 40, '...'));
            $output .= "### [{$title}]({$url})\n";
            $output .= "- Date: {$date}\n";
            $output .= "- Summary: {$excerpt}\n\n";
        }
    }

    $path = ABSPATH . 'llms-full.txt';
    @file_put_contents($path, $output);
    @chmod($path, 0644);
}

add_action('transition_post_status', function($new_status, $old_status, $post) {
    if (!$post instanceof WP_Post || $post->post_type !== 'post') return;
    if ($new_status !== 'publish' && $old_status !== 'publish') return;
    ai_regenerate_llms_full_txt();
}, 20, 3);

add_action('init', function() {
    if (!file_exists(ABSPATH . 'llms-full.txt')) {
        ai_regenerate_llms_full_txt();
    }
}, 99);
SEOPHP
}

refresh_credential_entry() {
  local slug="$1"
  local domain="$2"
  local site_dir="$3"
  local site_url="$4"

  jq \
    --arg slug "$slug" \
    --arg domain "$domain" \
    --arg site_dir "$site_dir" \
    --arg url "$site_url" \
    'map(if .slug == $slug then .domain = $domain | .site_dir = $site_dir | .url = $url else . end)' \
    "$CREDS_FILE" > "${CREDS_FILE}.tmp" && mv "${CREDS_FILE}.tmp" "$CREDS_FILE"
}

finalize_site_setup() {
  local slug="$1"
  local domain="$2"
  local site_dir="$3"
  local site_url
  site_url="$(site_url_for_domain "$domain")"

  ensure_wordpress_runtime_config "$site_dir"
  if [ "$WP_LIGHT_MODE" != "1" ]; then
    wp_try option update home "$site_url" --path="$site_dir" --allow-root --quiet 2>/dev/null || true
    wp_try option update siteurl "$site_url" --path="$site_dir" --allow-root --quiet 2>/dev/null || true
    wp_try option update blog_public 1 --path="$site_dir" --allow-root --quiet 2>/dev/null || true
    wp_try option update permalink_structure "/%postname%/" --path="$site_dir" --allow-root --quiet 2>/dev/null || true
  fi
  ensure_site_plugins "$site_dir"

  write_robots_txt "$domain" "$site_dir"
  chown www-data:www-data "$site_dir/robots.txt"
  ensure_seo_site_options "$domain" "$site_dir"

  ensure_enable_app_passwords_mu_plugin "$site_dir"
  ensure_seo_mu_plugin "$site_dir"
  write_nginx_config "$slug" "$domain" "$site_dir"

  chown www-data:www-data "$site_dir/wp-config.php" 2>/dev/null || true
  chown www-data:www-data "$site_dir/robots.txt" 2>/dev/null || true
  chmod 755 "$site_dir/wp-content/mu-plugins" 2>/dev/null || true
  chown -R www-data:www-data "$site_dir/wp-content/mu-plugins" 2>/dev/null || true
  chmod 644 "$site_dir/wp-content/mu-plugins/"*.php 2>/dev/null || true
}

SITE_COUNT=$(jq 'length' "$CREDS_FILE")
UPDATED=0
SKIPPED=0
SELECTED_COUNT=0
declare -a PROCESSED_SLUGS=()
declare -a PROCESSED_DOMAINS=()
declare -a PROCESSED_DIRS=()
declare -a FAILED_SITES=()
declare -a FAILED_REASONS=()

echo "=== 기존 WordPress 사이트 런타임 보강 시작 ($SITE_COUNT개) ==="
ensure_scanner_block_snippet

for i in $(seq 0 $((SITE_COUNT - 1))); do
  SLUG=$(jq -r ".[$i].slug" "$CREDS_FILE")
  DOMAIN=$(jq -r ".[$i].domain // empty" "$CREDS_FILE")
  DOMAIN="$(normalize_domain "$DOMAIN")"
  SITE_DIR=$(jq -r ".[$i].site_dir // empty" "$CREDS_FILE")
  SITE_URL="$(site_url_for_domain "$DOMAIN")"

  if ! slug_selected "$SLUG"; then
    continue
  fi

  SELECTED_COUNT=$((SELECTED_COUNT + 1))

  if [ -z "$SITE_DIR" ]; then
    SITE_DIR="/var/www/$SLUG"
  fi

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  [$SELECTED_COUNT] $SLUG"
  echo "  domain: $DOMAIN"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  if [ ! -d "$SITE_DIR" ] || [ ! -f "$SITE_DIR/wp-config.php" ]; then
    echo "  ⚠ site_dir 누락 또는 wp-config.php 없음 — 건너뜀"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  CRED_DB_NAME=$(jq -r ".[$i].db_name // empty" "$CREDS_FILE")
  CRED_DB_USER=$(jq -r ".[$i].db_user // empty" "$CREDS_FILE")
  CRED_DB_PASS=$(jq -r ".[$i].db_pass // empty" "$CREDS_FILE")
  EXISTING_APP_PASS=$(jq -r ".[$i].app_pass // empty" "$CREDS_FILE")

  ensure_site_database_access "$SLUG" "$SITE_DIR" "$CRED_DB_NAME" "$CRED_DB_USER" "$CRED_DB_PASS" || true
  finalize_site_setup "$SLUG" "$DOMAIN" "$SITE_DIR"

  BF_TITLE=$(jq -r ".[$i].title // empty" "$CREDS_FILE")
  BF_PERSONA=$(jq -r ".[$i].persona.name // empty" "$CREDS_FILE")
  BF_CATEGORIES=$(jq -r ".[$i].categories // [] | join(\",\")" "$CREDS_FILE" 2>/dev/null || echo "")
  BF_TAGLINE=$(wp_try option get blogdescription --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || echo "")
  BF_TAGLINE="$(build_home_description "$BF_TITLE" "$BF_TAGLINE")"
  wp option update blogdescription "$BF_TAGLINE" --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
  if [ -n "$BF_TITLE" ]; then
    write_llms_txt "$DOMAIN" "$SITE_DIR" "$BF_TITLE" "$BF_TAGLINE" "$BF_PERSONA" "$BF_CATEGORIES"
  fi

  # llms-full.txt 재생성 (MU-Plugin 함수 호출)
  wp_try eval 'if (function_exists("ai_regenerate_llms_full_txt")) { ai_regenerate_llms_full_txt(); }' --path="$SITE_DIR" --allow-root 2>/dev/null || true

  if [ "$WP_LIGHT_MODE" != "1" ]; then
    wp_try rewrite flush --hard --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
  fi

  ensure_application_password "$SLUG" "$SITE_DIR" "$EXISTING_APP_PASS" || true

  if ! validate_local_wordpress_runtime "$SITE_DIR" "$SITE_URL"; then
    echo "  ✗ 로컬 WordPress 런타임 검증 실패"
    FAILED_SITES+=("$SLUG")
    FAILED_REASONS+=("로컬 WordPress 런타임 검증 실패")
    continue
  fi

  refresh_credential_entry "$SLUG" "$DOMAIN" "$SITE_DIR" "$SITE_URL"
  PROCESSED_SLUGS+=("$SLUG")
  PROCESSED_DOMAINS+=("$DOMAIN")
  PROCESSED_DIRS+=("$SITE_DIR")
  UPDATED=$((UPDATED + 1))
  echo "  ✓ 로컬 런타임 보강 완료"
done

sync_cache

echo ""
echo "--- Nginx / PHP-FPM 설정 검증 ---"
nginx -t && systemctl reload nginx
if [ "$UPDATED" -gt 0 ]; then
  purge_fastcgi_cache
fi
ensure_allmyreview_certificate
systemctl reload php8.2-fpm 2>/dev/null || true
ensure_system_cron_runner

echo ""
echo "--- 원격 WordPress 엔드포인트 검증 ---"
for idx in "${!PROCESSED_SLUGS[@]}"; do
  SLUG="${PROCESSED_SLUGS[$idx]}"
  DOMAIN="${PROCESSED_DOMAINS[$idx]}"
  SITE_DIR="${PROCESSED_DIRS[$idx]}"

  echo "  [$((idx+1))/${#PROCESSED_SLUGS[@]}] $SLUG wp-json 확인 중..."

  if validate_remote_wordpress "$DOMAIN"; then
    echo "  ✓ wp-json 정상"
    continue
  fi

  echo "  ⚠ wp-json 응답 이상 — 로컬 캐시 정리 후 재시도"
  wp_try cache flush --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
  if [ "$WP_LIGHT_MODE" != "1" ]; then
    wp_try rewrite flush --hard --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
  fi
  systemctl reload php8.2-fpm 2>/dev/null || true
  nginx -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1 || true

  if validate_remote_wordpress "$DOMAIN"; then
    echo "  ✓ wp-json 복구 완료"
    continue
  fi

  echo "  ✗ wp-json 응답 실패"
  FAILED_SITES+=("$SLUG")
  FAILED_REASONS+=("wp-json endpoint timeout/failure")
done

echo ""
echo "=========================================="
echo "  런타임 보강 완료: $UPDATED개"
echo "  건너뜀: $SKIPPED개"
if [ "${#FAILED_SITES[@]}" -gt 0 ]; then
  echo "  검증 실패: ${#FAILED_SITES[@]}개"
  for idx in "${!FAILED_SITES[@]}"; do
    echo "    [${FAILED_SITES[$idx]}] ${FAILED_REASONS[$idx]}"
  done
else
  echo "  검증 실패: 0개"
fi
echo "=========================================="

if [ "${#FAILED_SITES[@]}" -gt 0 ]; then
  exit 1
fi
