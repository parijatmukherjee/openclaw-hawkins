# INSTALL.md

Detailed setup for `openclaw-orchestra`. The fast path is `./scripts/setup.sh` then a few personalization edits. This doc spells out everything in case you want to do it by hand or understand what the script does.

## Prerequisites

- **OpenClaw ≥ 2026.5.7** installed (`openclaw --version`). Earlier versions may not support `openclaw agent --agent <id>` cross-agent dispatch.
- **A running OpenClaw gateway.** Check with `openclaw gateway status`.
- **A working default model with auth.** Examples:
  - `ollama/kimi-k2.6:cloud` (text, 195K context — used as the default in this repo)
  - `ollama/kimi-k2.5:cloud` (text+image, 125K context — used for the vision specialist)
  - Substitute Anthropic, OpenAI, Groq, etc. if you've configured those auth profiles.
- (Optional) `op` (1Password CLI) if you want secret-managed Linear API key. See [Linear setup](#optional-linear-ticket-oversight) below.

## 1. Clone the repo

```bash
git clone https://github.com/parijatmukherjee/openclaw-orchestra.git ~/openclaw-orchestra
cd ~/openclaw-orchestra
```

## 2. Create the 6 specialist agents

### Fast path

```bash
./scripts/setup.sh
```

Override the default models if needed:

```bash
OPENCLAW_ORCHESTRA_TEXT_MODEL="anthropic/claude-sonnet-4-5" \
OPENCLAW_ORCHESTRA_VISION_MODEL="anthropic/claude-sonnet-4-5" \
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

| Agent | Model |
|-------|-------|
| `system-agent` | `ollama/kimi-k2.6:cloud` |
| `code-agent` | `ollama/kimi-k2.6:cloud` |
| `research-agent` | `ollama/kimi-k2.6:cloud` |
| `data-agent` | `ollama/kimi-k2.6:cloud` |
| `comm-agent` | `ollama/kimi-k2.6:cloud` |
| `vision-agent` | `ollama/kimi-k2.5:cloud` (text+image; required for OCR/screenshot tasks) |

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

| Specialist | Suggested timeout |
|---|---|
| system-agent | 120–600 s |
| code-agent | 180–900 s |
| research-agent | 90–600 s |
| data-agent | 60–300 s |
| comm-agent | 30–180 s |
| vision-agent | 30–180 s |

### Linear `linear-ticket: op read failed`

Verify `op whoami` works in your shell. If you're using a service-account token loaded by systemd, make sure the env-file is sourced for your interactive sessions too. As a fallback, set `LINEAR_API_KEY` directly in your environment.

### "Config was last written by a newer OpenClaw" warning

Multiple OpenClaw binaries on PATH. Find them with `which -a openclaw`. Pick one and remove the other to silence the warning.

## What this pattern doesn't do (yet)

- **Async / fire-and-forget dispatch.** Each `openclaw agent` call blocks until the specialist returns. For very long tasks (>10 min), this can tie up the orchestrator's turn. Async polling is on the roadmap once OpenClaw exposes the right RPC for monitoring a session from outside the caller.
- **Memory sharing across specialists.** Each specialist has its own memory dir. If you need a piece of info to flow between specialists, the orchestrator has to pass it explicitly in the next dispatch's `--message`.
- **Automatic skill scoping by agent.** Skills are currently enabled globally (`skills.entries.<name>.enabled` in `openclaw.json`). Per-agent skill scoping requires manual override under `agents.list[<id>].*` if your OpenClaw version supports it.

PRs welcome on any of these.
