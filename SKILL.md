---
name: openclaw-hawkins-installer
description: |
  Installs the openclaw-hawkins multi-agent pattern on the current host: one
  conversational orchestrator + six isolated specialist agents (system, code,
  research, data, comm, vision). Use this skill when the operator asks to
  "install openclaw-hawkins", "set up multi-agent orchestration",
  "deploy the specialists", "wire up the agent swarm", or similar. The skill
  walks through prerequisite checks, repo clone, agent creation via
  `openclaw agents add`, workspace overlay, optional Linear integration, and
  end-to-end smoke tests. Personalization questions are asked of the operator
  before any host changes are made.
---

# Skill: install openclaw-hawkins

You are installing the [`openclaw-hawkins`](https://github.com/parijatmukherjee/openclaw-hawkins) multi-agent pattern on the host you have shell access to. The end state: one orchestrator (`agent:main` — typically yourself) + six isolated specialist agents reachable via `openclaw agent --agent <id> --message "..."`.

This is a multi-step installation. **Do not skip steps.** Stop and ask the operator at the explicit decision points below.

## Trigger phrases

Invoke this skill when the operator says any of:

- "Install openclaw-hawkins"
- "Set up the multi-agent orchestration"
- "Deploy the specialists" / "Wire up the agent swarm"
- "Install the orchestra pattern"
- "Bootstrap openclaw-hawkins on this host"

If the operator says "explain openclaw-hawkins" or "what is openclaw-hawkins," **don't** trigger this skill — just describe the pattern by reading `README.md` from the repo.

## Prerequisites — verify before changes

Run these checks. If any fails, report to the operator and stop:

```bash
openclaw --version                # require ≥ 2026.5.7
openclaw gateway status           # require Runtime: running
which git                         # require git on PATH
which curl                        # for repo clone fallback
```

Soft-check (warn but allow):

```bash
which jq                          # used in worked examples; not required
which op                          # only needed for 1Password-backed Linear key
```

Model auth check — confirm at least one model is configured:

```bash
openclaw models list | head -5
```

If no model is configured, **stop**. Ask the operator to wire up at least one model (e.g., `ollama/kimi-k2.6:cloud`) before retrying.

## Personalization questions — ask before changes

Ask the operator the following before doing anything that writes to the host. If your runtime has an `AskUserQuestion` style tool, use it. Otherwise ask in chat and wait for answers.

1. **Orchestrator name and emoji.**
   The orchestrator is yourself. Default name suggestion: pick a playful one (e.g., "Conductor", "Maestro"). Default emoji: 🎼. The operator may already have an identity in their workspace `IDENTITY.md` — if so, reuse it and skip this question.

2. **Text-specialist model.**
   Default: `ollama/kimi-k2.6:cloud`. Operator can override with anything they have auth for (e.g., `openai/gpt-4o`, `groq/moonshotai/kimi-k2-instruct-0905`, any Anthropic model).

3. **Vision-specialist model.**
   Default: `ollama/kimi-k2.5:cloud`. Must be image-capable (text + image input). Anthropic vision-enabled models and `openai/gpt-4o` both work.

4. **Linear ticket oversight (yes / no).**
   If yes: ask for the operator's Linear workspace URL slug, team key (e.g., `ENG`), and how they want to store the API key (1Password ref vs `$LINEAR_API_KEY` in shell env). If 1Password: ask for the vault and item name they'd like to use. If no: skip Linear setup entirely (~/.openclaw/workspace/LINEAR.md is not installed and the orchestrator's AGENTS.md still works without tickets).

5. **Operator identity for IDENTITY.md files.**
   Operator's name and host (hostname + OS). Used to fill the templates so specialists know who they serve.

6. **Confirm before proceeding.**
   Summarize the plan back to the operator: "I will create 6 isolated agents under ~/.openclaw/agents/, overlay their AGENTS.md from the repo, install the orchestrator workspace docs, [optionally wire Linear], restart the gateway, and smoke-test. Proceed?" Wait for explicit yes.

## Installation steps

### Step 1 — clone or update the repo

```bash
REPO_DIR="${HOME}/openclaw-hawkins"
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" pull --rebase --ff-only
else
  git clone https://github.com/parijatmukherjee/openclaw-hawkins.git "$REPO_DIR"
fi
```

### Step 2 — run the bootstrap script

```bash
cd "$REPO_DIR"
OPENCLAW_ORCHESTRA_TEXT_MODEL="<chosen-text-model>" \
OPENCLAW_ORCHESTRA_VISION_MODEL="<chosen-vision-model>" \
  ./scripts/setup.sh
```

This creates the 6 specialist agents (idempotent — skips agents that already exist) and overlays each one's `AGENTS.md`. It does **not** touch `IDENTITY.md` or the orchestrator's workspace.

### Step 3 — personalize each specialist's IDENTITY.md

For each specialist:

```bash
cp "$REPO_DIR/agents/<id>/IDENTITY.md.template" \
   "$HOME/.openclaw/agents/<id>/workspace/IDENTITY.md"
```

Then edit each file to fill in the operator's name, email, and host. Either:
- Do it programmatically using the answers from question 5 above (preferred — use `sed` or write the file directly), or
- Ask the operator to do it manually.

Show the operator a confirmation diff if you edit programmatically.

### Step 4 — install the orchestrator's workspace files

```bash
cp "$REPO_DIR/orchestrator/AGENTS.md" \
   "$HOME/.openclaw/workspace/AGENTS.md"

cp "$REPO_DIR/orchestrator/TOOLS.md.template" \
   "$HOME/.openclaw/workspace/TOOLS.md"

cp "$REPO_DIR/orchestrator/IDENTITY.md.template" \
   "$HOME/.openclaw/workspace/IDENTITY.md"
```

Then edit `~/.openclaw/workspace/TOOLS.md` and `~/.openclaw/workspace/IDENTITY.md` with the operator's specifics (host, model choices, orchestrator name/vibe/emoji from question 1).

**Important:** if the operator already has an existing `~/.openclaw/workspace/AGENTS.md` or `TOOLS.md`, **do not overwrite blindly.** Show them the diff and ask whether to merge, replace, or skip.

### Step 5 — optional: wire Linear (only if operator said yes)

```bash
cp "$REPO_DIR/tools/linear-ticket" "$HOME/.local/bin/linear-ticket"
chmod +x "$HOME/.local/bin/linear-ticket"
cp "$REPO_DIR/tools/linear.json.template" "$HOME/.openclaw/linear.json"
cp "$REPO_DIR/orchestrator/LINEAR.md" "$HOME/.openclaw/workspace/LINEAR.md"
```

Then fetch the operator's Linear team metadata via the GraphQL API:

```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Authorization: <operator-supplied-lin_api_key>" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ teams { nodes { id key name states { nodes { id name type } } } } organization { urlKey } }"}'
```

Parse the response and populate `~/.openclaw/linear.json` with:
- `workspace_url_key` from `organization.urlKey`
- `team_id`, `team_key`, `team_name` from the operator's chosen team
- The seven state UUIDs in `states.{backlog, todo, in_progress, in_review, done, canceled, duplicate}`

For the API key:
- **If 1Password:** create an item, then set `api_key_secret_ref` in `linear.json` to the `op://...` reference.
- **If env var:** ensure `LINEAR_API_KEY` is set in the operator's shell init (`~/.bashrc` / `~/.zshrc`) or in the gateway's systemd unit `EnvironmentFile=`.

Smoke-test Linear:
```bash
linear-ticket list --limit 5
```

### Step 5.5 — optional: install VINES (durable orchestration layer)

If the operator wants the protocol to survive crashes and use the `vines/spec.md` activation gate, install the VINES Node library. **Ask first** — it adds a MariaDB dependency.

Prerequisites:
- Node ≥ 20 (`node -v`).
- MariaDB server reachable from this host. The operator can use a local server (`apt install mariadb-server`) or a cloud instance.

Have the operator (or their DBA) run:

```sql
CREATE DATABASE orchestra CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'orchestra'@'%' IDENTIFIED BY '<a-strong-password>';
GRANT INSERT, SELECT, UPDATE, DELETE ON orchestra.* TO 'orchestra'@'%';
FLUSH PRIVILEGES;
```

Then build and bootstrap the schema:

```bash
cd "$REPO_DIR"
npm ci                  # or `make install`
npm run build           # or `make build`
export MARIADB_URL=mariadb://<host>:3306/orchestra
export MARIADB_USER=orchestra
export MARIADB_PASSWORD=<password>     # store via 1Password if available
export LINEAR_API_KEY=<lin_api_…>
make bootstrap-db       # or: npx vines init-db
```

Smoke-test:

```bash
npx vines status                           # → "(ledger empty)"
npx vines triage --seconds 60              # → {"activate": true, ...}
npx vines recover                          # → {"unfinishedTotal": 0, ...}
```

If any of these fail, **stop and ask the operator** — never blindly retry. The full integration recipe is in `INSTALL.md §9`.

### Step 6 — restart the gateway

```bash
openclaw gateway restart
sleep 3
openclaw gateway status   # confirm Runtime: running, Connectivity probe: ok
```

### Step 7 — smoke-test the specialists

Run a one-line introduction prompt against each specialist:

```bash
for id in system-agent code-agent research-agent data-agent comm-agent vision-agent; do
  echo "=== $id ==="
  openclaw agent --agent "$id" \
    --message "Introduce yourself in one sentence. Include your role and one rule you follow." \
    --json --timeout 30 \
    | jq -r '.result.payloads[0].text'
done
```

Each should:
- Identify itself by its name (system-agent, code-agent, etc.)
- State its role
- Cite one rule from its AGENTS.md

If any specialist returns a generic "I am an AI" response, the AGENTS.md or IDENTITY.md wasn't loaded — check the workspace files exist and the gateway was restarted.

### Step 8 — end-to-end test (orchestrator dispatching)

Have the orchestrator dispatch to a specialist on its own initiative. From the operator's side or via `openclaw agent --agent main`:

```bash
openclaw agent --agent main \
  --message "Please ask system-agent to report the current disk usage on the root filesystem. Synthesize the answer for me." \
  --json --timeout 120 \
  | jq -r '.result.payloads[0].text'
```

Expected: the orchestrator acknowledges, dispatches to system-agent via exec, parses the reply, and returns a synthesized one-paragraph answer in its own voice.

If the orchestrator doesn't recognize the dispatch pattern, re-check that `~/.openclaw/workspace/AGENTS.md` contains the openclaw-hawkins content (especially the "How to dispatch" section).

## Reporting back to the operator

When done, give the operator:

1. **What was created** — list of the 6 agent workspaces created, with paths
2. **What was overlaid** — the workspace files installed and any pre-existing files preserved
3. **Linear status** — if wired, the Linear workspace URL; if skipped, note it can be added later
4. **Verification results** — pass/fail for each smoke-test
5. **Known follow-ups** — any prerequisites that were soft-missing (e.g., `jq` not installed, version mismatch warnings)
6. **A sample dispatch the operator can try** — give them a one-liner they can paste to test the system

## Failure modes

| Failure | Cause | Fix |
|---|---|---|
| `openclaw agent --agent <id>` not recognized | OpenClaw < 2026.5.7 | Tell operator to upgrade |
| Specialist returns generic identity | BOOTSTRAP.md still present in workspace | `rm ~/.openclaw/agents/<id>/workspace/BOOTSTRAP.md` |
| Specialist times out | Default --timeout too low for model latency | Re-run with longer --timeout |
| Linear `op read` fails | 1Password service-account token not loaded | Operator must source the token file in shell env or systemd unit |
| Gateway won't restart | Existing openclaw.json invalid after operator manual edits | `openclaw config validate` to find the issue |
| Vision-agent can't process images | Assigned model is text-only | Swap to `ollama/kimi-k2.5:cloud` or another vision-capable model |

## Do NOT do

- Overwrite the operator's existing `~/.openclaw/workspace/AGENTS.md` without showing them a diff and confirming.
- Skip the personalization questions to save time. The operator should know what's about to happen.
- Commit secrets (Linear API key, 1Password tokens) into any file under version control.
- Run `openclaw agents delete` for existing agents. If a name collision exists, ask the operator first.
- Disable existing skills the operator already has installed.

## After installation

Point the operator at:
- `~/.openclaw/workspace/AGENTS.md` — full architecture and dispatch protocol
- `~/.openclaw/workspace/LINEAR.md` (if installed) — ticket lifecycle
- `https://github.com/parijatmukherjee/openclaw-hawkins/blob/main/INSTALL.md` — deeper customization

The orchestrator picks up the new AGENTS.md on its next session. From then on, when the operator asks for something non-trivial, the orchestrator should acknowledge + dispatch + synthesize.
