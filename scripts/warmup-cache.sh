#!/usr/bin/env bash
# warmup-cache.sh — WP Fastest Cache 웜업 스크립트
# 사용법: ./scripts/warmup-cache.sh [credentials-json-path]
set -euo pipefail

CREDS_FILE="${1:-/root/wp-sites-credentials.json}"

if [[ ! -f "$CREDS_FILE" ]]; then
  echo "❌ credentials 파일을 찾을 수 없습니다: $CREDS_FILE"
  exit 1
fi

# jq 확인
if ! command -v jq &>/dev/null; then
  echo "❌ jq가 설치되어 있지 않습니다. apt install jq"
  exit 1
fi

# URL 목록 추출
URLS=$(jq -r '.[].siteUrl // empty' "$CREDS_FILE" | sed 's|/$||')

if [[ -z "$URLS" ]]; then
  echo "❌ credentials 파일에 siteUrl이 없습니다."
  exit 1
fi

TOTAL=$(echo "$URLS" | wc -l | tr -d ' ')
echo "🔥 캐시 웜업 시작 — 총 ${TOTAL}개 사이트 (병렬 10)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

SUCCESS=0
FAIL=0
FAIL_LIST=""

warmup_site() {
  local url="$1"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$url")
  if [[ "$status" =~ ^(200|301|302)$ ]]; then
    echo "  ✅ ${url} (${status})"
    return 0
  else
    echo "  ❌ ${url} (${status})"
    return 1
  fi
}
export -f warmup_site

# 병렬 실행 & 결과 집계
RESULTS_FILE=$(mktemp)
echo "$URLS" | xargs -I {} -P 10 bash -c '
  if warmup_site "$1"; then
    echo "OK" >> "'"$RESULTS_FILE"'"
  else
    echo "FAIL $1" >> "'"$RESULTS_FILE"'"
  fi
' _ {}

# 결과 집계
SUCCESS=$(grep -c "^OK" "$RESULTS_FILE" 2>/dev/null || echo 0)
FAIL=$(grep -c "^FAIL" "$RESULTS_FILE" 2>/dev/null || echo 0)
FAIL_LIST=$(grep "^FAIL" "$RESULTS_FILE" 2>/dev/null | awk '{print $2}' || true)

rm -f "$RESULTS_FILE"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 웜업 결과: 성공 ${SUCCESS} / 실패 ${FAIL} / 전체 ${TOTAL}"

if [[ -n "$FAIL_LIST" ]]; then
  echo ""
  echo "❌ 실패 사이트:"
  echo "$FAIL_LIST" | while read -r u; do echo "  - $u"; done
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
