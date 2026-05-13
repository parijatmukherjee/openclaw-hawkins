#!/usr/bin/env bash
# bootstrap-vines-db.sh — apply vines/schema.sql to the configured MariaDB.
#
# Reads the same env vars as the Node library (see vines/spec.md §5):
#
#   MARIADB_URL       e.g. mariadb://db.example.com:3306/orchestra
#                          (credentials in the URL are honoured)
#   MARIADB_USER      database user (overridden by URL creds if present)
#   MARIADB_PASSWORD  password
#   MARIADB_SSL       optional: disabled | preferred | required | insecure
#                              default: preferred
#
# Idempotent: schema.sql uses CREATE TABLE IF NOT EXISTS.

set -euo pipefail

if [ -z "${MARIADB_URL:-}" ]; then
  echo "error: MARIADB_URL is required (e.g. mariadb://host:3306/orchestra)" >&2
  exit 2
fi

# --- parse MARIADB_URL ------------------------------------------------------
# Format: mariadb://[user[:pass]@]host[:port]/db

url="${MARIADB_URL#mariadb://}"
url="${url#mysql://}"

userinfo=""
if [[ "$url" == *@* ]]; then
  userinfo="${url%%@*}"
  url="${url#*@}"
fi

hostport="${url%%/*}"
db="${url#*/}"
db="${db%%\?*}"  # drop ?query if present

host="${hostport%%:*}"
port="3306"
if [[ "$hostport" == *:* ]]; then
  port="${hostport##*:}"
fi

# Decode percent-encoded `userinfo` so URLs like
#   mariadb://u%40v:p%21ss@host/db
# parse as `u@v` / `p!ss` rather than the literal escape sequences.
# Matches the Node loader's behaviour.
urldecode() {
  local s="${1//+/ }"
  printf '%b' "${s//%/\\x}"
}

user="${MARIADB_USER:-}"
password="${MARIADB_PASSWORD:-}"
if [ -n "$userinfo" ]; then
  raw_user="${userinfo%%:*}"
  user="$(urldecode "$raw_user")"
  if [[ "$userinfo" == *:* ]]; then
    raw_pass="${userinfo#*:}"
    password="$(urldecode "$raw_pass")"
  fi
fi

if [ -z "$db" ]; then
  echo "error: MARIADB_URL must include /<database>" >&2
  exit 2
fi
if [ -z "$user" ]; then
  echo "error: missing MARIADB_USER (or embed user in URL)" >&2
  exit 2
fi
if [ -z "$password" ]; then
  echo "error: missing MARIADB_PASSWORD (or embed password in URL)" >&2
  exit 2
fi

# --- locate schema ----------------------------------------------------------
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
schema="$script_dir/../vines/schema.sql"
if [ ! -f "$schema" ]; then
  echo "error: schema not found at $schema" >&2
  exit 1
fi

# --- ssl flag ---------------------------------------------------------------
ssl_args=()
case "${MARIADB_SSL:-preferred}" in
  disabled) ssl_args+=("--ssl=0") ;;
  insecure) ssl_args+=("--ssl" "--ssl-verify-server-cert=FALSE") ;;
  preferred|required) ssl_args+=("--ssl") ;;
  *)
    echo "error: MARIADB_SSL must be disabled|preferred|required|insecure" >&2
    exit 2
    ;;
esac

# --- pick a client ----------------------------------------------------------
client=""
for candidate in mariadb mysql; do
  if command -v "$candidate" >/dev/null 2>&1; then
    client="$candidate"
    break
  fi
done
if [ -z "$client" ]; then
  echo "error: neither 'mariadb' nor 'mysql' client found on PATH" >&2
  exit 1
fi

echo "applying $schema → ${user}@${host}:${port}/${db} (ssl=${MARIADB_SSL:-preferred})"

MYSQL_PWD="$password" "$client" \
  -h "$host" -P "$port" -u "$user" "${ssl_args[@]}" "$db" \
  < "$schema"

echo "ok"
