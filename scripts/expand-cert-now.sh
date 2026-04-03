#!/bin/bash
# expand-cert-now.sh
# 기존 인증서의 모든 도메인 + 신규 15개 도메인으로 certbot 확장 실행
set -uo pipefail

CERT_NAME="allmyreview-primary-sites"
CERT_DIR="/etc/letsencrypt/live/$CERT_NAME"

echo "=== 기존 인증서 도메인 수집 ==="
EXISTING="$(openssl x509 -in "$CERT_DIR/fullchain.pem" -noout -text 2>/dev/null \
  | grep -oP 'DNS:[^\s,]+' \
  | sed 's/DNS://' \
  | sort -u)"

echo "기존 도메인: $(echo "$EXISTING" | wc -l)개"

# 새로 추가할 15개 도메인
NEW_DOMAINS=(
  epicure-galbi.allmyreview.site
  family-friendly.allmyreview.site
  family-meat-gui.allmyreview.site
  galbi-holic.allmyreview.site
  galbi-vibe.allmyreview.site
  gourmet-korea-t.allmyreview.site
  korea-foodie-ma.allmyreview.site
  korea-meat-atla.allmyreview.site
  meat-insights.allmyreview.site
  meokbang-diary.allmyreview.site
  mz-trend-eats.allmyreview.site
  savvy-galbi.allmyreview.site
  seoul-galbi-gui.allmyreview.site
  solo-eater-diar.allmyreview.site
  wacky-meat-hunt.allmyreview.site
)

echo ""
echo "=== 추가할 신규 도메인: ${#NEW_DOMAINS[@]}개 ==="
for d in "${NEW_DOMAINS[@]}"; do
  echo "  + $d"
done

# 전체 도메인 목록 구성
ALL_DOMAINS="$(
  {
    echo "$EXISTING"
    for d in "${NEW_DOMAINS[@]}"; do
      echo "$d"
    done
  } | sort -u
)"

TOTAL="$(echo "$ALL_DOMAINS" | grep -c '.' || true)"
echo ""
echo "전체 도메인: ${TOTAL}개"

# certbot 명령어 구성
CERTBOT_ARGS=(
  certbot certonly
  --nginx
  --non-interactive
  --agree-tos
  --register-unsafely-without-email
  --cert-name "$CERT_NAME"
  --expand
)

while IFS= read -r domain; do
  [ -z "$domain" ] && continue
  CERTBOT_ARGS+=(-d "$domain")
done <<< "$ALL_DOMAINS"

echo ""
echo "=== certbot 실행 ==="
echo "명령어: ${CERTBOT_ARGS[*]}"
echo ""

if "${CERTBOT_ARGS[@]}"; then
  echo ""
  echo "✓ 인증서 갱신 성공!"
  nginx -t && systemctl reload nginx
  echo "✓ nginx 리로드 완료"
  
  # 검증
  echo ""
  echo "=== 검증 ==="
  for d in "${NEW_DOMAINS[@]}"; do
    if openssl x509 -in "$CERT_DIR/fullchain.pem" -noout -text 2>/dev/null | grep -Fq "DNS:$d"; then
      echo "  ✓ $d - 인증서에 포함됨"
    else
      echo "  ✗ $d - 인증서에 미포함!"
    fi
  done
else
  echo ""
  echo "✗ certbot 실패!"
  exit 1
fi
