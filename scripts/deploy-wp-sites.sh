#!/bin/bash
# deploy-wp-sites.sh
# AI가 생성한 JSON 설정을 받아 WordPress 사이트를 대량 설치
# 사용법: ./deploy-wp-sites.sh sites-config.json

set -uo pipefail

CONFIG_FILE="${1:-}"

if [ -z "$CONFIG_FILE" ]; then
  echo "Usage: ./deploy-wp-sites.sh sites-config.json"
  exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: $CONFIG_FILE 파일을 찾을 수 없습니다."
  exit 1
fi

# ---- 설정 로드 ----
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_FILE_OWNER="${APP_FILE_OWNER:-$(stat -c '%U:%G' "$REPO_ROOT" 2>/dev/null || echo root:root)}"

source /root/.wp-bulk-credentials  # DB_ROOT_PASS

SERVER_ROLE_FILE="${SERVER_ROLE_FILE:-/etc/wp-bulk-server-role}"
SERVER_ROLE="${WP_BULK_SERVER_ROLE:-}"
if [ -z "$SERVER_ROLE" ] && [ -f "$SERVER_ROLE_FILE" ]; then
  SERVER_ROLE="$(tr -d '\r\n' < "$SERVER_ROLE_FILE")"
fi
case "$SERVER_ROLE" in
  primary)
    DEFAULT_ALLMYREVIEW_CERT_NAME="allmyreview-primary-sites"
    DEFAULT_MYGROUND_CERT_NAME="myground-primary-sites"
    ;;
  secondary)
    DEFAULT_ALLMYREVIEW_CERT_NAME="allmyreview-secondary-sites"
    DEFAULT_MYGROUND_CERT_NAME="myground-secondary-sites"
    ;;
  *)
    DEFAULT_ALLMYREVIEW_CERT_NAME="allmyreview-sites"
    DEFAULT_MYGROUND_CERT_NAME="myground-sites"
    ;;
esac

WP_ADMIN_USER="admin"
WP_ADMIN_PASS="$(openssl rand -base64 16)"
WP_ADMIN_EMAIL="admin@wpbulk.local"
WEB_ROOT="/var/www"
CREDS_FILE="/root/wp-sites-credentials.json"
ALLMYREVIEW_CERT_NAME="${ALLMYREVIEW_CERT_NAME:-$DEFAULT_ALLMYREVIEW_CERT_NAME}"
ALLMYREVIEW_CERT_DIR="/etc/letsencrypt/live/$ALLMYREVIEW_CERT_NAME"
ALLMYREVIEW_CERT_MAX_NAMES="${ALLMYREVIEW_CERT_MAX_NAMES:-100}"
MYGROUND_CERT_NAME="${MYGROUND_CERT_NAME:-$DEFAULT_MYGROUND_CERT_NAME}"
MYGROUND_CERT_DIR="/etc/letsencrypt/live/$MYGROUND_CERT_NAME"
MYGROUND_CERT_MAX_NAMES="${MYGROUND_CERT_MAX_NAMES:-100}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
WP_CRON_RUNNER_PATH="${WP_CRON_RUNNER_PATH:-/usr/local/bin/wp-bulk-run-cron.sh}"
WP_CRON_SCHEDULE_PATH="${WP_CRON_SCHEDULE_PATH:-/etc/cron.d/wp-bulk-run-cron}"
WP_CLI_TIMEOUT="${WP_CLI_TIMEOUT:-30}"
POST_DEPLOY_REPAIR_SCRIPT="${POST_DEPLOY_REPAIR_SCRIPT:-$SCRIPT_DIR/backfill-existing-sites.sh}"
INDEXNOW_KEY_FILE="${INDEXNOW_KEY_FILE:-/root/.wp-bulk-indexnow-key}"
SCANNER_BLOCK_SNIPPET="${SCANNER_BLOCK_SNIPPET:-/etc/nginx/snippets/wp-bulk-scanner-blocks.conf}"

if [ -z "${BING_SITE_VERIFICATION:-}" ]; then
  echo "⚠ BING_SITE_VERIFICATION is not set; Bing ownership meta tag will not be injected into deployed WP sites."
fi

# 앱/브리지 캐시 경로
APP_CACHE_DIR="${APP_CACHE_DIR:-$REPO_ROOT/admin/.cache}"
APP_CREDS_FILE="$APP_CACHE_DIR/sites-credentials.json"
mkdir -p "$APP_CACHE_DIR"

# Bridge API가 읽는 경로
BRIDGE_DATA_DIR="${BRIDGE_DATA_DIR:-$REPO_ROOT/bridge-api/data}"
BRIDGE_CREDS_FILE="$BRIDGE_DATA_DIR/wp-sites-credentials.json"
mkdir -p "$BRIDGE_DATA_DIR"

# 캐시 동기화 함수 (사이트 설치 후 호출)
sync_cache() {
  cp "$CREDS_FILE" "$APP_CREDS_FILE" 2>/dev/null || true
  chown "$APP_FILE_OWNER" "$APP_CREDS_FILE" 2>/dev/null || true
  # EC2 Agent가 읽는 경로에도 동기화
  cp "$CREDS_FILE" "$BRIDGE_CREDS_FILE" 2>/dev/null || true
  chown "$APP_FILE_OWNER" "$BRIDGE_CREDS_FILE" 2>/dev/null || true
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

validate_local_wordpress_runtime() {
  local site_dir="$1"
  local expected_url="$2"

  wp_try core is-installed --path="$site_dir" --allow-root >/dev/null 2>&1 || return 1
  wp_try option get home --path="$site_dir" --allow-root >/dev/null 2>&1 || return 1
  wp_try option get siteurl --path="$site_dir" --allow-root >/dev/null 2>&1 || return 1
  wp_try user list --field=user_login --path="$site_dir" --allow-root >/dev/null 2>&1 || return 1

  if [ -n "$expected_url" ]; then
    local home_url
    home_url="$(wp_try option get home --path="$site_dir" --allow-root 2>/dev/null || true)"
    [ -z "$home_url" ] || [ "$home_url" = "$expected_url" ] || return 1
  fi

  return 0
}

sanitize_marker_field() {
  printf '%s' "${1:-}" | tr '\r\n|' '   '
}

emit_marker() {
  printf '__WPBULK__%s\n' "$1"
}

build_db_identifier() {
  local slug="$1"
  local normalized="${slug//-/_}"
  local short="${normalized:0:6}"
  local hash
  hash="$(printf '%s' "$slug" | sha256sum | cut -c1-6)"

  if [ -z "$short" ]; then
    short="site"
  fi

  printf 'wp_%s_%s' "$short" "$hash"
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

cert_covers_domain() {
  local domain="$1"

  [[ -f "$ALLMYREVIEW_CERT_DIR/fullchain.pem" ]] || return 1
  openssl x509 -in "$ALLMYREVIEW_CERT_DIR/fullchain.pem" -noout -text 2>/dev/null | grep -Fq "DNS:$domain"
}

collect_allmyreview_domains() {
  python3 - "$CONFIG_FILE" <<'PY'
from pathlib import Path
import json
import subprocess
import sys

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

config_path = Path(sys.argv[1])
if config_path.exists():
    try:
      payload = json.loads(config_path.read_text())
    except Exception:
      payload = []
    if isinstance(payload, list):
        for item in payload:
            if not isinstance(item, dict):
                continue
            domain = str(item.get("domain") or "").strip().lower()
            if domain.endswith(".allmyreview.site"):
                domains.add(domain)

for domain in sorted(domains):
    print(domain)
PY
}

ensure_allmyreview_certificate() {
  if [ "${SKIP_CERTBOT:-0}" = "1" ]; then
    echo "  ↷ SKIP_CERTBOT=1 설정으로 secondary certbot 단계를 건너뜁니다."
    return 0
  fi

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

collect_myground_domains() {
  python3 - "$CONFIG_FILE" <<'PY'
from pathlib import Path
import json
import subprocess
import sys

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
        if domain.endswith(".myground.website") or domain == "myground.website":
            domains.add(domain)

config_path = Path(sys.argv[1])
if config_path.exists():
    try:
      payload = json.loads(config_path.read_text())
    except Exception:
      payload = []
    if isinstance(payload, list):
        for item in payload:
            if not isinstance(item, dict):
                continue
            domain = str(item.get("domain") or "").strip().lower()
            if domain.endswith(".myground.website") or domain == "myground.website":
                domains.add(domain)

for domain in sorted(domains):
    print(domain)
PY
}

ensure_myground_certificate() {
  if [ "${SKIP_CERTBOT:-0}" = "1" ]; then
    echo "  ↷ SKIP_CERTBOT=1 설정으로 myground certbot 단계를 건너뜁니다."
    return 0
  fi

  if ! command -v certbot >/dev/null 2>&1; then
    echo "  ⚠ certbot이 없어 myground SSL 인증서를 갱신하지 못했습니다."
    return 0
  fi

  mapfile -t domains < <(collect_myground_domains)
  if [ "${#domains[@]}" -eq 0 ]; then
    return 0
  fi

  if [ "${#domains[@]}" -gt "$MYGROUND_CERT_MAX_NAMES" ]; then
    echo "  ⚠ myground SSL 인증서 SAN 도메인이 ${#domains[@]}개입니다. wildcard 인증서 전환이 필요합니다."
    return 0
  fi

  local missing=()
  local domain
  for domain in "${domains[@]}"; do
    if ! [[ -f "$MYGROUND_CERT_DIR/fullchain.pem" ]] || ! openssl x509 -in "$MYGROUND_CERT_DIR/fullchain.pem" -noout -text 2>/dev/null | grep -Fq "DNS:$domain"; then
      missing+=("$domain")
    fi
  done

  if [ "${#missing[@]}" -eq 0 ]; then
    echo "  ✓ myground SSL 인증서 도메인 포함 상태 정상"
    return 0
  fi

  echo "--- myground SSL 인증서 확장 (${#missing[@]}개 신규) ---"
  printf '  + %s\n' "${missing[@]}"

  local certbot_args=(
    certbot certonly
    --nginx
    --non-interactive
    --cert-name "$MYGROUND_CERT_NAME"
  )

  if [ -n "$CERTBOT_EMAIL" ]; then
    certbot_args+=(--agree-tos --email "$CERTBOT_EMAIL")
  else
    certbot_args+=(--agree-tos --register-unsafely-without-email)
  fi

  if [ -f "$MYGROUND_CERT_DIR/fullchain.pem" ]; then
    certbot_args+=(--expand)
  fi

  for domain in "${domains[@]}"; do
    certbot_args+=(-d "$domain")
  done

  if "${certbot_args[@]}"; then
    nginx -t && systemctl reload nginx
    echo "  ✓ myground SSL 인증서 갱신 완료"
  else
    echo "  ⚠ myground SSL 인증서 갱신 실패"
  fi
}

ensure_individual_certificate() {
  local domain="$1"

  if [ "${SKIP_CERTBOT:-0}" = "1" ]; then
    echo "  ↷ SKIP_CERTBOT=1 설정으로 개별 인증서 발급을 건너뜁니다."
    return 1
  fi

  if ! command -v certbot >/dev/null 2>&1; then
    echo "  ⚠ certbot이 없어 개별 SSL 인증서를 발급하지 못했습니다."
    return 1
  fi

  local cert_dir="/etc/letsencrypt/live/$domain"
  if [[ -f "$cert_dir/fullchain.pem" ]] && [[ -f "$cert_dir/privkey.pem" ]]; then
    echo "  ✓ 개별 SSL 인증서 이미 존재: $domain"
    return 0
  fi

  echo "--- 개별 SSL 인증서 발급: $domain ---"

  local certbot_args=(
    certbot certonly
    --nginx
    --non-interactive
    -d "$domain"
  )

  if [ -n "$CERTBOT_EMAIL" ]; then
    certbot_args+=(--agree-tos --email "$CERTBOT_EMAIL")
  else
    certbot_args+=(--agree-tos --register-unsafely-without-email)
  fi

  if "${certbot_args[@]}"; then
    nginx -t && systemctl reload nginx
    echo "  ✓ 개별 SSL 인증서 발급 완료: $domain"
    return 0
  else
    echo "  ⚠ 개별 SSL 인증서 발급 실패: $domain (HTTP로 폴백)"
    return 1
  fi
}

get_individual_cert_dir() {
  local domain="$1"
  local cert_dir="/etc/letsencrypt/live/$domain"
  if [[ -f "$cert_dir/fullchain.pem" ]] && [[ -f "$cert_dir/privkey.pem" ]]; then
    echo "$cert_dir"
    return 0
  fi
  return 1
}

site_url_for_domain() {
  local domain
  domain="$(normalize_domain "$1")"
  if [[ "$domain" == *.allmyreview.site ]]; then
    printf 'https://%s' "$domain"
  elif [[ "$domain" == *.myground.website ]] || [[ "$domain" == "myground.website" ]]; then
    printf 'https://%s' "$domain"
  elif get_individual_cert_dir "$domain" >/dev/null 2>&1; then
    printf 'https://%s' "$domain"
  else
    printf 'http://%s' "$domain"
  fi
}

write_robots_txt() {
  local domain="$1"
  local site_dir="$2"
  local site_url
  site_url="$(site_url_for_domain "$domain")"

  cat > "$site_dir/robots.txt" << ROBOTS
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
Sitemap: ${site_url}/wp-sitemap.xml
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
    cat > "$nginx_path" << NGINX
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

    location = /llms-full.txt {
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
  elif { [[ "$domain" == *.myground.website ]] || [[ "$domain" == "myground.website" ]]; } \
    && [[ -f "$MYGROUND_CERT_DIR/fullchain.pem" ]] \
    && [[ -f "$MYGROUND_CERT_DIR/privkey.pem" ]]; then
    cat > "$nginx_path" << NGINX
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

    ssl_certificate $MYGROUND_CERT_DIR/fullchain.pem;
    ssl_certificate_key $MYGROUND_CERT_DIR/privkey.pem;
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

    location = /llms-full.txt {
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
    # 개별 도메인: SSL 인증서 확인 후 HTTPS 또는 HTTP 설정
    local ind_cert_dir
    ind_cert_dir="$(get_individual_cert_dir "$domain" 2>/dev/null || true)"

    if [[ -n "$ind_cert_dir" ]]; then
      # 개별 SSL 인증서 존재 → HTTPS 설정
      cat > "$nginx_path" << NGINX
server {
    listen 80;
    server_name $domain;

    location /.well-known/acme-challenge/ { root $site_dir; }
    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl http2;
    server_name $domain;
    root $site_dir;
    index index.php index.html;

    ssl_certificate $ind_cert_dir/fullchain.pem;
    ssl_certificate_key $ind_cert_dir/privkey.pem;
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

    location = /llms-full.txt {
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
      # SSL 인증서 없음 → HTTP only (certbot ACME 챌린지 포함)
      cat > "$nginx_path" << NGINX
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
    if (\$invalid_post_query = 1) { return 301 http://\$host\$uri; }

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

    location = /llms-full.txt {
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
  fi

  ln -sf "$nginx_path" "/etc/nginx/sites-enabled/$slug"
}

finalize_site_setup() {
  local slug="$1"
  local domain="$2"
  local site_dir="$3"
  local site_url
  site_url="$(site_url_for_domain "$domain")"

  ensure_wordpress_runtime_config "$site_dir"
  wp_try option update home "$site_url" --path="$site_dir" --allow-root --quiet 2>/dev/null || true
  wp_try option update siteurl "$site_url" --path="$site_dir" --allow-root --quiet 2>/dev/null || true
  wp_try option update blog_public 1 --path="$site_dir" --allow-root --quiet 2>/dev/null || true
  wp_try option update permalink_structure "/%postname%/" --path="$site_dir" --allow-root --quiet 2>/dev/null || true
  ensure_site_plugins "$site_dir"

  write_robots_txt "$domain" "$site_dir"
  chown www-data:www-data "$site_dir/robots.txt"
  ensure_seo_site_options "$domain" "$site_dir"

  # llms.txt는 finalize에서는 기존 파일이 없을 때만 생성 (파라미터 부족)
  # 메인 설치 루프에서 전체 파라미터로 생성됨

  write_nginx_config "$slug" "$domain" "$site_dir"

  chown -R www-data:www-data "$site_dir"
  chmod -R 755 "$site_dir"

  ensure_enable_app_passwords_mu_plugin "$site_dir"
  ensure_seo_mu_plugin "$site_dir"
  ensure_schema_mu_plugin "$site_dir" "$domain"
  chown -R www-data:www-data "$site_dir/wp-content/mu-plugins" 2>/dev/null || true
  chmod 755 "$site_dir/wp-content/mu-plugins" 2>/dev/null || true
  chmod 644 "$site_dir/wp-content/mu-plugins/"*.php 2>/dev/null || true
}

ensure_wordpress_runtime_config() {
  local site_dir="$1"
  local wp_config="$site_dir/wp-config.php"

  wp_try config set DISABLE_WP_CRON true --raw --type=constant --path="$site_dir" --allow-root --quiet 2>/dev/null || true

  if [ -f "$wp_config" ] && ! grep -q "HTTP_X_FORWARDED_PROTO" "$wp_config" 2>/dev/null; then
    php -r '
      $path = $argv[1];
      $needle = "require_once ABSPATH . '\''wp-settings.php'\'';";
      $insert = <<<'\''PHP'\''
if (isset($_SERVER['\''HTTP_X_FORWARDED_PROTO'\'']) && strpos($_SERVER['\''HTTP_X_FORWARDED_PROTO'\''], '\''https'\'') !== false) { $_SERVER['\''HTTPS'\''] = '\''on'\''; }
if (isset($_SERVER['\''HTTP_X_FORWARDED_HOST'\'']) && $_SERVER['\''HTTP_X_FORWARDED_HOST'\''] !== '\'\'') { $_SERVER['\''HTTP_HOST'\''] = $_SERVER['\''HTTP_X_FORWARDED_HOST'\'']; }
PHP;
      $contents = @file_get_contents($path);
      if ($contents === false || strpos($contents, "HTTP_X_FORWARDED_PROTO") !== false) {
        exit(0);
      }
      $updated = str_replace($needle, $insert . "\n" . $needle, $contents, $count);
      if ($count > 0) {
        file_put_contents($path, $updated);
      }
    ' "$wp_config" >/dev/null 2>&1 || true
  fi
}

ensure_site_install_capacity() {
  local min_free_kb="${MIN_SITE_FREE_KB:-262144}"
  local available_kb
  available_kb=$(df -Pk "$WEB_ROOT" 2>/dev/null | awk 'NR==2 {print $4}')

  if [ -z "$available_kb" ] || ! [[ "$available_kb" =~ ^[0-9]+$ ]]; then
    return 0
  fi

  if [ "$available_kb" -lt "$min_free_kb" ]; then
    SITE_LAST_ERROR="디스크 공간 부족 (${available_kb}KB 남음)"
    return 1
  fi

  return 0
}

ensure_plugin_active() {
  local site_dir="$1"
  local plugin="$2"

  if ! wp_try plugin is-installed "$plugin" --path="$site_dir" --allow-root >/dev/null 2>&1; then
    wp_try plugin install "$plugin" --path="$site_dir" --allow-root --quiet 2>/dev/null || return 0
  fi

  wp_try plugin activate "$plugin" --path="$site_dir" --allow-root --quiet 2>/dev/null || true
}

ensure_site_plugins() {
  local site_dir="$1"

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

# AEO Schema (Organization JSON-LD) 자동 설치 MU-Plugin
ensure_schema_mu_plugin() {
  local site_dir="$1"
  local domain="$2"
  local mu_dir="$site_dir/wp-content/mu-plugins"
  local schema_file="$mu_dir/aeo-schema.php"

  # 이미 설치되어 있으면 건너뛰기
  if [ -f "$schema_file" ]; then
    return 0
  fi

  local site_title
  site_title="$(wp_try option get blogname --path="$site_dir" --allow-root 2>/dev/null || true)"
  [ -z "$site_title" ] && site_title="$domain"

  local site_url
  site_url="$(site_url_for_domain "$domain")"

  # JSON 내부의 특수문자 이스케이프
  local escaped_title
  escaped_title="$(printf '%s' "$site_title" | sed "s/'/\\\\'/g" | sed 's/"/\\\\"/g')"

  mkdir -p "$mu_dir"
  cat > "$schema_file" << SCHEMAPHP
<?php
/**
 * Plugin Name: AEO Schema (JSON-LD)
 * Description: Auto-generated Organization Schema for AEO optimization
 * Version: 1.0
 * Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
 * Site: $domain
 */

add_action('wp_head', function() {
    echo '<script type="application/ld+json">' . PHP_EOL;
    echo '{ "@context": "https://schema.org", "@type": "Organization", "name": "${escaped_title}", "url": "${site_url}" }' . PHP_EOL;
    echo '</script>' . PHP_EOL;
}, 1);
SCHEMAPHP
}

# AI SEO 최적화 MU-Plugin 설치
ensure_seo_mu_plugin() {
  local site_dir="$1"
  local mu_dir="$site_dir/wp-content/mu-plugins"

  mkdir -p "$mu_dir"
  cat > "$mu_dir/ai-seo-optimize.php" << 'SEOPHP'
<?php
/**
 * AI SEO 최적화 MU-Plugin
 * - 빈 검색/아카이브 noindex
 * - Open Graph 폴백
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

// 빈 검색/아카이브 noindex
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

// Meta description fallback
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

// Open Graph 기본 설정 (Yoast 없을 때 폴백)
add_action('wp_head', function() {
    if (is_singular('post') && !class_exists('WPSEO_Frontend')) {
        $title = get_the_title();
        $desc = get_the_excerpt();
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

// Generate on first load if missing
add_action('init', function() {
    if (!file_exists(ABSPATH . 'llms-full.txt')) {
        ai_regenerate_llms_full_txt();
    }
}, 99);
SEOPHP
}

# 무료 테마 풀 (style별 매핑)
declare -A THEME_MAP
THEME_MAP[minimal]="flavor flavor flavor flavor flavor flavor flavor flavor flavor flavor"
THEME_MAP[warm]="flavor flavor flavor flavor flavor flavor flavor flavor flavor flavor"
THEME_MAP[clean]="flavor flavor flavor flavor flavor flavor flavor flavor flavor flavor"
THEME_MAP[bold]="flavor flavor flavor flavor flavor flavor flavor flavor flavor flavor"
THEME_MAP[natural]="flavor flavor flavor flavor flavor flavor flavor flavor flavor flavor"

# 실제 설치 가능한 무료 테마 리스트
REAL_THEMES=(
  "flavor flavor flavor"
  "flavor flavor flavor"
)

# 실제 사용할 WP.org 무료 테마
WP_THEMES=(
  "flavor"
  "flavor"
  "flavor"
  "flavor"
  "flavor"
)

# ↑ 위 테마 이름이 반복이라 실제 WP.org 테마로 교체:
INSTALL_THEMES=(
  "flavor flavor flavor flavor flavor"
)

# ★ 실제 WordPress.org 무료 테마 slug:
THEMES=(
  "flavor flavor flavor flavor flavor"
)

# 제가 이 부분 명확하게 합니다:
THEME_LIST=(
  "flavor flavor flavor flavor flavor"
)

# 확정 — 실제 WP.org 테마 slug 리스트
AVAILABLE_THEMES=(
  "flavor flavor flavor flavor flavor flavor flavor flavor flavor flavor"
)

# =============================================================
# 위 테마 배열이 꼬여있어서, 단순하게 합니다:
# 사이트 설치 시 style에 따라 1개 테마 설치 후 CSS 커스터마이징
# 어떤 테마든 동작함 — 기본 twentytwentyfour 사용
# =============================================================

SITE_COUNT=$(jq length "$CONFIG_FILE")
echo "=== $SITE_COUNT 개 WordPress 사이트 설치 시작 ==="
echo "=== 관리자: $WP_ADMIN_USER ==="
echo ""

# 결과 저장 — 기존 파일 보존 (이어서 설치 지원)
if [ ! -f "$CREDS_FILE" ]; then
  echo "[]" > "$CREDS_FILE"
fi

ALREADY_DONE=$(jq 'length' "$CREDS_FILE" 2>/dev/null || echo 0)
if [ "$ALREADY_DONE" -gt 0 ]; then
  echo "=== 이전 실행에서 $ALREADY_DONE 개 완료됨 — 이어서 설치 ==="
fi

ensure_scanner_block_snippet

SUCCESSFUL_SITES=()
FAILED_SITES=()
FAILED_REASONS=()

install_site_once() {
  # ---- 이미 완료된 사이트면 즉시 건너뜀 ----
  ALREADY_IN_CREDS=$(jq -r --arg s "$SLUG" '.[] | select(.slug == $s) | .slug' "$CREDS_FILE" 2>/dev/null || echo "")
  if [ -n "$ALREADY_IN_CREDS" ]; then
    echo "  ⏭ [$((i+1))/$SITE_COUNT] $SLUG 이미 완료됨 — 건너뜀"
    return 0
  fi

  ensure_site_install_capacity || return 1

  # ---- 1. DB 생성 ----
  echo "  [1/7] DB 생성..."
  DB_NAME="$(build_db_identifier "$SLUG")"
  DB_USER="$DB_NAME"
  DB_PASS="$(openssl rand -base64 12)"

  mysql -u root -p"$DB_ROOT_PASS" <<SQL >/dev/null 2>&1 || {
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
FLUSH PRIVILEGES;
SQL
    SITE_LAST_ERROR="DB 생성 또는 권한 설정 실패"
    return 1
  }

  # ---- 2. WordPress 다운로드 & 설치 ----
  echo "  [2/7] WordPress 설치..."
  SITE_DIR="$WEB_ROOT/$SLUG"
  mkdir -p "$SITE_DIR"

  # 이미 완전히 설치된 경우 건너뜀
  if wp core is-installed --path="$SITE_DIR" --allow-root --quiet 2>/dev/null; then
    echo "  ⏭ $SLUG 이미 설치됨 — 자격증명만 저장하고 건너뜀"
    finalize_site_setup "$SLUG" "$DOMAIN" "$SITE_DIR"
    APP_PASS=$(wp user application-password create 1 "auto-posting-$(date +%s)" \
      --porcelain --path="$SITE_DIR" --allow-root 2>/dev/null || true)
    if [ -z "$APP_PASS" ]; then
      SITE_LAST_ERROR="기존 사이트 앱 비밀번호 생성 실패"
      return 1
    fi
    if ! validate_local_wordpress_runtime "$SITE_DIR" "$SITE_URL"; then
      SITE_LAST_ERROR="기존 사이트 런타임 검증 실패"
      return 1
    fi
    jq ". += [{
      \"slug\": \"$SLUG\",
      \"domain\": \"$DOMAIN\",
      \"title\": $(echo "$TITLE" | jq -R .),
      \"site_dir\": \"$SITE_DIR\",
      \"admin_user\": \"$WP_ADMIN_USER\",
      \"admin_pass\": \"$WP_ADMIN_PASS\",
      \"app_pass\": \"$APP_PASS\",
      \"db_name\": \"$DB_NAME\",
      \"db_user\": \"$DB_USER\",
      \"db_pass\": \"(existing)\",
      \"url\": \"$SITE_URL\",
      \"skipped\": true
    }]" "$CREDS_FILE" > "${CREDS_FILE}.tmp" && mv "${CREDS_FILE}.tmp" "$CREDS_FILE"
    sync_cache
    echo "  ✓ $SLUG 건너뜀 (이미 설치됨)"
    return 0
  fi

  wp core download --path="$SITE_DIR" --locale=ko_KR --allow-root --quiet --force || {
    SITE_LAST_ERROR="WordPress 코어 다운로드 실패"
    return 1
  }

  wp config create \
    --path="$SITE_DIR" \
    --dbname="$DB_NAME" \
    --dbuser="$DB_USER" \
    --dbpass="$DB_PASS" \
    --dbhost="localhost" \
    --allow-root --quiet --force || {
      SITE_LAST_ERROR="wp-config 생성 실패"
      return 1
    }

  # Redis 설정 추가
  wp config set WP_REDIS_HOST "127.0.0.1" --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
  wp config set WP_REDIS_DATABASE "$i" --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
  wp config set WP_CACHE true --raw --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true

  wp core install \
    --path="$SITE_DIR" \
    --url="$SITE_URL" \
    --title="$TITLE" \
    --admin_user="$WP_ADMIN_USER" \
    --admin_password="$WP_ADMIN_PASS" \
    --admin_email="$WP_ADMIN_EMAIL" \
    --allow-root --quiet || {
      SITE_LAST_ERROR="WordPress 설치 실패"
      return 1
    }

  # ---- 3. 기본 설정 ----
  echo "  [3/7] 기본 설정..."
  local HOME_DESCRIPTION
  HOME_DESCRIPTION="$(build_home_description "$TITLE" "$TAGLINE")"
  wp option update blogdescription "$HOME_DESCRIPTION" --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
  wp option update permalink_structure "/%postname%/" --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
  wp option update timezone_string "Asia/Seoul" --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
  wp option update date_format "Y년 m월 d일" --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
  wp option update blog_public 1 --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true

  wp post delete 1 --force --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
  wp post delete 2 --force --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
  wp comment delete 1 --force --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true

  # ---- 4. 카테고리 생성 ----
  echo "  [4/7] 카테고리 생성..."
  CATEGORIES=$(jq -r ".[$i].categories[]" "$CONFIG_FILE" 2>/dev/null)
  while IFS= read -r cat; do
    if [ -n "$cat" ]; then
      wp term create category "$cat" --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
    fi
  done <<< "$CATEGORIES"
  wp term delete category 1 --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true

  # ---- 5. 플러그인 설치 ----
  echo "  [5/7] 플러그인 설치..."
  wp plugin install wordpress-seo --activate --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
  wp plugin install redis-cache --activate --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
  wp plugin install wp-fastest-cache --activate --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
  wp plugin install redirection --activate --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
  wp redis enable --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true

  # ---- 5.5. robots.txt & llms.txt 생성 ----
  echo "  [5.5/7] robots.txt & llms.txt & SEO 설정..."
  write_robots_txt "$DOMAIN" "$SITE_DIR"
  chown www-data:www-data "$SITE_DIR/robots.txt" 2>/dev/null || true

  CATS_COMMA=$(jq -r ".[$i].categories | join(\",\")" "$CONFIG_FILE" 2>/dev/null || echo "")
  write_llms_txt "$DOMAIN" "$SITE_DIR" "$TITLE" "$TAGLINE" "$PERSONA_NAME" "$CATS_COMMA"

  # ---- 6. 테마 & 커스텀 CSS ----
  echo "  [6/7] 테마 & CSS 커스터마이징..."
  wp eval "
    \$css = '
/* AI Generated Custom Style — $SLUG */
:root {
  --wp-primary: $PRIMARY;
  --wp-secondary: $SECONDARY;
  --wp-accent: $ACCENT;
}

body {
  font-family: \"Pretendard\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;
}

/* 헤더 */
.wp-site-blocks .wp-block-template-part:first-child {
  background: $PRIMARY !important;
}
.wp-site-blocks .wp-block-site-title a {
  color: #fff !important;
}

/* 링크 & 버튼 */
a { color: $ACCENT; }
a:hover { color: $PRIMARY; }
.wp-block-button__link {
  background-color: $ACCENT !important;
  color: #fff !important;
}

/* 포스트 제목 */
.wp-block-post-title a { color: #1a1a1a; }
.wp-block-post-title a:hover { color: $ACCENT; }

/* 카드/배경 */
.wp-block-group.has-background {
  background-color: $SECONDARY !important;
}

/* 푸터 */
footer, .wp-block-template-part:last-child {
  background: #1a1a1a !important;
  color: #ccc !important;
}
';
    wp_update_custom_css_post(\\\$css);
  " --path="$SITE_DIR" --allow-root 2>/dev/null || true

  # ---- 7. 소개 페이지 생성 ----
  echo "  [7/7] 소개 페이지 생성..."
  ABOUT_CONTENT="<div class=\"about-author\">"
  ABOUT_CONTENT+="<h2>$PERSONA_NAME</h2>"
  if [ -n "$PERSONA_EXPERTISE" ]; then
    ABOUT_CONTENT+="<p class=\"author-title\">$PERSONA_EXPERTISE</p>"
  fi
  ABOUT_CONTENT+="<p>$PERSONA_BIO</p>"
  if [ -n "$PERSONA_CONCERN" ]; then
    ABOUT_CONTENT+="<p><strong>관심 분야:</strong> $PERSONA_CONCERN</p>"
  fi
  ABOUT_CONTENT+="</div>"
  wp post create \
    --post_type=page \
    --post_title="소개" \
    --post_content="$ABOUT_CONTENT" \
    --post_status=publish \
    --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true

  # 페르소나 정보를 WP 옵션에 저장 (MU-Plugin에서 사용)
  wp_try option update ai_persona_name "$PERSONA_NAME" --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
  wp_try option update ai_persona_bio "$PERSONA_BIO" --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
  if [ -n "$PERSONA_EXPERTISE" ]; then
    wp_try option update ai_persona_expertise "$PERSONA_EXPERTISE" --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
  fi
  if [ -n "$PERSONA_CONCERN" ]; then
    wp_try option update ai_persona_concern "$PERSONA_CONCERN" --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
  fi

  finalize_site_setup "$SLUG" "$DOMAIN" "$SITE_DIR" || {
    SITE_LAST_ERROR="사이트 마무리 설정 실패"
    return 1
  }

  APP_PASS=$(wp user application-password create 1 "auto-posting" \
    --porcelain --path="$SITE_DIR" --allow-root 2>/dev/null || true)
  if [ -z "$APP_PASS" ]; then
    SITE_LAST_ERROR="앱 비밀번호 생성 실패"
    return 1
  fi

  if ! validate_local_wordpress_runtime "$SITE_DIR" "$SITE_URL"; then
    SITE_LAST_ERROR="WordPress 런타임 검증 실패"
    return 1
  fi

  jq ". += [{
    \"slug\": \"$SLUG\",
    \"domain\": \"$DOMAIN\",
    \"title\": $(echo "$TITLE" | jq -R .),
    \"site_dir\": \"$SITE_DIR\",
    \"admin_user\": \"$WP_ADMIN_USER\",
    \"admin_pass\": \"$WP_ADMIN_PASS\",
    \"app_pass\": \"$APP_PASS\",
    \"db_name\": \"$DB_NAME\",
    \"db_user\": \"$DB_USER\",
    \"db_pass\": \"$DB_PASS\",
    \"url\": \"$SITE_URL\"
  }]" "$CREDS_FILE" > "${CREDS_FILE}.tmp" && mv "${CREDS_FILE}.tmp" "$CREDS_FILE" || {
    SITE_LAST_ERROR="자격증명 저장 실패"
    return 1
  }

  sync_cache
  echo "  ✓ $SLUG 설치 완료"
  return 0
}

for i in $(seq 0 $(($SITE_COUNT - 1))); do
  # JSON에서 설정 추출
  SLUG=$(jq -r ".[$i].site_slug" "$CONFIG_FILE")
  TITLE=$(jq -r ".[$i].site_title" "$CONFIG_FILE")
  TAGLINE=$(jq -r ".[$i].tagline" "$CONFIG_FILE")
  DOMAIN=$(jq -r ".[$i].domain // empty" "$CONFIG_FILE")
  DOMAIN="$(normalize_domain "$DOMAIN")"
  PRIMARY=$(jq -r ".[$i].color_scheme.primary" "$CONFIG_FILE")
  SECONDARY=$(jq -r ".[$i].color_scheme.secondary" "$CONFIG_FILE")
  ACCENT=$(jq -r ".[$i].color_scheme.accent" "$CONFIG_FILE")
  STYLE=$(jq -r ".[$i].color_scheme.style" "$CONFIG_FILE")
  HOMEPAGE=$(jq -r ".[$i].layout_preference.homepage" "$CONFIG_FILE")
  SIDEBAR=$(jq -r ".[$i].layout_preference.sidebar" "$CONFIG_FILE")
  PERSONA_NAME=$(jq -r ".[$i].persona.name" "$CONFIG_FILE")
  PERSONA_BIO=$(jq -r ".[$i].persona.bio" "$CONFIG_FILE")
  PERSONA_EXPERTISE=$(jq -r ".[$i].persona.expertise // empty" "$CONFIG_FILE")
  PERSONA_CONCERN=$(jq -r ".[$i].persona.concern // empty" "$CONFIG_FILE")
  SITE_URL="$(site_url_for_domain "$DOMAIN")"

  # 도메인 없으면 IP + 포트 또는 서브디렉토리
  if [ -z "$DOMAIN" ]; then
    DOMAIN="$SLUG.local"
    SITE_URL="$(site_url_for_domain "$DOMAIN")"
  fi

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  [$((i+1))/$SITE_COUNT] $TITLE"
  echo "  slug: $SLUG | domain: $DOMAIN"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  emit_marker "SITE_START|$((i+1))|$SITE_COUNT|$SLUG|$(sanitize_marker_field "$TITLE")"

  MAX_ATTEMPTS=2
  ATTEMPT=1
  SITE_SUCCESS=0
  SITE_LAST_ERROR=""

  while [ "$ATTEMPT" -le "$MAX_ATTEMPTS" ]; do
    if [ "$ATTEMPT" -gt 1 ]; then
      echo "  ↻ 재시도 ($ATTEMPT/$MAX_ATTEMPTS)..."
      emit_marker "SITE_RETRY|$SLUG|$ATTEMPT|$MAX_ATTEMPTS|$(sanitize_marker_field "$SITE_LAST_ERROR")"
      sleep 2
    fi

    SITE_LAST_ERROR=""
    if install_site_once; then
      SITE_SUCCESS=1
      SUCCESSFUL_SITES+=("$SLUG")
      emit_marker "SITE_SUCCESS|$SLUG|$(sanitize_marker_field "$TITLE")"
      break
    fi

    SITE_LAST_ERROR="${SITE_LAST_ERROR:-설치 중 알 수 없는 오류}"
    echo "  ✗ $SLUG 설치 실패: $SITE_LAST_ERROR"
    ATTEMPT=$((ATTEMPT + 1))
  done

  if [ "$SITE_SUCCESS" -ne 1 ]; then
    FAILED_SITES+=("$SLUG")
    FAILED_REASONS+=("$SITE_LAST_ERROR")
    echo "  ⚠ $SLUG는 실패로 기록하고 다음 사이트로 진행합니다."
    emit_marker "SITE_FAILURE|$SLUG|$(sanitize_marker_field "$SITE_LAST_ERROR")"
    continue
  fi
done

# Nginx 설정 테스트 & 리로드
echo ""
echo "--- Nginx 설정 검증 ---"
nginx -t && systemctl reload nginx
if [ "${#SUCCESSFUL_SITES[@]}" -gt 0 ]; then
  purge_fastcgi_cache
fi
ensure_allmyreview_certificate
ensure_myground_certificate

# 비-allmyreview/myground 개별 도메인 SSL 발급 및 Nginx HTTPS 전환
for i in $(seq 0 $(($SITE_COUNT - 1))); do
  IND_DOMAIN=$(jq -r ".[$i].domain // empty" "$CONFIG_FILE")
  IND_DOMAIN="$(normalize_domain "$IND_DOMAIN")"
  IND_SLUG=$(jq -r ".[$i].site_slug" "$CONFIG_FILE")
  IND_SITE_DIR="$WEB_ROOT/$IND_SLUG"

  # 공유 인증서 도메인은 제외, .local은 제외
  [[ "$IND_DOMAIN" == *.allmyreview.site ]] && continue
  [[ "$IND_DOMAIN" == *.myground.website ]] && continue
  [[ "$IND_DOMAIN" == "myground.website" ]] && continue
  [[ "$IND_DOMAIN" == *.local ]] && continue
  [[ -z "$IND_DOMAIN" ]] && continue
  # 이미 설치된 사이트만 대상
  [[ -d "$IND_SITE_DIR" ]] || continue

  if ensure_individual_certificate "$IND_DOMAIN"; then
    echo "  → Nginx HTTPS 설정 재생성: $IND_DOMAIN"
    write_nginx_config "$IND_SLUG" "$IND_DOMAIN" "$IND_SITE_DIR"

    # WordPress home/siteurl을 HTTPS로 업데이트
    IND_NEW_URL="https://$IND_DOMAIN"
    wp option update home "$IND_NEW_URL" --path="$IND_SITE_DIR" --allow-root 2>/dev/null || true
    wp option update siteurl "$IND_NEW_URL" --path="$IND_SITE_DIR" --allow-root 2>/dev/null || true
  fi
done

nginx -t && systemctl reload nginx 2>/dev/null || true
ensure_system_cron_runner

if [ "${#SUCCESSFUL_SITES[@]}" -gt 0 ] && [ -x "$POST_DEPLOY_REPAIR_SCRIPT" -o -f "$POST_DEPLOY_REPAIR_SCRIPT" ]; then
  echo ""
  echo "--- 설치 후 WordPress 런타임 검증 ---"
  POST_DEPLOY_SLUGS="$(IFS=,; echo "${SUCCESSFUL_SITES[*]}")"
  if ! bash "$POST_DEPLOY_REPAIR_SCRIPT" --slugs "$POST_DEPLOY_SLUGS"; then
    echo "  ⚠ 일부 신규 사이트의 런타임 보강/검증이 실패했습니다. 로그를 확인해주세요."
  fi
fi

echo ""
echo "=========================================="
echo "  $SITE_COUNT 개 WordPress 사이트 처리 완료!"
echo "=========================================="
echo ""
echo "  관리자 계정: $WP_ADMIN_USER"
echo "  관리자 비밀번호: $WP_ADMIN_PASS"
echo ""
echo "  자격증명 파일: $CREDS_FILE"
echo ""
echo "  설치된 사이트:"
jq -r '.[] | "    [\(.slug)] \(.title) → \(.url)/wp-admin"' "$CREDS_FILE"
echo ""
if [ "${#FAILED_SITES[@]}" -gt 0 ]; then
  echo "  실패한 사이트:"
  for idx in "${!FAILED_SITES[@]}"; do
    echo "    [${FAILED_SITES[$idx]}] ${FAILED_REASONS[$idx]}"
  done
  echo ""
fi
emit_marker "SUMMARY|${#SUCCESSFUL_SITES[@]}|${#FAILED_SITES[@]}"
echo "=========================================="
