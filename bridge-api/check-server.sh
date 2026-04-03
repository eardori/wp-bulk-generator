#!/bin/bash
echo "=== CPU ==="
nproc
lscpu | grep -E "Model name|CPU MHz"
echo "=== RAM ==="
free -h | head -2
echo "=== DISK ==="
df -h / | tail -1
echo "=== SITES ==="
ls -d /var/www/*/ 2>/dev/null | wc -l
echo "=== LOAD ==="
uptime
echo "=== PHP/NGINX ==="
php -v 2>/dev/null | head -1
nginx -v 2>&1
echo "=== MYSQL ==="
mysql --version 2>/dev/null || echo "N/A"
