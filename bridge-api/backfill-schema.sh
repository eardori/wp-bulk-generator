#!/bin/bash
# 기존 사이트 중 aeo-schema.php가 없는 사이트에 Organization Schema 자동 설치
set -euo pipefail

INSTALLED=0
SKIPPED=0

for site_dir in /var/www/*/; do
  [ -d "$site_dir" ] || continue
  [ -f "$site_dir/wp-config.php" ] || continue

  schema_file="$site_dir/wp-content/mu-plugins/aeo-schema.php"

  if [ -f "$schema_file" ]; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # 사이트 정보 가져오기
  site_title="$(wp option get blogname --path="$site_dir" --allow-root 2>/dev/null || true)"
  home_url="$(wp option get home --path="$site_dir" --allow-root 2>/dev/null || true)"

  if [ -z "$site_title" ] || [ -z "$home_url" ]; then
    echo "SKIP: $site_dir (정보 없음)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # 특수문자 이스케이프
  escaped_title="$(printf '%s' "$site_title" | sed "s/'/\\\\'/g" | sed 's/"/\\\\"/g')"

  mkdir -p "$site_dir/wp-content/mu-plugins"
  cat > "$schema_file" << SCHEMAPHP
<?php
/**
 * Plugin Name: AEO Schema (JSON-LD)
 * Description: Auto-generated Organization Schema for AEO optimization
 * Version: 1.0
 * Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
 */

add_action('wp_head', function() {
    echo '<script type="application/ld+json">' . PHP_EOL;
    echo '{ "@context": "https://schema.org", "@type": "Organization", "name": "${escaped_title}", "url": "${home_url}" }' . PHP_EOL;
    echo '</script>' . PHP_EOL;
}, 1);
SCHEMAPHP

  chown www-data:www-data "$schema_file"
  chmod 644 "$schema_file"
  INSTALLED=$((INSTALLED + 1))
  echo "OK: $site_title ($home_url)"
done

echo "---"
echo "설치: ${INSTALLED}개, 건너뜀: ${SKIPPED}개"
