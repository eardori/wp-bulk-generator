#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/wp-bulk-generator/admin}"
APP_NAME="${APP_NAME:-wp-bulk-generator}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-3000}"
PHP_SERVICE="${PHP_SERVICE:-php8.2-fpm}"
STOP_PHP_DURING_BUILD="${STOP_PHP_DURING_BUILD:-0}"
SWAPFILE="${SWAPFILE:-/swapfile}"
SWAP_MB="${SWAP_MB:-2048}"
NODE_HEAP_MB="${NODE_HEAP_MB:-768}"
RELEASE_ROOT="${RELEASE_ROOT:-/home/ubuntu/wp-admin-builds}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BUILD_DIR="${RELEASE_ROOT}/${TIMESTAMP}"
LIVE_NEXT="${APP_DIR}/.next"

php_was_stopped=0

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

  if ! sudo -n grep -qF "${SWAPFILE} none swap sw 0 0" /etc/fstab; then
    echo "${SWAPFILE} none swap sw 0 0" | sudo -n tee -a /etc/fstab >/dev/null
  fi
}

restore_php() {
  if [ "${php_was_stopped}" -eq 1 ]; then
    sudo -n systemctl start "${PHP_SERVICE}"
    php_was_stopped=0
  fi
}

cleanup_on_error() {
  local exit_code=$?
  if [ "${exit_code}" -ne 0 ]; then
    restore_php
    rm -rf "${BUILD_DIR}"
  fi
  exit "${exit_code}"
}

trap cleanup_on_error EXIT

ensure_swap
mkdir -p "${RELEASE_ROOT}"
rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}"

if [ "${STOP_PHP_DURING_BUILD}" = "1" ]; then
  sudo -n systemctl stop "${PHP_SERVICE}"
  php_was_stopped=1
fi

cd "${APP_DIR}"
NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS="--max-old-space-size=${NODE_HEAP_MB}" NEXT_DIST_DIR="${BUILD_DIR}" \
  ./node_modules/.bin/next build --webpack

test -f "${BUILD_DIR}/BUILD_ID"

if [ -L "${LIVE_NEXT}" ]; then
  ln -sfn "${BUILD_DIR}" "${LIVE_NEXT}"
else
  rm -rf "${LIVE_NEXT}"
  ln -s "${BUILD_DIR}" "${LIVE_NEXT}"
fi

pm2 delete "${APP_NAME}-fallback" >/dev/null 2>&1 || true

if pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
  pm2 restart "${APP_NAME}" --update-env
else
  pm2 start npm --name "${APP_NAME}" --cwd "${APP_DIR}" -- start -- --hostname "${HOST}" --port "${PORT}"
fi
pm2 save >/dev/null

restore_php
