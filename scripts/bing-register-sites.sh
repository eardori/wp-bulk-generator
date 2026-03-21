#!/bin/bash
# bing-register-sites.sh
# Bing Webmaster Tools API로 모든 WP 사이트를 일괄 등록 + 사이트맵 제출
#
# 사용법:
#   sudo BING_API_KEY=your_key bash /home/ubuntu/wp-bulk-generator/scripts/bing-register-sites.sh
#
# 필수 환경변수:
#   BING_API_KEY  — Bing Webmaster Tools > Settings > API Access 에서 발급
#
# 선택 환경변수:
#   WEB_ROOT      — WordPress 사이트 루트 (기본: /var/www)
#   CREDS_FILE    — 배포된 사이트 인증 파일 (기본: /root/wp-sites-credentials.json)
#   DRY_RUN       — 1로 설정하면 API 호출 없이 대상 목록만 출력

set -uo pipefail

# ── 설정 ─────────────────────────────────────────────────────────────────────
BING_API_KEY="${BING_API_KEY:-}"
WEB_ROOT="${WEB_ROOT:-/var/www}"
CREDS_FILE="${CREDS_FILE:-/root/wp-sites-credentials.json}"
DRY_RUN="${DRY_RUN:-0}"
BING_API_BASE="https://ssl.bing.com/webmaster/api.svc/json"

SUCCESS=0
SKIPPED=0
FAILED=0
ALREADY=0

# ── 유효성 검사 ───────────────────────────────────────────────────────────────
if [ -z "$BING_API_KEY" ]; then
  echo "❌ BING_API_KEY 환경변수가 필요합니다."
  echo "   Bing Webmaster Tools → Settings → API Access 에서 발급 후:"
  echo "   BING_API_KEY=your_key bash bing-register-sites.sh"
  exit 1
fi

if ! command -v curl &>/dev/null; then
  echo "❌ curl이 필요합니다: apt-get install -y curl"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "❌ jq가 필요합니다: apt-get install -y jq"
  exit 1
fi

echo ""
echo "══════════════════════════════════════════════════════"
echo "  🔍 Bing Webmaster 일괄 등록"
echo "══════════════════════════════════════════════════════"
[ "$DRY_RUN" = "1" ] && echo "  ⚠  DRY_RUN 모드 — 실제 API 호출 없음"
echo ""

# ── 도메인 수집 ───────────────────────────────────────────────────────────────
# 1) 인증 파일에서 수집
# 2) WP-CLI로 설치된 사이트에서 실제 URL 수집 (fallback)
collect_domains() {
  local domains=()

  # CREDS_FILE에서
  if [ -f "$CREDS_FILE" ]; then
    while IFS= read -r domain; do
      [ -n "$domain" ] && domains+=("$domain")
    done < <(jq -r '.[] | .domain // empty' "$CREDS_FILE" 2>/dev/null || true)
  fi

  # WP-CLI에서 (WP 설치된 모든 디렉토리 순회)
  if command -v wp &>/dev/null; then
    for site_dir in "$WEB_ROOT"/*/; do
      [ -d "$site_dir" ] || continue
      if wp core is-installed --path="$site_dir" --allow-root --quiet 2>/dev/null; then
        local url
        url=$(wp option get siteurl --path="$site_dir" --allow-root 2>/dev/null || true)
        if [ -n "$url" ]; then
          # https:// 보장, 마지막 슬래시 추가
          url="${url%/}/"
          url="${url#http://}"
          url="https://${url#https://}"
          domains+=("$url")
        fi
      fi
    done
  fi

  # 중복 제거 후 출력
  printf '%s\n' "${domains[@]}" | sort -u
}

# ── Bing API 헬퍼 ─────────────────────────────────────────────────────────────
bing_get_sites() {
  curl -sf \
    "${BING_API_BASE}/GetSites?apikey=${BING_API_KEY}" \
    -H "Content-Type: application/json; charset=utf-8" 2>/dev/null || echo "{}"
}

bing_add_site() {
  local site_url="$1"
  curl -sf -X POST \
    "${BING_API_BASE}/AddSite?apikey=${BING_API_KEY}" \
    -H "Content-Type: application/json; charset=utf-8" \
    -d "{\"siteUrl\":\"${site_url}\"}" 2>/dev/null || echo "{}"
}

bing_add_sitemap() {
  local site_url="$1"
  local sitemap_url="${site_url%/}/sitemap_index.xml"
  curl -sf -X POST \
    "${BING_API_BASE}/AddSitemap?apikey=${BING_API_KEY}" \
    -H "Content-Type: application/json; charset=utf-8" \
    -d "{\"siteUrl\":\"${site_url}\",\"sitemap\":{\"IsAutoDiscovered\":false,\"LastUpdated\":\"/Date(0)/\",\"Url\":\"${sitemap_url}\"}}" \
    2>/dev/null || echo "{}"
}

# ── 이미 등록된 사이트 목록 캐시 ─────────────────────────────────────────────
echo "  🔄 현재 등록된 사이트 조회 중..."
existing_json=$(bing_get_sites)
existing_sites=$(echo "$existing_json" | jq -r '.d[]?.Url // empty' 2>/dev/null || true)
echo "  ✅ 기 등록 사이트 수: $(echo "$existing_sites" | grep -c '.' || echo 0)"
echo ""

# ── 메인 루프 ─────────────────────────────────────────────────────────────────
echo "  📋 등록 대상 사이트 수집 중..."
mapfile -t domains < <(collect_domains)

if [ "${#domains[@]}" -eq 0 ]; then
  echo "  ⚠  등록할 사이트를 찾지 못했습니다."
  echo "     - CREDS_FILE=$CREDS_FILE 파일을 확인하세요."
  echo "     - WP-CLI가 없을 경우 수동으로 DOMAINS 변수에 도메인을 지정할 수 있습니다."
  exit 1
fi

echo "  📌 총 ${#domains[@]}개 사이트 처리 시작"
echo ""

for domain in "${domains[@]}"; do
  # URL 정규화 (https://, 마지막 / 보장)
  domain="${domain%/}/"
  [[ "$domain" == https://* ]] || domain="https://${domain#http://}"

  echo "  ──────────────────────────────────────────"
  echo "  🌐 $domain"

  # 이미 등록 여부 확인
  if echo "$existing_sites" | grep -qF "$domain"; then
    echo "     ↷ 이미 등록됨 — 사이트맵만 재제출"
    ((ALREADY++)) || true
    if [ "$DRY_RUN" = "1" ]; then
      echo "     [DRY_RUN] sitemap 제출 건너뜀"
      continue
    fi
    sitemap_result=$(bing_add_sitemap "$domain")
    echo "     📨 사이트맵 제출 완료"
    continue
  fi

  if [ "$DRY_RUN" = "1" ]; then
    echo "     [DRY_RUN] AddSite + AddSitemap 건너뜀"
    ((SUCCESS++)) || true
    continue
  fi

  # 사이트 등록
  add_result=$(bing_add_site "$domain")
  error_code=$(echo "$add_result" | jq -r '.ErrorCode // 0' 2>/dev/null || echo "0")

  if [ "$error_code" != "0" ] && [ "$error_code" != "null" ]; then
    echo "     ⚠  AddSite 오류 (code=$error_code) — 건너뜀"
    ((FAILED++)) || true
    continue
  fi

  echo "     ✅ 사이트 등록 완료"
  sleep 0.3  # API rate limit 방지

  # 사이트맵 제출
  sitemap_result=$(bing_add_sitemap "$domain")
  sitemap_error=$(echo "$sitemap_result" | jq -r '.ErrorCode // 0' 2>/dev/null || echo "0")

  if [ "$sitemap_error" != "0" ] && [ "$sitemap_error" != "null" ]; then
    echo "     ⚠  AddSitemap 오류 (code=$sitemap_error)"
    ((SKIPPED++)) || true
  else
    echo "     📨 사이트맵 제출 완료"
    ((SUCCESS++)) || true
  fi

  sleep 0.3  # API rate limit 방지
done

# ── 결과 요약 ─────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════"
echo "  📊 완료 요약"
echo "══════════════════════════════════════════════════════"
echo "  ✅ 신규 등록 성공 : $SUCCESS"
echo "  🔁 기 등록 (사이트맵 재제출) : $ALREADY"
echo "  ⚠  사이트맵 오류 : $SKIPPED"
echo "  ❌ 실패 : $FAILED"
echo ""
echo "  ℹ️  소유권 미인증 사이트는 Bing meta tag가 먼저 필요합니다."
echo "      신규 배포/백필: BING_SITE_VERIFICATION 환경변수를 설정하면"
echo "      deploy-wp-sites.sh / backfill-existing-sites.sh 가 자동으로"
echo "      <meta name=\"msvalidate.01\" content=\"...\" /> 를 출력합니다."
echo ""
echo "      기존 운영 사이트 일괄 반영:"
echo "      sudo BING_VERIFY_CODE=your_code bash /home/ubuntu/wp-bulk-generator/scripts/bing-add-meta-tag.sh"
echo ""
