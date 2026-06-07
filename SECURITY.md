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

VECNA stores fragments in a single MariaDB table (`vecna_hive`). The recall
path is gated by `topic` match, non-deprecated status, the dedup window,
and a decay penalty for entries older than 6 months without `importance=5`.

Operator guidance:
- **Auth-by-default (enforced since v1.1.0).** `vecna serve` now **refuses to
  start** unless `VECNA_AUTH_TOKEN` is set. Without a token, any process that can
  reach the Hive port (default `127.0.0.1:8765`) could connect and evolve
  fragments — so the server fails fast with an actionable message instead of
  coming up unauthenticated. To deliberately run an unauthenticated Hive (local
  dev only), set `VECNA_ALLOW_INSECURE=1`. When a token is set, the HTTP server
  refuses any request lacking the matching bearer.
- The `source_agent` field is recorded on every fragment. Review periodically
  via `vecna_search` and use `vecna_evolve` to supersede stale entries.
- Decay handling (built-in): entries older than 6 months without
  `importance=5` are deprioritised in recall ranking automatically.
- For deployments with mixed-trust agents, consider scoping writes by
  reviewing the `source_agent` of each fragment and deprecating entries
  from less-trusted Tendrils.

### Inter-agent dispatch (OpenClaw pattern)

The Nexus dispatches sub-tasks to specialist Tendrils via
`openclaw agent --agent <id> --message "<task>"`. This is OpenClaw's
standard cross-agent dispatch mechanism.

Operator guidance: **never pass secrets in tool arguments or messages**.
Tool inputs and recall context are forwarded into the receiving agent's
prompt and from there to its model provider. The plugin's configSchema
deliberately rejects `mariadb.password` and `linear.apiKey`, forcing them
through the gateway environment. The orchestrator's protocol doc
(`HAWKINS_PROTOCOL.md`) repeats this rule for tool calls.

### Linear API integration

The `vines_attach_linear_parent` tool, the `vines_recover` Linear cross-
reference, and the orchestrator's ticket-lifecycle protocol all act on the
Linear workspace whose API key is configured via `LINEAR_API_KEY`. The
configured key carries whatever scope its issuer granted.

Operator guidance: **use a Linear API key scoped to a single team** that
holds only the parent tickets you want the orchestrator to act on.
Linear's "Personal API keys" inherit the issuing user's full scope; for a
production deployment, prefer an OAuth app token with explicit team
scope. Review tickets the orchestrator creates within a few minutes of the
first dispatch and abort if anything looks wrong.

### Tag-pinned installs (when cloning the repo)

When installing from source (rather than the published npm / ClawHub
artifact, both of which are version-pinned at publish time), **clone a
specific release tag** rather than the moving `main` branch:

```bash
git clone --branch v2.1.2 --depth 1 https://github.com/parijatmukherjee/openclaw-hawkins.git
```

The npm / ClawHub install paths are immutable per version by design.

## Threat mitigations — agentic-security (ASI) findings

An agentic-security review flagged the items below. This table records how each
is addressed. "Enforced" means the code prevents the unsafe default; "Guidance"
means the operator retains control and the docs steer them to the safe choice
(the surface is an OpenClaw / external-service concern the plugin cannot enforce).

| Finding                                    | Severity | Mitigation                                                                                                                                                           | Status       |
| ------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **ASI06** Memory & context poisoning       | Medium   | `vecna serve` refuses to start without `VECNA_AUTH_TOKEN` unless `VECNA_ALLOW_INSECURE=1`. Bind to loopback; review/deprecate fragments via `vecna_evolve`. | **Enforced** |
| **ASI03** Identity & privilege abuse       | Medium   | Use a Linear **OAuth token scoped to one team**, not a full personal key; review the first tickets after setup. See "Linear API integration" above.                  | Guidance     |
| **ASI02** Tool misuse & exploitation       | Low      | Allowlist the 12 `vines_*`/`vecna_*` tools only to the intended Hawkins agents in your OpenClaw config; require human review for sensitive mutations where supported. | Guidance     |
| **ASI07** Insecure inter-agent comms       | Low      | Never put secrets in tool args/messages; the configSchema rejects `mariadb.password` / `linear.apiKey`, forcing them through the gateway env. See "Inter-agent dispatch" above. | Enforced + guidance |
| **ASI05** Unexpected code execution        | Info     | `hawkins setup` is an explicit, operator-run step with a post-install banner; run it only on the intended host and use a dedicated MariaDB database/user.             | Guidance     |

> The full design-level treatment of these classes — and how the **OpenHawkins**
> successor enforces them as runtime defaults — lives in that project's
> `docs/security-model.md`.

## Disclosure

Once a fix lands, we publish a `[security]` entry in `CHANGELOG.md` with a
summary of the issue, affected versions, and credit to the reporter (unless
they prefer to remain anonymous).
