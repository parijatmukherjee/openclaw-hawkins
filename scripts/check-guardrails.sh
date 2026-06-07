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

# Files allowed to mention the forbidden patterns: the changelog and upgrade
# guide (which document the removals) and the guardrail checks themselves.
exclude=(
  ':!CHANGELOG.md'
  ':!UPGRADING.md'
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
  'unconditional BOOTSTRAP.md delete (no backup)::rm\(join\(workspace, "BOOTSTRAP\.md"'
)

fail=0

for entry in "${forbidden[@]}"; do
  desc="${entry%%::*}"
  pattern="${entry##*::}"
  # git grep exits 0 (match), 1 (no match), or >=2 (scan error, e.g. a bad
  # pattern/pathspec). Distinguish them explicitly: a scan error must FAIL the
  # guardrail, not be silently swallowed as "no match".
  set +e
  hits="$(git grep -nE "$pattern" -- "${exclude[@]}")"
  status=$?
  set -e
  case "$status" in
    0)
      fail=1
      echo "✗ REGRESSED FINDING — forbidden pattern present: ${desc}"
      while IFS= read -r line; do
        echo "      ${line}"
      done <<<"$hits"
      ;;
    1)
      : # no match — good
      ;;
    *)
      echo "✗ ERROR: git grep failed (exit ${status}) while scanning for: ${desc}" >&2
      exit 2
      ;;
  esac
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

# File-specific invariants for the follow-up scan fixes (v2.0.1).
# "file::substring that must be present"
file_invariants=(
  'src/plugin/setup.ts::backupIfExists'
  'src/plugin/tools.ts::MUST NOT include secrets'
  'skills/vision-agent-skill/SKILL.md::Data handling'
)
for entry in "${file_invariants[@]}"; do
  f="${entry%%::*}"
  needle="${entry##*::}"
  if ! grep -qF "$needle" "$f"; then
    fail=1
    echo "✗ MISSING INVARIANT in ${f}: \"${needle}\""
  fi
done

echo ""
if [ "$fail" -ne 0 ]; then
  echo "Guardrail check FAILED — a resolved ClawHub finding has regressed."
  echo "See tests/security/clawhub-findings.test.ts for the full rationale."
  exit 1
fi
echo "✓ Guardrails OK — no resolved ClawHub finding has regressed."
