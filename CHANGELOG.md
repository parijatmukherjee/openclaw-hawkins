# Changelog

All notable changes to this project will be documented in this file. The
format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`vines` CLI lifecycle subcommands** so a shell-driven orchestrator agent
  can run the spec §3.2 protocol end-to-end without writing Node glue:
  - `vines start --objective "..." [--linear-parent <ENG-N>] [--state <s>]`
    — insert a new `orchestration_ledger` row; prints the UUID.
  - `vines set-state <orch-id> <state> [--last-agent <id>]` — move through
    `init → planning → executing → success | failed`.
  - `vines attach-linear-parent <orch-id> <ENG-N>` — backfill the Linear
    parent on a row created before the ticket existed.
- Worked end-to-end integration sequence in `INSTALL.md §9.6` and a
  matching condensed version in `orchestrator/AGENTS.md`. Shows every
  `vines` / `linear-ticket` / `openclaw agent` call an LLM orchestrator
  runs through its `exec` tool from operator request to ticket close.
- `orchestrator/LINEAR.md` gains an **"Integrating with VINES"** section
  documenting where VINES bookends the ticket lifecycle.
- `orchestrator/TOOLS.md.template` registers `vines` and `linear-ticket`
  in the tool table so adopters' generated `TOOLS.md` lists them.

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
- Doc references that called the VINES library "Python" now correctly say
  "Node/TypeScript" (`README.md`, `vines/spec.md`, `scripts/bootstrap-vines-db.sh`).

- **VINES (Versatile Integration for Networked Execution & State).** A Node/TypeScript library that
  implements the [VINES specification](vines/spec.md): a supervisor-pattern
  protocol with durable state in MariaDB and Linear-backed ticket oversight.
  Includes:
  - `src/persistence.ts` — `Ledger` class CRUD-ing `orchestration_ledger`.
  - `src/linear-client.ts` — minimal GraphQL client for Linear's REST API.
  - `src/dispatcher.ts` — wrapper around `openclaw agent --json`.
  - `src/orchestrator.ts` — the 7-step §3.2 workflow engine + §3.1 triage.
  - `src/recovery.ts` — §4.2 cross-reference between ledger and Linear.
  - `vines` CLI with `init-db`, `status`, `recover`, `triage` subcommands.
- `vines/schema.sql` — canonical `orchestration_ledger` table.
- `scripts/bootstrap-vines-db.sh` — shell helper for applying the schema.
- `Makefile` — operator + developer entrypoint over npm scripts.
- GitHub Actions CI: matrix tests (Node 20 + 22), eslint, prettier check,
  shellcheck.
- OSS scaffolding: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
  bug / feature issue templates, PR template.
- Test suite — vitest with v8 coverage; thresholds enforced
  (statements ≥ 95 %, functions ≥ 95 %, branches ≥ 90 %).

### Changed

- `INSTALL.md` now documents both the agent setup (existing) and the
  optional VINES library install.
- `orchestrator/AGENTS.md` references the new VINES library and links the
  spec.

## [0.0.x] — pre-1.0 specialist-pattern releases

The initial drop of the repo (commit `c97bd38` onwards) shipped the
six-specialist OpenClaw pattern, agent personas, skill manifests, and
`linear-ticket` shell tool. See the git log for details.
