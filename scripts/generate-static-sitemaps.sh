#!/usr/bin/env bash
set -euo pipefail

CREDS_FILE="${CREDS_FILE:-/root/wp-sites-credentials.json}"

xml_escape() {
  local value="${1:-}"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  value="${value//\"/&quot;}"
  value="${value//\'/&apos;}"
  printf '%s' "$value"
}

build_sitemap() {
  local domain="$1"
  local site_url="$2"
  local site_dir="$3"
  local wp_config="$site_dir/wp-config.php"
  local db_name
  local db_user
  local db_pass
  local posts_tmp

  if [ ! -f "$wp_config" ]; then
    echo "  ⚠ wp-config.php 없음: $site_dir"
    return 0
  fi

  db_name="$(sed -n "s/.*define( 'DB_NAME', '\\([^']*\\)' ).*/\\1/p" "$wp_config" | head -n 1)"
  db_user="$(sed -n "s/.*define( 'DB_USER', '\\([^']*\\)' ).*/\\1/p" "$wp_config" | head -n 1)"
  db_pass="$(sed -n "s/.*define( 'DB_PASSWORD', '\\([^']*\\)' ).*/\\1/p" "$wp_config" | head -n 1)"

  if [ -z "$db_name" ] || [ -z "$db_user" ]; then
    echo "  ⚠ DB 설정 해석 실패: $domain"
    return 0
  fi

  local sitemap_path="$site_dir/sitemap_index.xml"
  local tmp_path="${sitemap_path}.tmp"
  local now_utc
  now_utc="$(date -u +%FT%TZ)"
  posts_tmp="$(mktemp)"

  cat > "$tmp_path" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>$(xml_escape "${site_url%/}/")</loc>
    <lastmod>$now_utc</lastmod>
  </url>
XML

  if ! MYSQL_PWD="$db_pass" mysql \
    --batch \
    --skip-column-names \
    -u "$db_user" \
    "$db_name" \
    -e "SELECT post_name, DATE_FORMAT(COALESCE(NULLIF(post_modified_gmt, '0000-00-00 00:00:00'), NULLIF(post_date_gmt, '0000-00-00 00:00:00'), UTC_TIMESTAMP()), '%Y-%m-%dT%H:%i:%sZ') FROM wp_posts WHERE post_type='post' AND post_status='publish' AND post_name <> '' ORDER BY COALESCE(NULLIF(post_modified_gmt, '0000-00-00 00:00:00'), NULLIF(post_date_gmt, '0000-00-00 00:00:00')) DESC LIMIT 1000;" \
    > "$posts_tmp"; then
    echo "  ⚠ 게시글 조회 실패, 홈만 포함: $domain"
  fi

  while IFS=$'\t' read -r post_slug lastmod; do
        [ -n "$post_slug" ] || continue
        cat >> "$tmp_path" <<XML
  <url>
    <loc>$(xml_escape "${site_url%/}/$post_slug/")</loc>
    <lastmod>${lastmod:-$now_utc}</lastmod>
  </url>
XML
      done < "$posts_tmp"

  cat >> "$tmp_path" <<XML
</urlset>
XML

  rm -f "$posts_tmp"
  mv "$tmp_path" "$sitemap_path"
  chown www-data:www-data "$sitemap_path" 2>/dev/null || true
  chmod 644 "$sitemap_path" 2>/dev/null || true

  echo "  ✓ sitemap 생성: $domain"
}

mapfile -t SITES < <(jq -c '.[]' "$CREDS_FILE")

echo "=== 정적 sitemap 생성 시작 (${#SITES[@]}개) ==="

for site_json in "${SITES[@]}"; do
  slug="$(jq -r '.slug' <<<"$site_json")"
  domain="$(jq -r '.domain' <<<"$site_json")"
  site_url="$(jq -r '.url' <<<"$site_json")"
  site_dir="$(jq -r '.site_dir' <<<"$site_json")"
  if [ -z "$slug" ] || [ -z "$domain" ] || [ -z "$site_url" ] || [ -z "$site_dir" ]; then
    echo "  ⚠ 누락된 설정: $slug / $domain"
    continue
  fi

  if [ ! -d "$site_dir" ]; then
    echo "  ⚠ 사이트 디렉토리 없음: $site_dir"
    continue
  fi

  build_sitemap "$domain" "$site_url" "$site_dir"
done

echo "=== 정적 sitemap 생성 완료 ==="
