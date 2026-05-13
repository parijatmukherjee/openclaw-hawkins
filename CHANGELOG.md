# Changelog

All notable changes to this project will be documented in this file. The
format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **The supervisor pattern.** One conversational orchestrator (the
  **Nexus**) coordinating six isolated specialist agents (the
  **Tendrils**: `system-agent`, `code-agent`, `research-agent`,
  `data-agent`, `comm-agent`, `vision-agent`). Each Tendril is a true
  top-level OpenClaw agent with its own workspace and persona.
  - `scripts/setup.sh` — provisions the six agents on a host.
  - `orchestrator/` — the Nexus's drop-in workspace files
    (`AGENTS.md`, `TOOLS.md.template`, `IDENTITY.md.template`,
    `LINEAR.md`).
  - `agents/<id>/` — per-Tendril `AGENTS.md` + `IDENTITY.md.template`.

- **VINES (Versatile Integration for Networked Execution & State).**
  Node/TypeScript library that gives each orchestration durable state
  and crash-resilient recovery. Contract in
  [`vines/spec.md`](vines/spec.md):
  - `vines/schema.sql` — `orchestration_ledger` MariaDB table.
  - `src/persistence.ts` — `Ledger` CRUD with auto-reconnect pool.
  - `src/linear-client.ts` — Linear GraphQL client.
  - `src/dispatcher.ts` — wrapper around `openclaw agent --json`.
  - `src/orchestrator.ts` — §3 protocol engine + §3.1 Sensitivity Check
    activation gate.
  - `src/recovery.ts` — §4.2 ledger ↔ Linear cross-reference.
  - `vines` CLI binary:
    `init-db / status / recover / triage / start / set-state /
    attach-linear-parent`.

- **VECNA (Versatile Entity for Contextual Network Awareness) — the
  Hive.** Sidecar Express service for inter-agent knowledge sharing.
  Contract in [`vecna/spec.md`](vecna/spec.md):
  - `vecna/schema.sql` — `vecna_hive` table with btree + FULLTEXT
    indexes.
  - `src/hive/store.ts` — `HiveStore` CRUD (connect with dedup, recall
    with decay-aware ranking, search, evolve, fragment fetch).
  - `src/hive/server.ts` — Express app:
    `/v1/{healthz,connect,recall/:topic,search,fragments/:id,evolve/:id}`.
    Optional Bearer auth via `VECNA_AUTH_TOKEN`.
  - `src/hive/client.ts` — `HiveTendril` Node client.
  - `src/hive/cli.ts` — `vecna` CLI binary:
    `serve / connect / recall / search / evolve / fragment / healthz`.

- **The Pulse.** Five-phase workflow vocabulary (Sensitivity Check →
  Anchoring → Deep Seeking → The Connection → Consolidation) mapping
  the LLM-driven orchestrator's behaviour onto the technical protocol.
  Documented in [`docs/pulse-protocol.md`](docs/pulse-protocol.md).

- **Brand identity.** Stranger Things–inspired visual + tonal language.
  Canonical reference in [`docs/branding.md`](docs/branding.md);
  palette tokens in [`docs/colors.json`](docs/colors.json) (Pulse Red
  `#E60000`, Void Black `#000000`, Vascular Maroon `#4A0E0E`); banner
  at `banner.png`.

- **Linear ticket oversight.** `tools/linear-ticket` — Node, built-ins
  only (no `npm install` required to run it). Subcommands:
  `create / update / comment / get / list`. Configured via
  `~/.openclaw/linear.json` with either `LINEAR_API_KEY` env var or a
  1Password `api_key_secret_ref`.

- **Operator entrypoints.**
  - `Makefile`: `install / build / test / coverage / smoke / lint /
    format / setup-agents / bootstrap-db / bootstrap-vines-db /
    bootstrap-vecna-db / vecna-serve / clean`.
  - `scripts/bootstrap-vines-db.sh`, `scripts/bootstrap-vecna-db.sh`.
  - `examples/vecna.service` — hardened systemd user unit
    (`ProtectSystem=strict`, `NoNewPrivileges=true`).

- **AI-installer manifest.** `SKILL.md` walks an existing OpenClaw
  agent through the full install with explicit operator
  decision-points.

- **CI + quality gates.**
  - GitHub Actions: matrix tests on Node 20 + 22, ESLint
    (`typescript-eslint` recommended-type-checked), Prettier
    `--check`, shellcheck on `scripts/`, Codecov upload.
  - Vitest with v8 coverage — thresholds enforced on every PR
    (statements ≥ 95 %, functions ≥ 95 %, branches ≥ 88 %,
    lines ≥ 95 %).
  - Smoke suite under `tests/smoke/` runs against real
    MariaDB / Linear / OpenClaw / VECNA Hive when the corresponding
    env vars are set. Verified locally: 100 % pass on a configured
    host.

- **OSS scaffolding.** `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  `SECURITY.md`, issue templates (bug, feature), PR template.

[Unreleased]: https://github.com/parijatmukherjee/openclaw-hawkins/compare/v0.0.0...HEAD
