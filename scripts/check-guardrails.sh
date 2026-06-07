#!/usr/bin/env bash
# check-guardrails.sh — fail the build if a resolved ClawHub finding regresses.
#
# This is an independent backstop to the vitest guardrails in
# tests/security/clawhub-findings.test.ts: a fast `git grep` scan that needs no
# install step, so it catches a re-introduced risky pattern even in files the
# unit suite does not enumerate. Run locally with `npm run guardrails`.

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root" || exit 1

# Files allowed to mention the forbidden patterns: the changelog (which
# documents the removals) and the guardrail checks themselves.
exclude=(
  ':!CHANGELOG.md'
  ':!scripts/check-guardrails.sh'
  ':!tests/security'
)

# "human description::extended-regex" — each pattern MUST NOT appear in tracked
# files (outside the excludes above).
forbidden=(
  'MARIADB_SSL=insecure TLS-verification bypass::MARIADB_SSL=insecure'
  'TLS certificate-verification disable flag::ssl-verify-server-cert=FALSE'
  'old installer manifest tagline::Provisions a 6-tendril Nexus swarm in one command'
  'URL-credential precedence claim::take precedence over user/password'
  'ungated Tendril of the Hive heading::^## Tendril of the Hive \(optional\)$'
  'comm-agent "post this" auto-send shortcut::post this," send'
  'static-analyzer evasion comment::to keep static'
  'unsupervised-execution framing::Designed to run end-to-end without human supervision'
)

fail=0

for entry in "${forbidden[@]}"; do
  desc="${entry%%::*}"
  pattern="${entry##*::}"
  if hits="$(git grep -nE "$pattern" -- "${exclude[@]}")"; then
    fail=1
    echo "✗ REGRESSED FINDING — forbidden pattern present: ${desc}"
    while IFS= read -r line; do
      echo "      ${line}"
    done <<<"$hits"
  fi
done

# Positive invariants: every agent overlay must keep the operator-gated VECNA
# framing and the memory-secrets caution.
required=(
  'operator-gated'
  'never auto-publish'
  'untrusted reference material'
  'Never record secrets'
)
for agent in code comm data research system vision; do
  file="agents/${agent}-agent/AGENTS.md"
  for needle in "${required[@]}"; do
    if ! grep -qF "$needle" "$file"; then
      fail=1
      echo "✗ MISSING INVARIANT in ${file}: \"${needle}\""
    fi
  done
done

echo ""
if [ "$fail" -ne 0 ]; then
  echo "Guardrail check FAILED — a resolved ClawHub finding has regressed."
  echo "See tests/security/clawhub-findings.test.ts for the full rationale."
  exit 1
fi
echo "✓ Guardrails OK — no resolved ClawHub finding has regressed."
