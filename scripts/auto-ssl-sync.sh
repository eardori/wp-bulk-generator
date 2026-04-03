#!/bin/bash
# auto-ssl-sync.sh
# Nginx에 설정된 모든 *.allmyreview.site 도메인을 감지하고
# Let's Encrypt 인증서에 자동으로 추가하는 스크립트.
# cron에 등록하여 새 사이트 추가 시 자동 SSL을 보장합니다.
#
# 사용법:
#   sudo bash auto-ssl-sync.sh          # 일반 실행
#   sudo bash auto-ssl-sync.sh --dry    # dry-run (변경 없이 상태만 표시)

set -uo pipefail

DRY_RUN=0
if [ "${1:-}" = "--dry" ] || [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
fi

LOCK_FILE="/tmp/auto-ssl-sync.lock"
LOG_FILE="/var/log/auto-ssl-sync.log"

# 다른 인스턴스가 이미 실행 중이면 종료
if [ -f "$LOCK_FILE" ]; then
  LOCK_PID="$(cat "$LOCK_FILE" 2>/dev/null || true)"
  if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') 이미 다른 인스턴스 실행 중 (PID=$LOCK_PID)" | tee -a "$LOG_FILE"
    exit 0
  fi
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG_FILE"
}

# ---- 서버 역할 감지 ----
SERVER_ROLE_FILE="/etc/wp-bulk-server-role"
SERVER_ROLE=""
if [ -f "$SERVER_ROLE_FILE" ]; then
  SERVER_ROLE="$(tr -d '\r\n' < "$SERVER_ROLE_FILE")"
fi

case "$SERVER_ROLE" in
  primary)   CERT_NAME="allmyreview-primary-sites" ;;
  secondary) CERT_NAME="allmyreview-secondary-sites" ;;
  *)         CERT_NAME="allmyreview-sites" ;;
esac

CERT_DIR="/etc/letsencrypt/live/$CERT_NAME"
MAX_DOMAINS="${ALLMYREVIEW_CERT_MAX_NAMES:-100}"

# ---- 1. Nginx 설정에서 모든 *.allmyreview.site 도메인 수집 ----
collect_nginx_domains() {
  grep -rh 'server_name' /etc/nginx/sites-enabled/ 2>/dev/null \
    | tr ';' '\n' \
    | grep -oP '[a-z0-9][-a-z0-9]*\.allmyreview\.site' \
    | sort -u
}

# ---- 2. /var/www 에서 WP home URL 기반 도메인 수집 ----
collect_wp_domains() {
  for site_dir in /var/www/*/; do
    [ -f "$site_dir/wp-config.php" ] || continue
    local home
    home="$(timeout 8 wp option get home --path="$site_dir" --allow-root 2>/dev/null || true)"
    home="${home#https://}"
    home="${home#http://}"
    home="${home%%/*}"
    if [[ "$home" == *.allmyreview.site ]]; then
      echo "$home"
    fi
  done | sort -u
}

# ---- 3. 현재 인증서에 포함된 도메인 ----
collect_cert_domains() {
  if [ -f "$CERT_DIR/fullchain.pem" ]; then
    openssl x509 -in "$CERT_DIR/fullchain.pem" -noout -text 2>/dev/null \
      | grep -oP 'DNS:[^\s,]+' \
      | sed 's/DNS://' \
      | sort -u
  fi
}

# ---- 실행 ----
log "===== SSL 동기화 시작 (서버역할=$SERVER_ROLE, 인증서=$CERT_NAME) ====="

# 모든 소스에서 도메인 수집 후 합치기
ALL_DOMAINS="$(
  {
    collect_nginx_domains
    collect_wp_domains
    collect_cert_domains
  } | sort -u
)"

DOMAIN_COUNT="$(echo "$ALL_DOMAINS" | grep -c '.' || true)"
log "수집된 전체 도메인: ${DOMAIN_COUNT}개"

if [ "$DOMAIN_COUNT" -eq 0 ]; then
  log "도메인이 없으므로 종료"
  exit 0
fi

if [ "$DOMAIN_COUNT" -gt "$MAX_DOMAINS" ]; then
  log "⚠ 도메인 ${DOMAIN_COUNT}개 > 최대 ${MAX_DOMAINS}개. wildcard 인증서 전환이 필요합니다."
  exit 1
fi

# 현재 인증서에 없는 도메인 찾기
CERT_DOMAINS="$(collect_cert_domains)"
MISSING=()
while IFS= read -r domain; do
  [ -z "$domain" ] && continue
  if ! echo "$CERT_DOMAINS" | grep -Fxq "$domain"; then
    MISSING+=("$domain")
  fi
done <<< "$ALL_DOMAINS"

if [ "${#MISSING[@]}" -eq 0 ]; then
  log "✓ 모든 도메인이 인증서에 포함되어 있음. 변경 필요 없음."
  exit 0
fi

log "누락된 도메인 ${#MISSING[@]}개 발견:"
for d in "${MISSING[@]}"; do
  log "  + $d"
done

if [ "$DRY_RUN" -eq 1 ]; then
  log "[DRY-RUN] certbot 실행을 건너뜁니다."
  exit 0
fi

# certbot 명령어 구성
CERTBOT_ARGS=(
  certbot certonly
  --nginx
  --non-interactive
  --agree-tos
  --register-unsafely-without-email
  --cert-name "$CERT_NAME"
)

if [ -f "$CERT_DIR/fullchain.pem" ]; then
  CERTBOT_ARGS+=(--expand)
fi

while IFS= read -r domain; do
  [ -z "$domain" ] && continue
  CERTBOT_ARGS+=(-d "$domain")
done <<< "$ALL_DOMAINS"

log "certbot 실행 중..."
if "${CERTBOT_ARGS[@]}" >> "$LOG_FILE" 2>&1; then
  log "✓ 인증서 갱신 성공"
  # nginx 설정 검증 후 리로드
  if nginx -t 2>/dev/null; then
    systemctl reload nginx
    log "✓ nginx 리로드 완료"
  else
    log "⚠ nginx 설정 검증 실패. 수동 확인 필요."
  fi
else
  log "✗ certbot 실행 실패"
  exit 1
fi

log "===== SSL 동기화 완료 ====="
