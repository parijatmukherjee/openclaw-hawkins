# INSTALL.md

Detailed setup for `openclaw-hawkins`. The fast path is `./scripts/setup.sh` then a few personalization edits. This doc spells out everything in case you want to do it by hand or understand what the script does.

## Prerequisites

- **OpenClaw ≥ 2026.5.7** installed (`openclaw --version`). Earlier versions may not support `openclaw agent --agent <id>` cross-agent dispatch.
- **A running OpenClaw gateway.** Check with `openclaw gateway status`.
- **A working default model with auth.** Examples:
  - `ollama/kimi-k2.6:cloud` (text, 195K context — used as the default in this repo)
  - `ollama/kimi-k2.5:cloud` (text+image, 125K context — used for the vision specialist)
  - Substitute Anthropic, OpenAI, Groq, etc. if you've configured those auth profiles.
- (Optional) `op` (1Password CLI) if you want secret-managed Linear API key. See [Linear setup](#optional-linear-ticket-oversight) below.

## 1. Clone the repo

Pin to a specific release tag rather than the moving `main` branch:

```bash
git clone --branch v1.0.8 --depth 1 https://github.com/parijatmukherjee/openclaw-hawkins.git ~/openclaw-hawkins
cd ~/openclaw-hawkins
```

Bump the `--branch` to the latest tag from
[the releases page](https://github.com/parijatmukherjee/openclaw-hawkins/releases)
when a newer one is published.

## 2. Create the 6 specialist agents

### Fast path

```bash
./scripts/setup.sh
```

Override the default models if needed:

```bash
OPENCLAW_ORCHESTRA_TEXT_MODEL="groq/moonshotai/kimi-k2-instruct-0905" \
OPENCLAW_ORCHESTRA_VISION_MODEL="ollama/kimi-k2.5:cloud" \
  ./scripts/setup.sh
```

### Manual path

For each specialist (replace `<id>` and `<model>` accordingly):

```bash
openclaw agents add <id> \
  --non-interactive \
  --model <model> \
  --workspace ~/.openclaw/agents/<id>/workspace
```

Then overlay the AGENTS.md from this repo:

```bash
cp agents/<id>/AGENTS.md ~/.openclaw/agents/<id>/workspace/AGENTS.md
rm -f ~/.openclaw/agents/<id>/workspace/BOOTSTRAP.md
```

Defaults for each specialist:

| Agent            | Model                                                                    |
| ---------------- | ------------------------------------------------------------------------ |
| `system-agent`   | `ollama/kimi-k2.6:cloud`                                                 |
| `code-agent`     | `ollama/kimi-k2.6:cloud`                                                 |
| `research-agent` | `ollama/kimi-k2.6:cloud`                                                 |
| `data-agent`     | `ollama/kimi-k2.6:cloud`                                                 |
| `comm-agent`     | `ollama/kimi-k2.6:cloud`                                                 |
| `vision-agent`   | `ollama/kimi-k2.5:cloud` (text+image; required for OCR/screenshot tasks) |

## 3. Personalize each specialist's identity

The `setup.sh` script does NOT touch IDENTITY.md (so you can re-run safely without overwriting your edits). Do this once:

```bash
for id in system-agent code-agent research-agent data-agent comm-agent vision-agent; do
  cp agents/$id/IDENTITY.md.template ~/.openclaw/agents/$id/workspace/IDENTITY.md
done
```

Then edit each `~/.openclaw/agents/<id>/workspace/IDENTITY.md` to fill in:

- **Operator:** your name + email
- **Host:** your hostname + OS

(The Name, Role, Vibe, Emoji defaults work as-is. Customize if you want.)

## 4. Install the orchestrator workspace files

```bash
# Architecture + dispatch protocol (drop in as-is)
cp orchestrator/AGENTS.md ~/.openclaw/workspace/AGENTS.md

# Tools + integrations (template — edit for your env)
cp orchestrator/TOOLS.md.template ~/.openclaw/workspace/TOOLS.md

# Orchestrator identity (template — personalize)
cp orchestrator/IDENTITY.md.template ~/.openclaw/workspace/IDENTITY.md
```

Then edit `~/.openclaw/workspace/TOOLS.md` to fill in:

- Your hostname, OS, user
- Your model choices
- Any integrations you have wired (email, calendar, chat channels, etc.)

And edit `~/.openclaw/workspace/IDENTITY.md` to pick:

- A name for your orchestrator
- A vibe
- An emoji
- The operator's name + how to address them

## 5. (Optional) Install the agent-skill manifests

If your OpenClaw install uses the ClawHub skill catalog, the 6 agent-skills used in this pattern are upstream and can be installed via `openclaw skills install`. If you want the local copies (for offline / pinned versions):

```bash
mkdir -p ~/.openclaw/workspace/skills
cp -r skills/* ~/.openclaw/workspace/skills/
```

Each skill is a single `SKILL.md` file. The orchestrator's AGENTS.md plus each specialist's AGENTS.md is sufficient on its own — the skill manifests are a backup / reference.

## 6. (Optional) Linear ticket oversight

If you want a Linear board where every non-trivial operator request shows up as a parent ticket + sub-tickets per specialist dispatch, follow this.

### One-time Linear setup

1. Create a Linear workspace (free tier is plenty).
2. Settings → API → Personal API keys → "Create new key" → copy the `lin_api_...` value.

   > 🔐 **Least-privilege tip.** A Linear Personal API key inherits the full
   > permissions of the issuing user across every team they belong to. For
   > production, prefer an **OAuth app token scoped to a single team** so the
   > orchestrator can only create / comment on / transition tickets in the
   > team you've designated as the "orchestrator board". Review the tickets
   > the orchestrator creates within a few minutes of the first dispatch and
   > abort if anything looks wrong.

3. Fetch your team ID and workflow state UUIDs:

   ```bash
   curl -s -X POST https://api.linear.app/graphql \
     -H "Authorization: <your-lin_api_key>" \
     -H "Content-Type: application/json" \
     -d '{"query":"{ teams { nodes { id key name states { nodes { id name type } } } } organization { urlKey } }"}' | jq
   ```

   Note your `team_id`, `team_key`, `organization.urlKey`, and the seven state UUIDs.

### Wire the CLI

```bash
cp tools/linear-ticket ~/.local/bin/linear-ticket
chmod +x ~/.local/bin/linear-ticket
cp tools/linear.json.template ~/.openclaw/linear.json
# Then edit ~/.openclaw/linear.json to fill in your team_id, team_key, state UUIDs, and api_key_secret_ref.
```

### Store the API key

**Option A — 1Password (recommended).** Create an item in your vault holding the key, then set `api_key_secret_ref` in `~/.openclaw/linear.json` to its reference:

```bash
op item create \
  --category="API Credential" \
  --title="Linear API key" \
  credential="<your-lin_api_key>"

# Note the item ID (or use --json to capture it). Then set in linear.json:
#   "api_key_secret_ref": "op://<vault-id>/<item-id>/credential"
```

The CLI calls `op read` on every invocation.

**Option B — env var.** Set `LINEAR_API_KEY=lin_api_...` in your shell. Leave `api_key_secret_ref` out of `linear.json`.

### Install the protocol doc

```bash
cp orchestrator/LINEAR.md ~/.openclaw/workspace/LINEAR.md
```

The orchestrator reads this on session start and follows the ticket lifecycle described there.

### Smoke-test

```bash
linear-ticket list --limit 5
linear-ticket create --title "Linear integration verified" --description "Test ticket — safe to close."
```

## 7. Restart the gateway

```bash
openclaw gateway restart
openclaw gateway status   # confirm Runtime: running, Connectivity probe: ok
```

## 8. Smoke-test the full setup

Each specialist should respond in character to a trivial introduction prompt:

```bash
for id in system-agent code-agent research-agent data-agent comm-agent vision-agent; do
  echo "=== $id ==="
  openclaw agent --agent $id --message "Introduce yourself in one sentence." --json --timeout 30 \
    | jq -r '.result.payloads[0].text'
  echo
done
```

End-to-end test (orchestrator dispatches to a specialist on its own initiative):

```bash
openclaw agent --agent main --message \
  "Please ask system-agent to report the current disk usage on the root filesystem." \
  --json --timeout 120 | jq -r '.result.payloads[0].text'
```

You should see the orchestrator acknowledge + dispatch + synthesize the system-agent's report.

## 9. (Optional but recommended) Install VINES — the durable orchestration layer

Everything above is **stateless** — the orchestrator agent re-decides what to do every turn, and a crash mid-flight loses the plan. The **VINES** library adds:

- A MariaDB ledger row per orchestration (one row, four columns + state enum).
- Linear-backed sub-task tracking (you've already wired this if you did step 6).
- A `vines recover` command that scans for unfinished work on startup and cross-references Linear for the resume point.
- A `vines triage` command that returns the spec §3.1 activation decision so the orchestrator agent can route correctly.

The full contract lives in [`vines/spec.md`](vines/spec.md). Follow it if you implement VINES in another language.

### 9.1 Prerequisites

- **Node ≥ 20** (`node -v`).
- **MariaDB** (local or remote) with a dedicated database for VINES. We
  recommend a dedicated user scoped to `INSERT, SELECT, UPDATE` on the
  `orchestration_ledger` table.

DBA / operator one-time setup:

```sql
CREATE DATABASE orchestra CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'orchestra'@'%' IDENTIFIED BY '<a-strong-password>';
GRANT INSERT, SELECT, UPDATE, DELETE ON orchestra.* TO 'orchestra'@'%';
FLUSH PRIVILEGES;
```

(If TLS is enforced server-side, add `REQUIRE SSL` to the `CREATE USER`
statement. The library supports `MARIADB_SSL=insecure` for self-signed certs.)

### 9.2 Install the library

```bash
git clone --branch v1.0.8 --depth 1 https://github.com/parijatmukherjee/openclaw-hawkins.git
cd openclaw-hawkins
make install        # npm ci / npm install
make build          # compile TypeScript into dist/
```

You now have an `vines` CLI on the local `node_modules/.bin/aso` path (or via
`npx vines ...`).

### 9.3 Configure

The library reads these env vars (see [`vines/spec.md`](vines/spec.md) §5):

| Variable           | Purpose                                                                  |
| ------------------ | ------------------------------------------------------------------------ |
| `MARIADB_URL`      | `mariadb://<host>[:port]/<database>` (credentials in URL win if present) |
| `MARIADB_USER`     | DB user (skip if embedded in the URL)                                    |
| `MARIADB_PASSWORD` | DB password (skip if embedded)                                           |
| `MARIADB_SSL`      | `disabled` \| `preferred` (default) \| `required` \| `insecure`          |
| `LINEAR_API_KEY`   | Linear personal API token (required)                                     |

Add them to your shell, the orchestrator agent's systemd unit, or wherever
its env is sourced. **Never commit them.**

### 9.4 Apply the schema

```bash
make bootstrap-db        # uses the `mariadb` / `mysql` client
# or, equivalent, via Node:
npx vines init-db
```

Both paths apply [`vines/schema.sql`](vines/schema.sql) — the single
`orchestration_ledger` table. The script is idempotent (`CREATE TABLE IF NOT
EXISTS`).

### 9.5 Smoke-test

```bash
npx vines status        # expect: "(ledger empty)"
npx vines triage --seconds 60        # expect: {"activate": true, ...}
npx vines recover                    # expect: {"unfinishedTotal": 0, ...}
```

### 9.6 Wire it into the orchestrator agent

Your existing OpenClaw orchestrator (Maestro, Conductor — whatever yours is
called) drives the `vines` CLI and `linear-ticket` via its `exec` tool. The CLI surface is intentionally shell-callable so an LLM-driven
agent can do this directly — no Node glue required.

#### The integration sequence (worked example)

Imagine the operator says: _"Stand up the staging monitoring stack."_ The
orchestrator follows the spec §3.2 protocol step by step. Each block below
is exactly what the orchestrator runs via `exec`:

```bash
# ── Step 0 — TRIAGE (spec §3.1) ───────────────────────────────────────────
vines triage --seconds 600 --domain system-agent --domain code-agent --domain data-agent
# → {"activate": true, "reason": "estimatedSeconds=600 > 30"}
# If activate=false, handle inline and stop. If true, continue:

# ── Step 1 — PARENT TICKET (spec §3.2 step 1) ─────────────────────────────
PARENT=$(linear-ticket create \
  --title "Stand up staging monitoring stack" \
  --description "<operator's verbatim request + plan>" \
  --state "In Progress" | jq -r '.identifier')   # e.g. ENG-123

# ── Step 2 — LEDGER ROW (spec §3.2 step 2) ────────────────────────────────
ORCH=$(vines start \
  --objective "Stand up staging monitoring stack" \
  --linear-parent "$PARENT" \
  --state planning)
# $ORCH is now a UUID — keep it in scope for the rest of the request.

# ── Step 3 — RESEARCH GATE (optional, spec §3.2 step 3) ───────────────────
# If your planner says you need a research brief first:
openclaw agent --agent research-agent --message "Compare Prom vs VictoriaMetrics for our scale" --json --timeout 300 \
  | jq -r '.result.payloads[0].text' \
  | (read -r brief; linear-ticket comment "$PARENT" --body "Research brief: $brief")

# ── Step 4 + 5 — PLAN AND DISPATCH (spec §3.2 steps 4–5) ──────────────────
vines set-state "$ORCH" executing --last-agent system-agent

SUB=$(linear-ticket create \
  --title "[system-agent] Install Prometheus + node_exporter" \
  --parent "$PARENT" --state "In Progress" | jq -r '.identifier')

REPLY=$(openclaw agent --agent system-agent \
  --message "Install Prometheus + node_exporter on staging; verify both up." \
  --json --timeout 600 | jq -r '.result.payloads[0].text')

# ── Step 6 — SYNC (spec §3.2 step 6) ──────────────────────────────────────
linear-ticket comment "$SUB" --body "$REPLY"
linear-ticket update  "$SUB" --state "Done"     # or "Canceled" on failure

# … repeat steps 4–6 for each sub-task …

# ── Step 7 — FINAL REPORT (spec §3.2 step 7) ──────────────────────────────
linear-ticket comment "$PARENT" --body "Synthesized result for the operator."
linear-ticket update  "$PARENT" --state "Done"
vines set-state "$ORCH" success
```

If a sub-task fails or the orchestrator decides to abort:

```bash
vines set-state "$ORCH" failed --last-agent <which-one-failed>
linear-ticket update "$PARENT" --state "Canceled"
```

After a crash or restart, the orchestrator runs **once** at boot:

```bash
vines recover
# → JSON: { unfinishedTotal, resumableTotal, items: [{ orchestrationId,
#          linearParentId, lastCompletedChild, nextPendingChild, ... }] }
```

For each `resumable` item, look at `nextPendingChild` in Linear and pick up
from there. For `orphaned` items (`linear_parent_id` was set but Linear
doesn't know it any more), call `vines set-state <id> failed` to clean up.

#### What you need in your orchestrator's `AGENTS.md`

Open `~/.openclaw/workspace/AGENTS.md` (the orchestrator agent's workspace
doc — installed by `scripts/setup.sh`) and confirm the **"Optional: durable
state via the VINES library"** section is present. That section tells the LLM
this sequence is available. Add the env vars listed in §9.3 to your
orchestrator agent's startup environment (typically the gateway's systemd
drop-in or your shell rc).

#### Calling the library directly (Node embedders)

If you're embedding the orchestrator into a Node app rather than driving an
LLM agent, skip the CLI and use the library directly. The exported
`Orchestrator` class wraps the whole sequence above into a single method:

```ts
import { Orchestrator, Ledger, LinearClient, dispatchSpecialist } from "openclaw-hawkins";

const orchestrator = new Orchestrator({
  ledger: Ledger.fromEnv(),
  linear: new LinearClient(),
  linearTeamId: process.env.LINEAR_TEAM_ID!,
  linearDoneStateId: process.env.LINEAR_DONE_STATE_ID,
  dispatch: (agent, message, timeoutSeconds) =>
    dispatchSpecialist(agent, message, { timeoutSeconds }),
});

const result = await orchestrator.run({
  objective: "Stand up staging monitoring stack",
  planner: (_objective, _brief) => [
    {
      title: "Install Prom + node_exporter",
      agent: "system-agent",
      message: "…",
      timeoutSeconds: 600,
    },
    // …more sub-tasks…
  ],
});
console.log(result.summary);
```

The shell flow and the library API are equivalent — both implement the same
spec §3.2 protocol on the same ledger.

## 10. (Optional) Install VECNA — the Hive knowledge-sharing service

VINES (above) gives each _orchestration_ durable state. **VECNA** is the
complementary subsystem: it gives the _swarm as a whole_ a durable
memory. When a Tendril learns something — a fix, a workaround, a
constraint — it pushes that fragment to the Hive via `vecna connect`.
The next orchestration on the same topic pulls it back with `vecna
recall` and skips re-deriving it.

Spec contract: [`vecna/spec.md`](vecna/spec.md). Architectural overview:
the [README's Hive section](README.md).

### 10.1 Prerequisites

Same as VINES — Node ≥ 20 plus a MariaDB instance. VECNA reuses the
`MARIADB_*` env vars, so if you completed §9 you already have the
groundwork.

### 10.2 Apply the schema

```bash
make bootstrap-vecna-db
```

The script applies [`vecna/schema.sql`](vecna/schema.sql) — the single
`vecna_hive` table. Idempotent (`CREATE TABLE IF NOT EXISTS`).

> 💡 **One-liner for both subsystems:** `make bootstrap-db` applies
> `vines/schema.sql` _and_ `vecna/schema.sql` in sequence.

### 10.3 Configure

Beyond the shared `MARIADB_*` and `LINEAR_API_KEY`, VECNA reads:

| Variable                 | Default                 | Purpose                                                       |
| ------------------------ | ----------------------- | ------------------------------------------------------------- |
| `VECNA_HOST`             | `127.0.0.1`             | Bind address for the Nexus.                                   |
| `VECNA_PORT`             | `8765`                  | TCP port.                                                     |
| `VECNA_AUTH_TOKEN`       | _(none)_                | If set, all requests require `Authorization: Bearer <token>`. |
| `VECNA_DEDUP_WINDOW_MIN` | `5`                     | Dedup window for `importance ≥ 4` writes.                     |
| `VECNA_URL`              | `http://127.0.0.1:8765` | Where clients / the `vecna` CLI find the Nexus.               |
| `VECNA_TIMEOUT_MS`       | `10000`                 | Client-side timeout (Node client + CLI).                      |

> ⚠️ **Security note.** The default loopback bind keeps the Hive
> off-network. If you change `VECNA_HOST` to expose it (e.g. to other
> hosts on a Tailscale tailnet), **set `VECNA_AUTH_TOKEN`** in the same
> change. The Nexus refuses to start with an empty `VECNA_AUTH_TOKEN`,
> precisely so silent mis-configurations fail loud.

### 10.4 Run the Nexus

Manual one-off (development):

```bash
make vecna-serve
# or, with overrides:
VECNA_PORT=18765 node dist/hive/cli.js serve
```

As a long-lived systemd user service:

```bash
mkdir -p ~/.config/systemd/user
cp examples/vecna.service ~/.config/systemd/user/vecna.service
# Edit ~/.config/systemd/user/vecna.service:
#   - update the WorkingDirectory + ExecStart path if your clone lives elsewhere
#   - point EnvironmentFile= at a 0600-perm file holding MARIADB_* / VECNA_AUTH_TOKEN
systemctl --user daemon-reload
systemctl --user enable --now vecna.service
journalctl --user -u vecna.service -f
```

### 10.5 Smoke-test

```bash
npx vecna healthz                                       # expect: {"ok":true,"db":"up","version":"..."}
npx vecna connect \
  --topic "smoke-roundtrip" \
  --content "operator end-to-end check" \
  --source-agent "smoke-test" \
  --importance 4
npx vecna recall "smoke-roundtrip" --format context     # human-readable
npx vecna search --query "operator"                     # full-text
```

### 10.6 Wire it into the orchestrator agent

The orchestrator (your Nexus persona) calls `vecna recall` _before_
dispatching a non-trivial sub-task and `vecna connect` _after_ it
returns something durable. The integration sequence is documented in
[`orchestrator/AGENTS.md`](orchestrator/AGENTS.md) §"Optional: shared
knowledge via VECNA".

The pattern, condensed:

```bash
# Pulse step 2.5 (between Anchoring and The Connection)
CTX=$(vecna recall "<topic-the-agent-inferred>" --ticket "$PARENT" --format context)
# Inject $CTX into the --message you send the Tendril.

# Pulse step 6.5 (after Consolidation, before closing the parent ticket)
vecna connect --topic "<topic>" \
  --content "<one-sentence durable lesson>" \
  --source-agent "<which Tendril learned this>" \
  --importance 4 \
  --linear-ref "$PARENT"

# If a previously-stored fragment turned out wrong:
vecna evolve <fragment-id> --content "<corrected truth>"
```

VECNA is **optional**: when `VECNA_URL` is unset or `vecna healthz`
fails, agents should skip recall/connect/evolve calls and proceed
without them. The supervisor pattern works without a Hive — VECNA only
makes it learn over time.

## Troubleshooting

### "Specialist responds as if it has no scope"

The specialist isn't reading its `AGENTS.md`. Check:

- `~/.openclaw/agents/<id>/workspace/AGENTS.md` exists and has the content from this repo's `agents/<id>/AGENTS.md`.
- `~/.openclaw/agents/<id>/workspace/BOOTSTRAP.md` is **absent** (its presence triggers a self-discovery flow that overrides identity).
- The gateway has been restarted after the workspace was populated.

### "Specialist returns a generic identity"

`IDENTITY.md` wasn't copied or wasn't filled in. Repeat step 3.

### Dispatch returns `status: timeout`

Increase `--timeout`. Default latency bands (in `orchestrator/AGENTS.md`):

| Specialist     | Suggested timeout |
| -------------- | ----------------- |
| system-agent   | 120–600 s         |
| code-agent     | 180–900 s         |
| research-agent | 90–600 s          |
| data-agent     | 60–300 s          |
| comm-agent     | 30–180 s          |
| vision-agent   | 30–180 s          |

### Linear `linear-ticket: op read failed`

Verify `op whoami` works in your shell. If you're using a service-account token loaded by systemd, make sure the env-file is sourced for your interactive sessions too. As a fallback, set `LINEAR_API_KEY` directly in your environment.

### "Config was last written by a newer OpenClaw" warning

Multiple OpenClaw binaries on PATH. Find them with `which -a openclaw`. Pick one and remove the other to silence the warning.

## What this pattern doesn't do (yet)

- **Async / fire-and-forget dispatch.** Each `openclaw agent` call blocks until the specialist returns. For very long tasks (>10 min), this can tie up the orchestrator's turn. Async polling is on the roadmap once OpenClaw exposes the right RPC for monitoring a session from outside the caller.
- **Memory sharing across specialists.** Each specialist has its own memory dir. If you need a piece of info to flow between specialists, the orchestrator has to pass it explicitly in the next dispatch's `--message`.
- **Automatic skill scoping by agent.** Skills are currently enabled globally (`skills.entries.<name>.enabled` in `openclaw.json`). Per-agent skill scoping requires manual override under `agents.list[<id>].*` if your OpenClaw version supports it.

PRs welcome on any of these.
