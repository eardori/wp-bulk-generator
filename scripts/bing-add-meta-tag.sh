#!/bin/bash
# bing-add-meta-tag.sh
# 모든 WP 사이트에 Bing 소유권 인증 메타태그를 일괄 주입
# (wp-cli의 wp option / custom_css 방식으로 functions.php 수정 없이 처리)
#
# 사용법:
#   sudo BING_VERIFY_CODE=your_code bash /home/ubuntu/wp-bulk-generator/scripts/bing-add-meta-tag.sh
#
# 필수 환경변수:
#   BING_VERIFY_CODE — Bing Webmaster Tools → Settings → Users → Verify → Meta Tag 의 content 값

set -uo pipefail

BING_VERIFY_CODE="${BING_VERIFY_CODE:-}"
WEB_ROOT="${WEB_ROOT:-/var/www}"
DRY_RUN="${DRY_RUN:-0}"

SUCCESS=0
SKIPPED=0
FAILED=0

if [ -z "$BING_VERIFY_CODE" ]; then
  echo "❌ BING_VERIFY_CODE 환경변수가 필요합니다."
  echo "   Bing Webmaster Tools → 사이트 선택 → Settings → Users → Verify"
  echo "   → Meta Tag 옵션의 content=\"...\" 값을 복사하세요."
  echo ""
  echo "   BING_VERIFY_CODE=ABCDEF1234 bash bing-add-meta-tag.sh"
  exit 1
fi

if ! command -v wp &>/dev/null; then
  echo "❌ wp-cli가 필요합니다."
  exit 1
fi

META_TAG="<meta name=\"msvalidate.01\" content=\"${BING_VERIFY_CODE}\" />"
# wp_head 훅에 메타태그를 출력하는 PHP 코드
PHP_CODE="add_action('wp_head', function() { echo '${META_TAG}' . PHP_EOL; }, 1);"

echo ""
echo "══════════════════════════════════════════════════════"
echo "  🔖 Bing 인증 메타태그 일괄 주입"
echo "══════════════════════════════════════════════════════"
[ "$DRY_RUN" = "1" ] && echo "  ⚠  DRY_RUN 모드"
echo "  메타태그: $META_TAG"
echo ""

for site_dir in "$WEB_ROOT"/*/; do
  [ -d "$site_dir" ] || continue

  if ! wp core is-installed --path="$site_dir" --allow-root --quiet 2>/dev/null; then
    continue
  fi

  site_url=$(wp option get siteurl --path="$site_dir" --allow-root 2>/dev/null || echo "unknown")
  echo "  🌐 $site_url"

  # 이미 적용됐는지 확인
  existing=$(wp option get bing_verify_meta --path="$site_dir" --allow-root 2>/dev/null || echo "")
  if [ "$existing" = "$BING_VERIFY_CODE" ]; then
    echo "     ↷ 이미 적용됨"
    ((SKIPPED++)) || true
    continue
  fi

  if [ "$DRY_RUN" = "1" ]; then
    echo "     [DRY_RUN] 적용 건너뜀"
    ((SUCCESS++)) || true
    continue
  fi

  # wp-cli로 메타태그를 wp_head 훅에 주입 (mu-plugins 방식)
  MU_DIR="${site_dir}wp-content/mu-plugins"
  mkdir -p "$MU_DIR"

  cat > "${MU_DIR}/bing-verify.php" << PHPEOF
<?php
/* Bing Webmaster 소유권 인증 — 자동 생성됨 (bing-add-meta-tag.sh) */
add_action( 'wp_head', function () {
    echo '<meta name="msvalidate.01" content="${BING_VERIFY_CODE}" />' . PHP_EOL;
}, 1 );
PHPEOF

  # 적용 여부 wp option에 기록 (중복 실행 방지용)
  wp option update bing_verify_meta "$BING_VERIFY_CODE" \
    --path="$site_dir" --allow-root --quiet 2>/dev/null || true

  echo "     ✅ mu-plugins/bing-verify.php 생성 완료"
  ((SUCCESS++)) || true
done

echo ""
echo "══════════════════════════════════════════════════════"
echo "  📊 완료 요약"
echo "══════════════════════════════════════════════════════"
echo "  ✅ 적용 완료 : $SUCCESS"
echo "  ↷ 이미 적용됨 : $SKIPPED"
echo "  ❌ 실패 : $FAILED"
echo ""
echo "  📌 다음 단계:"
echo "     1. bing-register-sites.sh 실행으로 Bing에 사이트 일괄 등록"
echo "     2. Bing Webmaster Tools에서 인증 확인 (수분 소요)"
echo ""
