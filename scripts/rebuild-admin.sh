#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/wp-bulk-generator/admin}"
APP_NAME="${APP_NAME:-wp-bulk-generator}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-3000}"
SWAPFILE="${SWAPFILE:-/swapfile}"
SWAP_MB="${SWAP_MB:-2048}"
NODE_HEAP_MB="${NODE_HEAP_MB:-768}"

ensure_swap() {
  if sudo -n swapon --show | tail -n +2 | grep -q .; then
    return
  fi

  if [ ! -f "${SWAPFILE}" ]; then
    sudo -n fallocate -l "${SWAP_MB}M" "${SWAPFILE}" 2>/dev/null || \
      sudo -n dd if=/dev/zero of="${SWAPFILE}" bs=1M count="${SWAP_MB}" status=progress
    sudo -n chmod 600 "${SWAPFILE}"
    sudo -n mkswap "${SWAPFILE}" >/dev/null
  fi

  sudo -n swapon "${SWAPFILE}" || true
}

ensure_swap

cd "${APP_DIR}"
echo "=== Admin 빌드 시작 ==="
NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS="--max-old-space-size=${NODE_HEAP_MB}" \
  ./node_modules/.bin/next build --webpack

# 빌드 성공 확인
if [ ! -f "${APP_DIR}/.next/BUILD_ID" ]; then
  echo "✗ 빌드 실패 — .next/BUILD_ID 없음"
  exit 1
fi
echo "✓ 빌드 성공 (BUILD_ID: $(cat "${APP_DIR}/.next/BUILD_ID"))"

# pm2 재시작
pm2 delete "${APP_NAME}-fallback" >/dev/null 2>&1 || true

if pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
  pm2 restart "${APP_NAME}" --update-env
  echo "✓ pm2 재시작 완료"
else
  pm2 start npm --name "${APP_NAME}" --cwd "${APP_DIR}" -- start -- --hostname "${HOST}" --port "${PORT}"
  echo "✓ pm2 새로 시작"
fi
pm2 save >/dev/null

echo "=== Admin 배포 완료 ==="
