#!/usr/bin/env bash
# bootstrap-vines-db.sh — apply vines/schema.sql to the configured MariaDB.
#
# Reads the same env vars as the Node library (see vines/spec.md §5):
#
#   MARIADB_URL       e.g. mariadb://db.example.com:3306/orchestra
#                          (a username may be in the URL; a password may not)
#   MARIADB_USER      database user (or the username embedded in the URL)
#   MARIADB_PASSWORD  password (from the environment only, never in the URL)
#   MARIADB_SSL       optional: disabled | preferred | required
#                              default: preferred (always verifies the cert)
#
# Idempotent: schema.sql uses CREATE TABLE IF NOT EXISTS.

set -euo pipefail

if [ -z "${MARIADB_URL:-}" ]; then
  echo "error: MARIADB_URL is required (e.g. mariadb://host:3306/orchestra)" >&2
  exit 2
fi

# --- parse MARIADB_URL ------------------------------------------------------
# Format: mariadb://[user@]host[:port]/db  (a password in the URL is rejected)

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

# Decode the percent-encoded URL username so URLs like
#   mariadb://u%40v@host/db
# parse as `u@v` rather than the literal escape sequence.
# Matches the Node loader's behaviour.
urldecode() {
  local s="${1//+/ }"
  printf '%b' "${s//%/\\x}"
}

# The username may come from the URL; the password must not — it would be
# exposed on the command line / in shell history. It always comes from the
# environment. Matches the Node loader, which rejects a URL-embedded password.
user="${MARIADB_USER:-}"
password="${MARIADB_PASSWORD:-}"
if [ -n "$userinfo" ]; then
  if [[ "$userinfo" == *:* ]]; then
    echo "error: MARIADB_URL must not contain a password; set MARIADB_PASSWORD instead" >&2
    exit 2
  fi
  user="$(urldecode "$userinfo")"
fi

if [ -z "$db" ]; then
  echo "error: MARIADB_URL must include /<database>" >&2
  exit 2
fi
if [ -z "$user" ]; then
  echo "error: missing MARIADB_USER (or embed the username in URL)" >&2
  exit 2
fi
if [ -z "$password" ]; then
  echo "error: missing MARIADB_PASSWORD (set it in the environment)" >&2
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
  preferred|required) ssl_args+=("--ssl" "--ssl-verify-server-cert") ;;
  *)
    echo "error: MARIADB_SSL must be disabled|preferred|required" >&2
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
