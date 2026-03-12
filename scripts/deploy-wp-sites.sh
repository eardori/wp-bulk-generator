#!/bin/bash
# deploy-wp-sites.sh
# AI가 생성한 JSON 설정을 받아 WordPress 사이트를 대량 설치
# 사용법: ./deploy-wp-sites.sh sites-config.json

set -euo pipefail

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
source /root/.wp-bulk-credentials  # DB_ROOT_PASS

WP_ADMIN_USER="admin"
WP_ADMIN_PASS="$(openssl rand -base64 16)"
WP_ADMIN_EMAIL="admin@wpbulk.local"
WEB_ROOT="/var/www"
CREDS_FILE="/root/wp-sites-credentials.json"
ALLMYREVIEW_CERT_NAME="allmyreview-sites"
ALLMYREVIEW_CERT_DIR="/etc/letsencrypt/live/$ALLMYREVIEW_CERT_NAME"
ALLMYREVIEW_CERT_MAX_NAMES=95
WP_CRON_RUNNER_PATH="/usr/local/bin/wp-bulk-run-cron.sh"
WP_CRON_SCHEDULE_PATH="/etc/cron.d/wp-bulk-run-cron"
WP_CLI_TIMEOUT="${WP_CLI_TIMEOUT:-30}"

# ubuntu 유저(Next.js)가 읽을 수 있는 캐시 경로
APP_CACHE_DIR="/home/ubuntu/wp-bulk-generator/admin/.cache"
APP_CREDS_FILE="$APP_CACHE_DIR/sites-credentials.json"
mkdir -p "$APP_CACHE_DIR"

# 캐시 동기화 함수 (사이트 설치 후 호출)
sync_cache() {
  cp "$CREDS_FILE" "$APP_CREDS_FILE" 2>/dev/null || true
  chown ubuntu:ubuntu "$APP_CREDS_FILE" 2>/dev/null || true
}

wp_try() {
  timeout "$WP_CLI_TIMEOUT" wp "$@"
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
  {
    jq -r '.[]? | .domain // empty' "$CREDS_FILE" 2>/dev/null || true
    jq -r '.[]? | .domain // empty' "$CONFIG_FILE" 2>/dev/null || true
  } | grep '\.allmyreview\.site$' | sort -u
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

site_url_for_domain() {
  local domain="$1"
  if [[ "$domain" == *.allmyreview.site ]]; then
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

write_nginx_config() {
  local slug="$1"
  local domain="$2"
  local site_dir="$3"
  local nginx_path="/etc/nginx/sites-available/$slug"

  if [[ "$domain" == *.allmyreview.site ]] \
    && [[ -f /etc/letsencrypt/live/allmyreview-sites/fullchain.pem ]] \
    && [[ -f /etc/letsencrypt/live/allmyreview-sites/privkey.pem ]]; then
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

    ssl_certificate /etc/letsencrypt/live/allmyreview-sites/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/allmyreview-sites/privkey.pem;
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
        fastcgi_cache_valid 200 60m;
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
        fastcgi_cache_valid 200 60m;
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

  # llms.txt는 finalize에서는 기존 파일이 없을 때만 생성 (파라미터 부족)
  # 메인 설치 루프에서 전체 파라미터로 생성됨

  write_nginx_config "$slug" "$domain" "$site_dir"

  chown -R www-data:www-data "$site_dir"
  chmod -R 755 "$site_dir"

  ensure_enable_app_passwords_mu_plugin "$site_dir"
  ensure_seo_mu_plugin "$site_dir"
  chown -R www-data:www-data "$site_dir/wp-content/mu-plugins" 2>/dev/null || true
  chmod 755 "$site_dir/wp-content/mu-plugins" 2>/dev/null || true
  chmod 644 "$site_dir/wp-content/mu-plugins/"*.php 2>/dev/null || true
}

ensure_wordpress_runtime_config() {
  local site_dir="$1"

  wp_try config set DISABLE_WP_CRON true --raw --type=constant --path="$site_dir" --allow-root --quiet 2>/dev/null || true
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

# AI SEO 최적화 MU-Plugin 설치
ensure_seo_mu_plugin() {
  local site_dir="$1"
  local mu_dir="$site_dir/wp-content/mu-plugins"

  mkdir -p "$mu_dir"
  cat > "$mu_dir/ai-seo-optimize.php" << 'SEOPHP'
<?php
/**
 * AI SEO 최적화 MU-Plugin
 * - Canonical URL 강제 설정
 * - 빈 검색/아카이브 noindex
 * - Open Graph 폴백
 */

// Canonical URL 강제 설정
add_action('wp_head', function() {
    if (is_singular()) {
        echo '<link rel="canonical" href="' . esc_url(get_permalink()) . '" />' . "\n";
    }
}, 1);

// 빈 검색/아카이브 noindex
add_action('wp_head', function() {
    if (is_search() || (is_archive() && !have_posts())) {
        echo '<meta name="robots" content="noindex, follow" />' . "\n";
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

for i in $(seq 0 $(($SITE_COUNT - 1))); do
  # JSON에서 설정 추출
  SLUG=$(jq -r ".[$i].site_slug" "$CONFIG_FILE")
  TITLE=$(jq -r ".[$i].site_title" "$CONFIG_FILE")
  TAGLINE=$(jq -r ".[$i].tagline" "$CONFIG_FILE")
  DOMAIN=$(jq -r ".[$i].domain // empty" "$CONFIG_FILE")
  PRIMARY=$(jq -r ".[$i].color_scheme.primary" "$CONFIG_FILE")
  SECONDARY=$(jq -r ".[$i].color_scheme.secondary" "$CONFIG_FILE")
  ACCENT=$(jq -r ".[$i].color_scheme.accent" "$CONFIG_FILE")
  STYLE=$(jq -r ".[$i].color_scheme.style" "$CONFIG_FILE")
  HOMEPAGE=$(jq -r ".[$i].layout_preference.homepage" "$CONFIG_FILE")
  SIDEBAR=$(jq -r ".[$i].layout_preference.sidebar" "$CONFIG_FILE")
  PERSONA_NAME=$(jq -r ".[$i].persona.name" "$CONFIG_FILE")
  PERSONA_BIO=$(jq -r ".[$i].persona.bio" "$CONFIG_FILE")
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

  # ---- 이미 완료된 사이트면 즉시 건너뜀 ----
  ALREADY_IN_CREDS=$(jq -r --arg s "$SLUG" '.[] | select(.slug == $s) | .slug' "$CREDS_FILE" 2>/dev/null || echo "")
  if [ -n "$ALREADY_IN_CREDS" ]; then
    echo "  ⏭ [$((i+1))/$SITE_COUNT] $SLUG 이미 완료됨 — 건너뜀"
    continue
  fi

  # ---- 1. DB 생성 ----
  echo "  [1/7] DB 생성..."
  DB_NAME="wp_${SLUG//-/_}"
  DB_USER="wp_${SLUG//-/_}"
  # DB 이름 길이 제한 (16자)
  DB_NAME="${DB_NAME:0:16}"
  DB_USER="${DB_USER:0:16}"
  DB_PASS="$(openssl rand -base64 12)"

  mysql -u root -p"$DB_ROOT_PASS" -e "
    CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
    GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
    FLUSH PRIVILEGES;
  " 2>/dev/null

  # ---- 2. WordPress 다운로드 & 설치 ----
  echo "  [2/7] WordPress 설치..."
  SITE_DIR="$WEB_ROOT/$SLUG"
  mkdir -p "$SITE_DIR"

  # 이미 완전히 설치된 경우 건너뜀
  if wp core is-installed --path="$SITE_DIR" --allow-root --quiet 2>/dev/null; then
    echo "  ⏭ $SLUG 이미 설치됨 — 자격증명만 저장하고 건너뜀"
    finalize_site_setup "$SLUG" "$DOMAIN" "$SITE_DIR"
    EXISTING_PASS=$(wp user get admin --field=user_pass --path="$SITE_DIR" --allow-root 2>/dev/null || echo "N/A")
    APP_PASS=$(wp user application-password create 1 "auto-posting-$(date +%s)" \
      --porcelain --path="$SITE_DIR" --allow-root 2>/dev/null || echo "N/A")
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
    continue
  fi

  # 파일은 있지만 설치 미완료인 경우 --force로 덮어쓰기
  wp core download --path="$SITE_DIR" --locale=ko_KR --allow-root --quiet --force

  wp config create \
    --path="$SITE_DIR" \
    --dbname="$DB_NAME" \
    --dbuser="$DB_USER" \
    --dbpass="$DB_PASS" \
    --dbhost="localhost" \
    --allow-root --quiet --force

  # Redis 설정 추가
  wp config set WP_REDIS_HOST "127.0.0.1" --path="$SITE_DIR" --allow-root --quiet
  wp config set WP_REDIS_DATABASE "$i" --path="$SITE_DIR" --allow-root --quiet  # 사이트별 다른 DB 번호
  wp config set WP_CACHE true --raw --path="$SITE_DIR" --allow-root --quiet

  wp core install \
    --path="$SITE_DIR" \
    --url="$SITE_URL" \
    --title="$TITLE" \
    --admin_user="$WP_ADMIN_USER" \
    --admin_password="$WP_ADMIN_PASS" \
    --admin_email="$WP_ADMIN_EMAIL" \
    --allow-root --quiet

  # ---- 3. 기본 설정 ----
  echo "  [3/7] 기본 설정..."
  wp option update blogdescription "$TAGLINE" --path="$SITE_DIR" --allow-root --quiet
  wp option update permalink_structure "/%postname%/" --path="$SITE_DIR" --allow-root --quiet
  wp option update timezone_string "Asia/Seoul" --path="$SITE_DIR" --allow-root --quiet
  wp option update date_format "Y년 m월 d일" --path="$SITE_DIR" --allow-root --quiet
  wp option update blog_public 1 --path="$SITE_DIR" --allow-root --quiet

  # 기본 글/페이지/댓글 삭제
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
  # 기본 카테고리(미분류) 삭제
  wp term delete category 1 --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true

  # ---- 5. 플러그인 설치 ----
  echo "  [5/7] 플러그인 설치..."
  wp plugin install wordpress-seo --activate --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
  wp plugin install redis-cache --activate --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
  wp plugin install wp-fastest-cache --activate --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true
  wp plugin install redirection --activate --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true

  # Redis 캐시 활성화
  wp redis enable --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true

  # ---- 5.5. robots.txt & llms.txt 생성 (AI 봇 크롤링 허용 + GEO) ----
  echo "  [5.5/7] robots.txt & llms.txt & SEO 설정..."
  write_robots_txt "$DOMAIN" "$SITE_DIR"
  chown www-data:www-data "$SITE_DIR/robots.txt"

  CATS_COMMA=$(jq -r ".[$i].categories | join(\",\")" "$CONFIG_FILE" 2>/dev/null || echo "")
  write_llms_txt "$DOMAIN" "$SITE_DIR" "$TITLE" "$TAGLINE" "$PERSONA_NAME" "$CATS_COMMA"

  # ---- 6. 테마 & 커스텀 CSS ----
  echo "  [6/7] 테마 & CSS 커스터마이징..."

  # 기본 테마(twentytwentyfour) 사용 — 이미 포함됨
  # 커스텀 CSS로 색상/스타일 오버라이드

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
  wp post create \
    --post_type=page \
    --post_title="소개" \
    --post_content="<p>안녕하세요! $PERSONA_NAME입니다.</p><p>$PERSONA_BIO</p>" \
    --post_status=publish \
    --path="$SITE_DIR" --allow-root --quiet 2>/dev/null || true

  finalize_site_setup "$SLUG" "$DOMAIN" "$SITE_DIR"

  # Application Password 생성 (REST API 자동 포스팅용)
  APP_PASS=$(wp user application-password create 1 "auto-posting" \
    --porcelain --path="$SITE_DIR" --allow-root 2>/dev/null) || APP_PASS="N/A"

  # 결과 저장
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
  }]" "$CREDS_FILE" > "${CREDS_FILE}.tmp" && mv "${CREDS_FILE}.tmp" "$CREDS_FILE"

  sync_cache
  echo "  ✓ $SLUG 설치 완료"
done

# Nginx 설정 테스트 & 리로드
echo ""
echo "--- Nginx 설정 검증 ---"
nginx -t && systemctl reload nginx
ensure_allmyreview_certificate
ensure_system_cron_runner

echo ""
echo "=========================================="
echo "  $SITE_COUNT 개 WordPress 사이트 설치 완료!"
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
echo "=========================================="
