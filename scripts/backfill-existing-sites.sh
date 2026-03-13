#!/bin/bash
# Repair and normalize SEO/runtime settings for existing WordPress sites.

set -euo pipefail

CREDS_FILE="/root/wp-sites-credentials.json"
APP_CACHE_DIR="/home/ubuntu/wp-bulk-generator/admin/.cache"
APP_CREDS_FILE="$APP_CACHE_DIR/sites-credentials.json"
ALLMYREVIEW_CERT_NAME="allmyreview-sites"
ALLMYREVIEW_CERT_DIR="/etc/letsencrypt/live/$ALLMYREVIEW_CERT_NAME"
ALLMYREVIEW_CERT_MAX_NAMES=95
WP_CRON_RUNNER_PATH="/usr/local/bin/wp-bulk-run-cron.sh"
WP_CRON_SCHEDULE_PATH="/etc/cron.d/wp-bulk-run-cron"
WP_CLI_TIMEOUT="${WP_CLI_TIMEOUT:-20}"
WP_LIGHT_MODE="${WP_LIGHT_MODE:-1}"
REMOTE_VALIDATE_TIMEOUT="${REMOTE_VALIDATE_TIMEOUT:-12}"
TARGET_SLUGS_RAW=""

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
  chown ubuntu:ubuntu "$APP_CREDS_FILE" 2>/dev/null || true
}

wp_try() {
  timeout "$WP_CLI_TIMEOUT" wp "$@"
}

slug_selected() {
  local slug="$1"
  if [ "${#TARGET_SLUGS[@]}" -eq 0 ]; then
    return 0
  fi

  [[ -n "${TARGET_SLUGS[$slug]:-}" ]]
}

site_url_for_domain() {
  local domain="$1"
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
  jq -r '.[]? | .domain // empty' "$CREDS_FILE" 2>/dev/null | grep '\.allmyreview\.site$' | sort -u
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

add_action('wp_head', function() {
    if (is_singular()) {
        echo '<link rel="canonical" href="' . esc_url(get_permalink()) . '" />' . "\n";
    }
}, 1);

add_action('wp_head', function() {
    if (is_search() || (is_archive() && !have_posts())) {
        echo '<meta name="robots" content="noindex, follow" />' . "\n";
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

for i in $(seq 0 $((SITE_COUNT - 1))); do
  SLUG=$(jq -r ".[$i].slug" "$CREDS_FILE")
  DOMAIN=$(jq -r ".[$i].domain // empty" "$CREDS_FILE")
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
  if [ -n "$BF_TITLE" ]; then
    write_llms_txt "$DOMAIN" "$SITE_DIR" "$BF_TITLE" "$BF_TAGLINE" "$BF_PERSONA" "$BF_CATEGORIES"
  fi

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
