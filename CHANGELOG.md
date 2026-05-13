# Changelog

All notable changes to this project will be documented in this file. The
format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Smoke-test suite** under `tests/smoke/`, run via `npm run smoke` (or
  `make smoke`). Tests are gated on the env vars they need
  (`MARIADB_URL`, `LINEAR_API_KEY`, etc.) — missing creds yield a clean
  skip rather than a failure. Covers MariaDB ledger roundtrip, Linear API
  authentication, `openclaw` CLI availability, and the `linear-ticket`
  binary.

### Changed

- **`tools/linear-ticket` ported from Python to Node** (Node ≥ 20,
  built-ins only — no `npm install` required to run it). API is unchanged
  (`create / update / comment / get / list`). The repo no longer ships any
  Python files.
- `SKILL.md` swaps the `python3 -c "import json …"` JSON-extraction
  one-liners for `jq -r '.result.payloads[0].text'`.
- Doc references that called the ASO library "Python" now correctly say
  "Node/TypeScript" (`README.md`, `aso/spec.md`, `scripts/bootstrap-aso-db.sh`).



- **ASO — Agentic Swarm Orchestrator.** A Node/TypeScript library that
  implements the [ASO specification](aso/spec.md): a supervisor-pattern
  protocol with durable state in MariaDB and Linear-backed ticket oversight.
  Includes:
  - `src/persistence.ts` — `Ledger` class CRUD-ing `orchestration_ledger`.
  - `src/linear-client.ts` — minimal GraphQL client for Linear's REST API.
  - `src/dispatcher.ts` — wrapper around `openclaw agent --json`.
  - `src/orchestrator.ts` — the 7-step §3.2 workflow engine + §3.1 triage.
  - `src/recovery.ts` — §4.2 cross-reference between ledger and Linear.
  - `aso` CLI with `init-db`, `status`, `recover`, `triage` subcommands.
- `aso/schema.sql` — canonical `orchestration_ledger` table.
- `scripts/bootstrap-aso-db.sh` — shell helper for applying the schema.
- `Makefile` — operator + developer entrypoint over npm scripts.
- GitHub Actions CI: matrix tests (Node 20 + 22), eslint, prettier check,
  shellcheck.
- OSS scaffolding: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
  bug / feature issue templates, PR template.
- Test suite — vitest with v8 coverage; thresholds enforced
  (statements ≥ 95 %, functions ≥ 95 %, branches ≥ 90 %).

### Changed

- `INSTALL.md` now documents both the agent setup (existing) and the
  optional ASO library install.
- `orchestrator/AGENTS.md` references the new ASO library and links the
  spec.

## [0.0.x] — pre-1.0 specialist-pattern releases

The initial drop of the repo (commit `c97bd38` onwards) shipped the
six-specialist OpenClaw pattern, agent personas, skill manifests, and
`linear-ticket` shell tool. See the git log for details.
