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

# Percent-decode userinfo so URLs like mariadb://u%40v:p%21ss@host/db
# parse as u@v / p!ss. Matches the Node loader.
urldecode() {
  local s="${1//+/ }"
  printf '%b' "${s//%/\\x}"
}

user="${MARIADB_USER:-}"; password="${MARIADB_PASSWORD:-}"
if [ -n "$userinfo" ]; then
  user="$(urldecode "${userinfo%%:*}")"
  [[ "$userinfo" == *:* ]] && password="$(urldecode "${userinfo#*:}")"
fi
if [ -z "$db" ]; then
  echo "error: MARIADB_URL must include /<database>" >&2
  exit 2
fi
# Bash precedence: '||' binds tighter than '&&' would not — write the
# guards as an explicit `if` so each missing var fails its own check.
if [ -z "$user" ]; then
  echo "error: missing MARIADB_USER (or embed user in URL)" >&2
  exit 2
fi
if [ -z "$password" ]; then
  echo "error: missing MARIADB_PASSWORD (or embed password in URL)" >&2
  exit 2
fi

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
