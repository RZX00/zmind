#!/bin/bash
# =============================================================================
# postgres 镜像的 docker-entrypoint-initdb.d 钩子。
#
# 只在数据目录为空（首次启动）时执行。存在的意义只有一个：把两个角色密码从环境
# 变量安全地喂给 00-roles-extensions.sql——密码不能写死在 SQL 里，也不能用
# current_setting() 取（initdb 阶段还没有自定义 GUC）。
#
# 注意 SQL 文件挂在 /opt/zmind-init/ 而不是 initdb.d：entrypoint 会把 initdb.d 下
# 的 *.sql 也自动执行一遍，那次执行没有 -v 注入的变量，CREATE ROLE 会直接失败。
# =============================================================================
set -euo pipefail

: "${AUTHENTICATOR_PASSWORD:?AUTHENTICATOR_PASSWORD 未设置}"
: "${AUTH_ADMIN_PASSWORD:?AUTH_ADMIN_PASSWORD 未设置}"

psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" \
     --dbname "$POSTGRES_DB" \
     -v authenticator_password="$AUTHENTICATOR_PASSWORD" \
     -v auth_admin_password="$AUTH_ADMIN_PASSWORD" \
     -f /opt/zmind-init/00-roles-extensions.sql

echo "[init] 角色 / extensions schema / 扩展 就绪"
