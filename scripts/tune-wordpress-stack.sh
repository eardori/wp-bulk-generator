#!/bin/bash
# Apply conservative PHP-FPM tuning for the WordPress host.

set -euo pipefail

cat > /etc/php/8.2/fpm/pool.d/optimized.conf <<'PHPFPM'
[www]
user = www-data
group = www-data
listen = /run/php/php8.2-fpm.sock
listen.owner = www-data
listen.group = www-data

pm = ondemand
pm.max_children = 7
pm.process_idle_timeout = 30s
pm.max_requests = 300
request_terminate_timeout = 120s

php_admin_value[opcache.enable] = 1
php_admin_value[opcache.memory_consumption] = 64
php_admin_value[opcache.interned_strings_buffer] = 8
php_admin_value[opcache.max_accelerated_files] = 4000
php_admin_value[opcache.validate_timestamps] = 0
php_admin_value[opcache.revalidate_freq] = 60

php_admin_value[memory_limit] = 128M
php_admin_value[upload_max_filesize] = 32M
php_admin_value[post_max_size] = 32M
php_admin_value[max_execution_time] = 300
PHPFPM

rm -f /etc/php/8.2/fpm/pool.d/www.conf

systemctl restart php8.2-fpm
systemctl --no-pager --full status php8.2-fpm | sed -n '1,20p'
