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

## Security model — known design properties (informational)

The following are intentional design properties, not vulnerabilities. They
are documented here so operators can reason about the trust boundary.

### Shared agent memory (VECNA)

VECNA is **a shared knowledge store across every agent in the swarm**. Any
Tendril that can write via `vecna_connect` writes to the same Hive that
every other Tendril reads via `vecna_recall`. There is no per-agent
namespace by default.

Threat: a compromised Tendril could poison the Hive with misleading
fragments that other Tendrils later recall.

Mitigations available today:
- The plugin's configSchema rejects writing without authentication when
  `VECNA_AUTH_TOKEN` is set; require it in production deployments.
- Recall is decay-aware (>6 months without `importance=5` is demoted) so
  stale poison loses weight over time.
- `vecna_evolve` lets any Tendril supersede a wrong fragment with a
  corrected one; review the Hive periodically with `vecna_search`.
- Operators can scope writes by reviewing `source_agent` on every fragment
  and deprecating writes from untrusted Tendrils.

### Inter-agent dispatch (OpenClaw pattern)

The Nexus dispatches sub-tasks to specialist Tendrils via
`openclaw agent --agent <id> --message "<task>"`. This is OpenClaw's
standard cross-agent dispatch mechanism and the same pattern every plugin
that orchestrates multiple agents uses.

Threat: a tool argument or recall context that contains operator secrets
gets forwarded into a specialist's prompt, and the specialist's model
provider sees the secret.

Mitigation: **never pass secrets in tool arguments**. The plugin's
configSchema deliberately rejects `mariadb.password` and `linear.apiKey`,
forcing them through the gateway env. The orchestrator's protocol doc
(`HAWKINS_PROTOCOL.md`) repeats this rule for tool calls.

### Linear API integration

The `vines_attach_linear_parent` tool, the `vines_recover` Linear cross-
reference, and the orchestrator's ticket-lifecycle protocol all act on the
Linear workspace whose API key is configured via `LINEAR_API_KEY`. The key
has full permissions of the user / OAuth app it belongs to.

Mitigation: **use a Linear API key scoped to a single team** that holds
only the parent tickets you want the orchestrator to act on. Linear's
"Personal API keys" carry the full scope of the issuing user; for a
production deployment, prefer an OAuth app token with explicit team
scope. Review tickets the orchestrator creates within a few minutes of
the first dispatch; abort if anything looks wrong.

### Tag-pinned installs (when cloning the repo)

When installing from source (rather than the published npm / ClawHub
artifact, both of which are version-pinned at publish time), **clone a
specific release tag** rather than the moving `main` branch:

```bash
git clone --branch v1.0.2 --depth 1 https://github.com/parijatmukherjee/openclaw-hawkins.git
```

The npm / ClawHub install paths are immutable per version by design.

## Disclosure

Once a fix lands, we publish a `[security]` entry in `CHANGELOG.md` with a
summary of the issue, affected versions, and credit to the reporter (unless
they prefer to remain anonymous).
