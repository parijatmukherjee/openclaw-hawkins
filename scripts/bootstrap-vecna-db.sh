#!/usr/bin/env bash
# bootstrap-vecna-db.sh — apply vecna/schema.sql to the configured MariaDB.
# Reads the same env vars as the Node library (see vecna/spec.md §7).

set -euo pipefail

if [ -z "${MARIADB_URL:-}" ]; then
  echo "error: MARIADB_URL is required (e.g. mariadb://host:3306/hawkins)" >&2
  exit 2
fi

url="${MARIADB_URL#mariadb://}"; url="${url#mysql://}"
userinfo=""; if [[ "$url" == *@* ]]; then userinfo="${url%%@*}"; url="${url#*@}"; fi
hostport="${url%%/*}"; db="${url#*/}"; db="${db%%\?*}"
host="${hostport%%:*}"; port="3306"
[[ "$hostport" == *:* ]] && port="${hostport##*:}"
user="${MARIADB_USER:-}"; password="${MARIADB_PASSWORD:-}"
if [ -n "$userinfo" ]; then
  user="${userinfo%%:*}"
  [[ "$userinfo" == *:* ]] && password="${userinfo#*:}"
fi
[ -z "$db" ] && { echo "error: MARIADB_URL must include /<database>" >&2; exit 2; }
[ -z "$user" ] || [ -z "$password" ] && { echo "error: missing MARIADB_USER / MARIADB_PASSWORD" >&2; exit 2; }

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
schema="$script_dir/../vecna/schema.sql"
[ ! -f "$schema" ] && { echo "error: schema not found at $schema" >&2; exit 1; }

ssl_args=()
case "${MARIADB_SSL:-preferred}" in
  disabled) ssl_args+=("--ssl=0") ;;
  insecure) ssl_args+=("--ssl" "--ssl-verify-server-cert=FALSE") ;;
  preferred|required) ssl_args+=("--ssl") ;;
  *) echo "error: MARIADB_SSL must be disabled|preferred|required|insecure" >&2; exit 2 ;;
esac

client=""
for c in mariadb mysql; do
  command -v "$c" >/dev/null 2>&1 && { client="$c"; break; }
done
[ -z "$client" ] && { echo "error: neither 'mariadb' nor 'mysql' client found on PATH" >&2; exit 1; }

echo "applying $schema → ${user}@${host}:${port}/${db} (ssl=${MARIADB_SSL:-preferred})"
MYSQL_PWD="$password" "$client" -h "$host" -P "$port" -u "$user" "${ssl_args[@]}" "$db" < "$schema"
echo "ok"
