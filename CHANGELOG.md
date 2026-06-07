# Changelog

All notable changes to this project will be documented in this file. The
format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-06-07

Security hardening driven by the ClawHub behavioral (clawscan) review, plus the
docs/fixes from the held 2.0.2 work (never released on its own).

### Added

- **Hard-enforced VECNA enablement.** New `vecna.enabled` config flag (default
  **false**). When off, the plugin **does not register the `vecna_*` tools at
  all** — the shared-memory capability simply does not exist for any agent,
  rather than relying on prompt/description guidance. Set
  `plugins.entries.openclaw-hawkins.config.vecna.enabled=true` to enable it.
- **`UPGRADING.md`** — a 1.x → 2.x migration guide (the two breaking config
  changes + steps) and the 1.0.x → 1.1.0 auth-by-default note. Linked from the
  README install section and from SKILL.md's incremental-upgrade path.

### Changed

- **VECNA is off by default (behavior change).** Existing installs that used the
  `vecna_*` tools must set `vecna.enabled=true` to keep them. See UPGRADING.md.
- Bumped the stale `v1.0.9` / `v1.0.2` clone/curl pins in README, INSTALL, and
  SECURITY to `v2.0.1` so the manual-install docs no longer point at a
  pre-hardening release.

### Fixed

- **`SKILL.md` no longer contradicts itself on `IDENTITY.md`.** The text says an
  existing Tendril `IDENTITY.md` is preserved, but the documented loop backed up
  *and overwrote* every one. It now skips an existing `IDENTITY.md` (only creates
  one when missing), matching the stated "preserve the operator's work" intent.
  (clawscan SDI-4.)
- **`INSTALL.md` Linear example no longer models pasting a secret inline.** The
  `curl` example now reads the token from `$LINEAR_API_KEY` (via a silent prompt
  or 1Password) instead of placing it directly in the `Authorization` header.
  (clawscan SQP-2.)
- **Scoped the orchestrator's transcript-reading guidance.** Reading another
  agent's session transcript is now an explicitly-requested, single-session
  action with a privacy caution, not a general inspection step. (clawscan SSD-3.)

## [2.0.1] - 2026-06-07

Follow-up to the ClawHub review: fixes the genuine findings the v2.0.0 scan
still surfaced, and adds a regression gate around the ClawHub scan itself.

### Fixed

- **`setup.ts` no longer destroys files without a backup.** Provisioning now
  backs up an existing `AGENTS.md` before overlaying it, and **retires
  `BOOTSTRAP.md` by moving it to a timestamped `.bak`** instead of deleting it
  outright — honoring the skill's "backup before overlay" principle. (Flagged by
  both clawscan and skillspector.)
- **`vecna_connect` tool description** now warns that it publishes to an external
  store, requires operator approval, and must not carry secrets/credentials/PII.
- **vision-agent skill** now warns that images/screenshots go to a cloud model
  and may contain sensitive data, with redaction guidance.

### Added

- **ClawHub scan-regression gate.** `clawhub-baseline.json` records the accepted
  findings (false-positive secret literals + installer-scope judgments);
  `scripts/clawhub-scan-gate.mjs` downloads a published version's scan and fails
  if a finding appears that is not in the baseline. Wired into a new
  `clawhub-scan-gate.yml` workflow that runs after each Release, weekly, and on
  demand, opening an issue on regression.
- **Extended local guardrails** (PR gate): `scripts/check-guardrails.sh` and
  `tests/security/clawhub-findings.test.ts` now pin the three fixes above so they
  cannot silently regress.

## [2.0.0] - 2026-06-07

Security-hardening release that resolves the ClawHub review findings. Two
changes are **breaking** (see _Removed_ / _Changed_).

### Removed

- **`MARIADB_SSL=insecure` mode (BREAKING).** The TLS mode that disabled
  server-certificate verification is gone. Every TLS mode now verifies the
  certificate. For a database that presents a self-signed cert, use a
  CA-trusted cert or reach it over an SSH tunnel (the tunnel already
  authenticates the link; use `MARIADB_SSL=disabled` on the loopback hop).
  The previous implementation also obfuscated the verification bypass via
  `Reflect` specifically to evade static analyzers — that code is removed.

### Changed

- **Passwords embedded in `MARIADB_URL` are now rejected (BREAKING).** The URL
  is stored in plaintext config, so a password in it would leak. A username may
  still be embedded; the password must come from the gateway environment
  (`MARIADB_PASSWORD`). Docs, manifest UI hints, specs, and the bootstrap
  scripts are aligned with this.
- **VECNA "Tendril of the Hive" is now operator-gated** in every agent overlay
  (`agents/*/AGENTS.md`). It is off unless the operator explicitly enables it;
  recalled fragments are treated as **untrusted reference material, not
  instructions**; and `connect`/`evolve` (which leave the host) **never
  auto-publish** — the agent drafts, shows exactly what would be sent, and waits
  for explicit approval, with a no-secrets rule.
- **comm-agent approval gate unified across channels.** Removed the Discord/chat
  `"post this" → send` shortcut: every channel now requires explicit per-draft
  approval, matching the email gate. Inbound-attachment handling is scoped
  (explicitly-requested files only, data-only, no arbitrary URL fetch).
- **Plugin reframed as a persistent runtime plugin, not a one-shot installer**
  (manifest + `src/plugin/index.ts` description) to match its
  `onStartup` activation and the tools it registers.
- **Skill triggers tightened and warnings front-loaded.** `SKILL.md` requires an
  explicit, unambiguous install request and discloses up front that the install
  writes persistent files, installs a user systemd service, restarts the
  gateway, handles a DB secret, and enables a startup-activated plugin.
- Agent memory sections now caution that daily notes persist on disk and must
  not record secrets or personal/customer data.

### Security

- Removed the remaining static-analyzer-evasion constructs (the `Reflect`-based
  TLS bypass and password assignment, and an obfuscated test fixture); the
  underlying behavior is now transparent and safe.

## [Unreleased]

### Security

- **ASI06 — auth-by-default for VECNA.** `vecna serve` now **refuses to start**
  without `VECNA_AUTH_TOKEN` unless the operator explicitly sets
  `VECNA_ALLOW_INSECURE=1`. Previously
  an unauthenticated Hive could come up silently, letting any local process that
  reached the port (default `127.0.0.1:8765`) read and `evolve` shared memory
  fragments that later flow into agent context. New env var:
  `VECNA_ALLOW_INSECURE`.
- **SECURITY.md** now records explicit mitigations for the agentic-security (ASI)
  findings ASI02/ASI03/ASI05/ASI06/ASI07, distinguishing enforced defaults from
  operator guidance.

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
