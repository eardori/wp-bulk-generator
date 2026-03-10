#!/bin/bash
# seo-optimize-existing.sh
# 각 WP 사이트에서 wp eval-file로 PHP 스크립트 실행
# 사용법: sudo bash /home/ubuntu/wp-bulk-generator/scripts/seo-optimize-existing.sh

set -uo pipefail

WEB_ROOT="/var/www"
PHP_SCRIPT="/home/ubuntu/wp-bulk-generator/scripts/seo-optimize.php"
CONFIG_FILE="/home/ubuntu/wp-bulk-generator/configs/sites-config.json"
TOTAL_UPDATED=0
TOTAL_SKIPPED=0
TOTAL_ERRORS=0
TOTAL_POSTS=0

echo ""
echo "══════════════════════════════════════════════════"
echo "  📊 기존 WordPress 글 SEO 일괄 최적화 (WP-CLI)"
echo "══════════════════════════════════════════════════"
echo ""

for SITE_DIR in "$WEB_ROOT"/*/; do
  [ ! -d "$SITE_DIR" ] && continue

  if ! wp core is-installed --path="$SITE_DIR" --allow-root --quiet 2>/dev/null; then
    continue
  fi

  SITE_TITLE=$(wp option get blogname --path="$SITE_DIR" --allow-root 2>/dev/null || echo "Unknown")
  SITE_SLUG=$(basename "$SITE_DIR")

  # persona 이름 가져오기
  PERSONA_NAME="$SITE_TITLE"
  if [ -f "$CONFIG_FILE" ]; then
    FOUND=$(jq -r --arg s "$SITE_SLUG" '.[] | select(.site_slug == $s) | .persona.name // empty' "$CONFIG_FILE" 2>/dev/null || echo "")
    if [ -n "$FOUND" ]; then PERSONA_NAME="$FOUND"; fi
  fi

  # 글 수 확인
  POST_COUNT=$(wp post list --post_type=post --post_status=publish --format=count --path="$SITE_DIR" --allow-root 2>/dev/null || echo "0")

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  🔄 $SITE_TITLE ($POST_COUNT 개 글)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  if [ "$POST_COUNT" = "0" ]; then
    echo "  📝 글 없음"
    continue
  fi

  TOTAL_POSTS=$((TOTAL_POSTS + POST_COUNT))

  # PHP 스크립트 실행 (persona, site_title을 인자로)
  RESULT=$(wp eval-file "$PHP_SCRIPT" "$PERSONA_NAME" "$SITE_TITLE" \
    --path="$SITE_DIR" --allow-root 2>&1) || true

  # 결과 출력 (RESULT: 라인 제외)
  echo "$RESULT" | grep -v "^RESULT:"

  # 통계 추출
  STATS=$(echo "$RESULT" | grep "^RESULT:" | tail -1)
  if [ -n "$STATS" ]; then
    IFS=':' read -r _ UPD SKP ERR <<< "$STATS"
    TOTAL_UPDATED=$((TOTAL_UPDATED + UPD + 0))
    TOTAL_SKIPPED=$((TOTAL_SKIPPED + SKP + 0))
    TOTAL_ERRORS=$((TOTAL_ERRORS + ERR + 0))
  fi
done

echo ""
echo "══════════════════════════════════════════════════"
echo "  🎯 전체 결과"
echo "  📝 총 글: ${TOTAL_POSTS}개"
echo "  ✅ 업데이트: ${TOTAL_UPDATED}개"
echo "  ⏭ 스킵: ${TOTAL_SKIPPED}개"
echo "  ❌ 오류: ${TOTAL_ERRORS}개"
echo "══════════════════════════════════════════════════"
echo ""
