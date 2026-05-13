# Security Policy

## Reporting a vulnerability

If you find a security issue in `openclaw-hawkins`, please **do not open a
public GitHub issue**. Instead, email the maintainer at the address in
[`package.json`](package.json) with:

- A description of the issue.
- Steps to reproduce (a minimal repro is ideal).
- The impact you believe it has.

You can expect a first response within **5 business days**. Critical issues
get acknowledged within 24 hours.

## Supported versions

Only the latest minor release on `main` receives security fixes. We pin
dependency versions in `package.json` and accept patch bumps through
Dependabot.

## Scope

The following are in scope for security reports:

- The VINES Node library (`src/`).
- The bundled bash helpers (`scripts/`).
- The schema and operator docs as far as they could trick an operator into a
  dangerous default.

The following are **out of scope** but always welcome as regular issues:

- The LLM-driven agent personas (`agents/`, `orchestrator/`). These run
  inside OpenClaw under operator control; misuse is an OpenClaw concern.
- Linear / MariaDB themselves. Report vulnerabilities to their respective
  vendors.

## Threat model — what VINES defends against

- **Credential exposure.** The library never logs the `MARIADB_PASSWORD` or
  `LINEAR_API_KEY`. The `vines recover` JSON output redacts everything by
  design — it includes Linear identifiers, not tokens.
- **SQL injection.** All queries use parameter binding. Never call
  `conn.query()` with string concatenation in a contribution.
- **Untrusted Linear responses.** The Linear client validates `success`
  flags and surfaces failures as a thrown `Error` whose message starts
  with `"Linear "` (transport, HTTP, or GraphQL error). The recovery
  scan tolerates malformed or partial responses without crashing the
  orchestrator, and distinguishes "issue truly missing" from "lookup
  failed transiently" so it doesn't auto-fail an orchestration during a
  Linear outage.

## What VINES does **not** defend against

- **Compromised OpenClaw host.** If the host running VINES is compromised, the
  attacker can read the env vars. Mitigation lives at the OpenClaw level
  (secrets backend, sandboxing).
- **Compromised Linear or MariaDB credentials.** Rotate them and consider
  scoped tokens with minimal privileges (`INSERT/SELECT/UPDATE` on the
  `orchestration_ledger` table is enough for the library to work).
- **Adversarial planner output.** If a malicious planner asks the
  orchestrator to dispatch sensitive commands, the orchestrator will. Defence
  belongs in the specialist personas (`agents/*/AGENTS.md`) which scope what
  each agent will accept.

## Disclosure

Once a fix lands, we publish a `[security]` entry in `CHANGELOG.md` with a
summary of the issue, affected versions, and credit to the reporter (unless
they prefer to remain anonymous).
