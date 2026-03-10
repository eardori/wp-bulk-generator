#!/bin/bash
# setup-server.sh
# VPS 초기 세팅 — Nginx + PHP 8.2 + MariaDB + WP-CLI + Redis
# Ubuntu 22.04/24.04 전용

set -euo pipefail

echo "=== WordPress 대량 호스팅 서버 세팅 시작 ==="

# ---- 0. Swap 추가 (RAM 부족 대비) ----
if [ ! -f /swapfile ]; then
  echo "--- Swap 4GB 생성 ---"
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Swap 사용 최소화 (RAM 우선)
  sysctl vm.swappiness=10
  echo 'vm.swappiness=10' >> /etc/sysctl.conf
  echo "Swap 4GB 추가 완료"
else
  echo "Swap 이미 존재함 — 스킵"
fi

# ---- 1. 패키지 업데이트 ----
echo "--- 패키지 업데이트 ---"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

# ---- 2. Nginx 설치 ----
echo "--- Nginx 설치 ---"
apt-get install -y nginx
systemctl enable nginx
systemctl start nginx

# ---- 3. PHP 8.2 + 필수 모듈 설치 ----
echo "--- PHP 8.2 설치 ---"
apt-get install -y software-properties-common
add-apt-repository -y ppa:ondrej/php
apt-get update -y
apt-get install -y \
  php8.2-fpm \
  php8.2-mysql \
  php8.2-curl \
  php8.2-gd \
  php8.2-mbstring \
  php8.2-xml \
  php8.2-zip \
  php8.2-intl \
  php8.2-soap \
  php8.2-bcmath \
  php8.2-redis \
  php8.2-imagick \
  php8.2-opcache

# PHP-FPM 최적화 (저메모리 환경)
cat > /etc/php/8.2/fpm/pool.d/optimized.conf << 'PHPFPM'
[www]
user = www-data
group = www-data
listen = /run/php/php8.2-fpm.sock
listen.owner = www-data
listen.group = www-data

; 저메모리 최적화 — ondemand로 유휴 시 메모리 해제
pm = ondemand
pm.max_children = 7
pm.process_idle_timeout = 30s
pm.max_requests = 300
request_terminate_timeout = 120s

; OPcache 최적화
php_admin_value[opcache.enable] = 1
php_admin_value[opcache.memory_consumption] = 64
php_admin_value[opcache.interned_strings_buffer] = 8
php_admin_value[opcache.max_accelerated_files] = 4000
php_admin_value[opcache.validate_timestamps] = 0
php_admin_value[opcache.revalidate_freq] = 60

; 메모리 제한
php_admin_value[memory_limit] = 128M
php_admin_value[upload_max_filesize] = 32M
php_admin_value[post_max_size] = 32M
php_admin_value[max_execution_time] = 300
PHPFPM

# 기본 www pool 제거 (중복 방지)
rm -f /etc/php/8.2/fpm/pool.d/www.conf

systemctl enable php8.2-fpm
systemctl restart php8.2-fpm

# ---- 4. MariaDB 설치 ----
echo "--- MariaDB 설치 ---"
apt-get install -y mariadb-server mariadb-client

# MariaDB 메모리 최적화
cat > /etc/mysql/mariadb.conf.d/99-optimized.cnf << 'MARIADB'
[mysqld]
# 저메모리 최적화
innodb_buffer_pool_size = 128M
innodb_log_file_size = 32M
innodb_flush_log_at_trx_commit = 2
innodb_flush_method = O_DIRECT

# 쿼리 캐시
query_cache_type = 1
query_cache_size = 16M
query_cache_limit = 1M

# 커넥션
max_connections = 50
wait_timeout = 60
interactive_timeout = 60

# 임시 테이블
tmp_table_size = 16M
max_heap_table_size = 16M

# 문자셋
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci
MARIADB

systemctl enable mariadb
systemctl restart mariadb

# MariaDB root 비밀번호 설정
DB_ROOT_PASS="WpBulk$(openssl rand -hex 8)"
mysql -u root -e "ALTER USER 'root'@'localhost' IDENTIFIED BY '$DB_ROOT_PASS'; FLUSH PRIVILEGES;" 2>/dev/null || true

echo "DB_ROOT_PASS=$DB_ROOT_PASS" > /root/.wp-bulk-credentials
chmod 600 /root/.wp-bulk-credentials

# ---- 5. Redis 설치 ----
echo "--- Redis 설치 ---"
apt-get install -y redis-server

# Redis 메모리 제한
sed -i 's/^# maxmemory .*/maxmemory 32mb/' /etc/redis/redis.conf
sed -i 's/^# maxmemory-policy .*/maxmemory-policy allkeys-lru/' /etc/redis/redis.conf

systemctl enable redis-server
systemctl restart redis-server

# ---- 6. WP-CLI 설치 ----
echo "--- WP-CLI 설치 ---"
curl -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar
chmod +x wp-cli.phar
mv wp-cli.phar /usr/local/bin/wp

# WP-CLI 동작 확인
wp --info --allow-root

# ---- 7. jq 설치 (JSON 파싱용) ----
apt-get install -y jq

# ---- 8. Certbot (SSL) 설치 ----
echo "--- Certbot 설치 ---"
apt-get install -y certbot python3-certbot-nginx

# ---- 9. Nginx 기본 설정 최적화 ----
cat > /etc/nginx/nginx.conf << 'NGINXCONF'
user www-data;
worker_processes auto;
pid /run/nginx.pid;
include /etc/nginx/modules-enabled/*.conf;

events {
    worker_connections 512;
    multi_accept on;
}

http {
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 30;
    types_hash_max_size 2048;
    server_tokens off;

    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # 로그
    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;

    # Gzip 압축
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 4;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;

    # FastCGI 캐시 설정
    fastcgi_cache_path /tmp/nginx-cache levels=1:2 keys_zone=WPCACHE:32m max_size=256m inactive=60m;
    fastcgi_cache_key "$scheme$request_method$host$request_uri";

    # 버퍼 최적화
    client_max_body_size 32m;
    fastcgi_buffers 16 16k;
    fastcgi_buffer_size 32k;

    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/sites-enabled/*;
}
NGINXCONF

# 기본 사이트 제거
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl restart nginx

# ---- 10. 웹 루트 디렉토리 생성 ----
mkdir -p /var/www
chown www-data:www-data /var/www

# ---- 11. 방화벽 설정 ----
echo "--- 방화벽 설정 ---"
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# ---- 완료 ----
echo ""
echo "=========================================="
echo "  서버 세팅 완료!"
echo "=========================================="
echo "  Nginx:    $(nginx -v 2>&1)"
echo "  PHP:      $(php -v | head -1)"
echo "  MariaDB:  $(mysql --version)"
echo "  Redis:    $(redis-cli --version)"
echo "  WP-CLI:   $(wp --version --allow-root)"
echo ""
echo "  DB Root 비밀번호: $DB_ROOT_PASS"
echo "  (저장 위치: /root/.wp-bulk-credentials)"
echo ""
echo "  Swap: $(free -h | grep Swap | awk '{print $2}')"
echo "=========================================="
