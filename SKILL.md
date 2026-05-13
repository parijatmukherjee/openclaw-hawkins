---
name: openclaw-hawkins-installer
description: |
  Installs openclaw-hawkins (multi-agent orchestration for OpenClaw — the
  Nexus + six Tendrils + VINES + optional VECNA Hive) on the current host.
  Designed to run end-to-end without human supervision: each phase has
  explicit detection, sensible defaults, backup-before-overlay, and
  per-step verification. Use this skill when an operator asks to "install
  openclaw-hawkins", "set up multi-agent orchestration", "deploy the
  Tendrils", "wire up the agent swarm", "upgrade to openclaw-hawkins",
  or similar.
---

# Skill: install openclaw-hawkins

You are installing the [`openclaw-hawkins`](https://github.com/parijatmukherjee/openclaw-hawkins) multi-agent pattern on the host you have shell access to. The end state: one orchestrator (the **Nexus** — `agent:main`, typically yourself) coordinating six isolated specialist agents (the **Tendrils**: `system-agent`, `code-agent`, `research-agent`, `data-agent`, `comm-agent`, `vision-agent`), with optional **VINES** (durable orchestration state) and **VECNA** (Hive knowledge sharing).

This skill is designed for **autonomous execution**. You do not require an operator to answer questions in real time — every decision point has a documented default. Where defaults are wrong, the failure mode is loud and recoverable.

## Trigger phrases

Invoke this skill when the operator says any of:

- "Install openclaw-hawkins"
- "Set up the multi-agent orchestration"
- "Deploy the Tendrils" / "Wire up the agent swarm"
- "Install the orchestra pattern"
- "Bootstrap openclaw-hawkins on this host"
- "Upgrade my swarm to openclaw-hawkins"

If the operator says "explain openclaw-hawkins" or "what is openclaw-hawkins," **don't** trigger this skill — just describe the pattern by reading `README.md` from the repo.

---

## Operating principles (read before doing anything)

1. **Defaults beat questions.** Every decision point in this skill has a default. If you can pick a default, **pick it and proceed**. Only ask the operator when the default could cause data loss.

2. **Detect → act → verify, every step.** Before any destructive action: detect what's already there. Before any "next step": verify the previous one succeeded. If verification fails, recover or halt — never silently continue.

3. **Backup before overlay.** Any time you `cp` over an existing file, first run `cp $TARGET $TARGET.bak.$(date +%s)`. Tell the operator where the backups are in the final report.

4. **Idempotent re-runs.** Re-running this skill on a partially-installed host must converge to the same end state. Database schemas use `CREATE TABLE IF NOT EXISTS`. Agent creation skips existing workspaces. File copies back up before overwriting.

5. **Halt conditions (stop and surface the error):**
   - OpenClaw version < 2026.5.7.
   - Gateway not running.
   - No model configured with auth.
   - Schema bootstrap fails after one retry.
   - VECNA `healthz` reports `db: down` after one retry.
   - Any specialist returns a generic identity after Step 7.

6. **Never disable existing things you don't own.** Don't kill running OpenClaw sessions. Don't delete agents the operator already has. Don't disable skills you didn't install. If you find conflicting state, back it up and proceed; never destroy.

7. **Final report is mandatory.** When done (success or halt), emit the report described in [Phase E](#phase-e--final-report). The operator may not be watching live; the report is how they learn what happened.

---

## Phase 0 — Host probe

Before anything else, probe the host and record its current state. This determines whether you run a **greenfield** install or an **incremental upgrade**.

### 0.1 Capture environment basics

```bash
echo "host:    $(hostname)"
echo "os:      $(uname -s) $(uname -r)"
echo "user:    $(id -un)"
echo "home:    $HOME"
echo "now:     $(date -Iseconds)"
```

### 0.2 Probe pre-existing state

Run each check; record the result. Don't fail on any of these — they're informational and feed the install-mode decision below.

```bash
# Repository clone
[ -d "$HOME/openclaw-hawkins/.git" ] && echo "repo: present" || echo "repo: absent"

# Each Tendril workspace
for id in system-agent code-agent research-agent data-agent comm-agent vision-agent; do
  [ -d "$HOME/.openclaw/agents/$id/workspace" ] && echo "tendril $id: present" || echo "tendril $id: absent"
done

# Nexus workspace files
for f in AGENTS.md TOOLS.md IDENTITY.md LINEAR.md; do
  [ -f "$HOME/.openclaw/workspace/$f" ] && echo "nexus $f: present ($(wc -c < $HOME/.openclaw/workspace/$f) bytes)" || echo "nexus $f: absent"
done

# Linear CLI + config
[ -x "$HOME/.local/bin/linear-ticket" ] && echo "linear-ticket: present" || echo "linear-ticket: absent"
[ -f "$HOME/.openclaw/linear.json" ] && echo "linear.json: present" || echo "linear.json: absent"

# VECNA service
[ -f "$HOME/.config/systemd/user/vecna.service" ] && echo "vecna.service: present" || echo "vecna.service: absent"

# Node + MariaDB clients
command -v node >/dev/null && node -v || echo "node: absent"
command -v mariadb >/dev/null && echo "mariadb client: present" || echo "mariadb client: absent"
command -v jq >/dev/null && echo "jq: present" || echo "jq: absent"
command -v op >/dev/null && echo "op: present" || echo "op: absent"
```

### 0.3 Decide install mode

- **greenfield** — none of the Tendril workspaces, the Nexus AGENTS.md, or `linear-ticket` exist. Run every phase in full.
- **incremental** — one or more of the above are present. Proceed cautiously: back up before overlaying, and reuse existing personalisation where possible.

Record the decision and the probe output. You'll cite both in the final report.

---

## Phase A — Prerequisites

Run these checks. **Halt** if any fails.

```bash
openclaw --version              # require ≥ 2026.5.7
openclaw gateway status         # require Runtime: running
command -v git    >/dev/null    # required
command -v curl   >/dev/null    # required for the fallback clone path
openclaw models list | head -5  # require ≥ 1 model configured
```

Soft checks (warn in the final report; don't halt):

```bash
command -v jq >/dev/null        # nice to have for jq -r '.result.payloads[0].text' shortcuts
command -v op >/dev/null        # recommended: enables 1Password-first credential resolution in Step 5.4
op whoami >/dev/null 2>&1       # if op is present, also confirm it's signed in
```

If any hard check fails, write a one-line explanation, emit the final report with `status: halted`, and stop.

---

## Phase B — Personalisation (with defaults)

If your runtime can ask the operator a quick question, ask. **If not, use the defaults below and proceed.** Never block the install on an unanswered question.

| Question                    | Default if unanswered                                                                                                                                          | Where it's used                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Nexus name**              | If `~/.openclaw/workspace/IDENTITY.md` already has a name → reuse it. Else default to **"Conductor"**.                                                         | Nexus IDENTITY.md only (your own identity). |
| **Nexus emoji**             | If existing IDENTITY.md has one → reuse. Else default to **🎼**.                                                                                               | Nexus IDENTITY.md.                          |
| **Text-specialist model**   | First entry from `openclaw models list` that supports text. Falls back to `ollama/kimi-k2.6:cloud`.                                                            | `setup.sh` env vars.                        |
| **Vision-specialist model** | First image-capable model from `openclaw models list`. Falls back to `ollama/kimi-k2.5:cloud`.                                                                 | `setup.sh` for `vision-agent`.              |
| **Operator name**           | If `git config --get user.name` exists → use it. Else **"the operator"**.                                                                                      | Tendril IDENTITY.md files.                  |
| **Operator email**          | If `git config --get user.email` exists → use it. Else **(omit)**.                                                                                             | Tendril IDENTITY.md files.                  |
| **Linear oversight?**       | If `~/.openclaw/linear.json` already exists → **yes, reuse it.** Else if `$LINEAR_API_KEY` is set → **yes, env-var path.** Else **skip** (can be added later). | Phase D step 5.                             |
| **VINES install?**          | If `node -v` ≥ v20 and MariaDB reachable via `$MARIADB_URL` → **yes.** Else **skip**.                                                                          | Phase D step 5.5.                           |
| **VECNA install?**          | Same condition as VINES → **yes** (VECNA reuses the same MariaDB). Else **skip**.                                                                              | Phase D step 5.6.                           |

If you do ask the operator, structure it as one consolidated question with all defaults pre-filled — never block six times in a row.

---

## Phase C — Plan announcement

Before any host change, write the plan to the operator (chat / stdout / log — wherever your output goes). Format:

```
openclaw-hawkins install plan
  mode:        <greenfield | incremental>
  clone:       $HOME/openclaw-hawkins  (action: clone | pull)
  tendrils:    system code research data comm vision  (action: create | skip-existing)
  nexus:       AGENTS.md TOOLS.md IDENTITY.md  (action: install | overlay-with-backup)
  linear:      <yes-reuse | yes-env-var | skip>
  vines:       <yes | skip>  (db: <host>:<port>/<db>)
  vecna:       <yes | skip>  (port: 8765, systemd user service)
  models:      text=<…>  vision=<…>
  defaults:    <list of personalisation values being used>
```

This is for the audit trail — don't wait for an ack. Proceed to Phase D immediately.

---

## Phase D — Install steps

Each step follows **DETECT → ACT → VERIFY**. If VERIFY fails, the recovery path is documented inline. If recovery doesn't restore the step, halt and report.

### Step 0 — Choose install mechanism (plugin-first, source-clone fallback)

There are two equivalent install paths. **Always try the plugin path first** —
it provisions the entire surface (schemas + agents + workspace overlay) in two
commands. Fall back to the source-clone path (Steps 1–8 below) only when the
plugin path fails (e.g. you're working from an unpublished branch, or you're
offline).

**DETECT (plugin path available?)**

```bash
openclaw --version | grep -qE '2026\.(5|[6-9])' && openclaw_ok=true || openclaw_ok=false
openclaw plugins search openclaw-hawkins 2>/dev/null | grep -q openclaw-hawkins \
  && plugin_published=true || plugin_published=false
```

**ACT (plugin path)**

If `openclaw_ok=true` and `plugin_published=true`:

```bash
# 1. Install. Falls back to npm if ClawHub is unreachable.
openclaw plugins install clawhub:openclaw-hawkins \
  || openclaw plugins install npm:openclaw-hawkins

# 2. Resolve creds per Step 5.4 below (1Password preferred, env fallback).
#    THIS MUST RUN BEFORE THE NEXT COMMAND — `openclaw hawkins setup` needs
#    the MariaDB env vars at invocation time.

# 3. Configure non-secrets via `openclaw config`. NEVER set the password here.
openclaw config set plugins.entries.openclaw-hawkins.config.mariadb.url \
  "$MARIADB_URL"
openclaw config set plugins.entries.openclaw-hawkins.config.mariadb.user \
  "$MARIADB_USER"
openclaw config set plugins.entries.openclaw-hawkins.config.mariadb.ssl \
  "${MARIADB_SSL:-insecure}"

# 4. Install MARIADB_PASSWORD into the gateway's environment via a 0600
#    EnvironmentFile (the secret never sits in openclaw.json).
mkdir -p "$HOME/.openclaw/secrets" && chmod 700 "$HOME/.openclaw/secrets"
( umask 077 && printf 'MARIADB_PASSWORD=%s\n' "$MARIADB_PASSWORD" > "$HOME/.openclaw/secrets/hawkins.env" )
mkdir -p "$HOME/.config/systemd/user/openclaw-gateway.service.d"
cat > "$HOME/.config/systemd/user/openclaw-gateway.service.d/hawkins.conf" <<'EOF'
[Service]
EnvironmentFile=%h/.openclaw/secrets/hawkins.env
EOF
systemctl --user daemon-reload
openclaw gateway restart

# 5. One-shot provisioning: schemas + 6 agents + AGENTS.md overlay +
#    Nexus protocol doc (~/.openclaw/workspace/HAWKINS_PROTOCOL.md).
openclaw hawkins setup

# 6. Restart the gateway so the orchestrator agent picks up the new
#    HAWKINS_PROTOCOL.md from its workspace.
openclaw gateway restart
```

**Critical** — the gateway restart in step 6 is **not optional**. Without it
the 12 tools are registered with the runtime but the orchestrator agent
hasn't re-read its workspace, so it doesn't know the tools exist or in what
sequence to call them. The symptom (real failure mode I've seen) is the
orchestrator saying "the plugin tools aren't directly accessible yet" and
falling back to legacy CLI commands. The fix is always: ensure
`~/.openclaw/workspace/HAWKINS_PROTOCOL.md` is present and the gateway has
been restarted since it was added.

**VERIFY (plugin path)**

```bash
openclaw plugins inspect openclaw-hawkins --runtime --json \
  | jq -e '.plugin.status=="loaded" and (.plugin.toolNames|length==12)' \
  && echo "plugin ok" || echo "plugin NOT ok"

test -f ~/.openclaw/workspace/HAWKINS_PROTOCOL.md \
  && echo "nexus protocol ok" || echo "nexus protocol MISSING (run: cp <pkg>/orchestrator/HAWKINS_PROTOCOL.md ~/.openclaw/workspace/)"

openclaw agent --agent system-agent --json --timeout 90 \
  --message "Call vecna_healthz and return only the JSON." \
  | jq -e '.result.payloads[0].text | fromjson | .ok==true and .db=="up"' \
  && echo "vecna_healthz ok" || echo "vecna_healthz NOT ok"

# Verify the orchestrator agent (not just a specialist) can use the tools.
# This is the test that catches the protocol-doc-missing failure mode.
openclaw agent --agent main --json --timeout 90 \
  --message "Call vines_recover with no arguments and return only the .summary object." \
  | jq -e '.result.payloads[0].text | fromjson | has("scanned") and has("linearAvailable")' \
  && echo "nexus tool-use ok" || echo "nexus tool-use NOT ok (HAWKINS_PROTOCOL.md likely missing from workspace)"
```

If all four verifications pass, **skip Steps 1, 5.5, 5.6, and 6** (the plugin
already did them). Continue from **Step 3** (Tendril identities) onward; the
plugin's `hawkins setup` will have printed an exhaustive next-steps banner —
follow it.

**Fall back to Steps 1–8 below** if either DETECT fails.

---

### Step 1 — clone or update the repo

**DETECT**

```bash
REPO_DIR="${HOME}/openclaw-hawkins"
test -d "$REPO_DIR/.git" && existed=true || existed=false
```

**ACT**

```bash
# Resolve the latest published release tag so the installer pins to an
# immutable source tree rather than the moving `main` branch.
LATEST_TAG=$(git ls-remote --tags --refs \
              https://github.com/parijatmukherjee/openclaw-hawkins.git 'v[0-9]*.[0-9]*.[0-9]*' \
            | awk -F/ '{print $NF}' \
            | sort -V \
            | tail -1)
[ -n "$LATEST_TAG" ] || { echo "ERROR: no release tags found"; exit 1; }

if $existed; then
  git -C "$REPO_DIR" fetch --tags --quiet
  git -C "$REPO_DIR" checkout --quiet "$LATEST_TAG"
else
  git clone --branch "$LATEST_TAG" --depth 1 \
    https://github.com/parijatmukherjee/openclaw-hawkins.git "$REPO_DIR"
fi
echo "Pinned to release: $LATEST_TAG"
```

**VERIFY**

```bash
test -f "$REPO_DIR/README.md" && test -d "$REPO_DIR/agents" && test -f "$REPO_DIR/scripts/setup.sh" \
  && echo "repo ok" || { echo "repo verify failed"; exit 1; }
```

**Recovery:** If clone fails (network), retry once with `--depth 1`. If still failing, halt.

---

### Step 2 — create the six Tendrils

**DETECT**

```bash
for id in system-agent code-agent research-agent data-agent comm-agent vision-agent; do
  test -d "$HOME/.openclaw/agents/$id/workspace" && echo "$id: exists" || echo "$id: missing"
done
```

**ACT**

For each Tendril that exists, **back up its current AGENTS.md before any overlay**:

```bash
ts=$(date +%s)
for id in system-agent code-agent research-agent data-agent comm-agent vision-agent; do
  target="$HOME/.openclaw/agents/$id/workspace/AGENTS.md"
  test -f "$target" && cp "$target" "$target.bak.$ts"
done
```

Then run the bootstrap (idempotent — skips existing workspaces, overlays AGENTS.md):

```bash
cd "$REPO_DIR"
OPENCLAW_ORCHESTRA_TEXT_MODEL="<chosen-text-model>" \
OPENCLAW_ORCHESTRA_VISION_MODEL="<chosen-vision-model>" \
  ./scripts/setup.sh
```

Replace `<chosen-text-model>` and `<chosen-vision-model>` with the values from Phase B. If you didn't pick (because `openclaw models list` returned nothing parseable), use the spec defaults.

**VERIFY**

```bash
for id in system-agent code-agent research-agent data-agent comm-agent vision-agent; do
  test -f "$HOME/.openclaw/agents/$id/workspace/AGENTS.md" \
    && grep -q "Tendril of the Hive" "$HOME/.openclaw/agents/$id/workspace/AGENTS.md" \
    && echo "$id ok" || echo "$id NOT ok"
done
```

Every Tendril must have an `AGENTS.md` _and_ it must contain the upstream "Tendril of the Hive" footer (proves the overlay landed).

**Recovery:** If a Tendril fails verification, re-copy `$REPO_DIR/agents/$id/AGENTS.md` to the workspace and retry. If still failing, halt.

---

### Step 3 — Tendril identities

**DETECT**

```bash
for id in system-agent code-agent research-agent data-agent comm-agent vision-agent; do
  test -f "$HOME/.openclaw/agents/$id/workspace/IDENTITY.md" && echo "$id: customised" || echo "$id: missing"
done
```

**ACT**

- **If a Tendril's IDENTITY.md already exists**, leave it alone. The operator (or a previous install) has customised it; preserve their work.
- **If it's missing**, copy the template and substitute the operator-name / operator-email values from Phase B:

```bash
ts=$(date +%s)
NAME="<operator-name-from-Phase-B>"
EMAIL="<operator-email-from-Phase-B-or-empty>"
HOSTNAME="$(hostname)"
OS="$(uname -s) $(uname -r)"
for id in system-agent code-agent research-agent data-agent comm-agent vision-agent; do
  src="$REPO_DIR/agents/$id/IDENTITY.md.template"
  dst="$HOME/.openclaw/agents/$id/workspace/IDENTITY.md"
  test -f "$dst" && cp "$dst" "$dst.bak.$ts"
  sed \
    -e "s|<OPERATOR_NAME>|$NAME|g" \
    -e "s|<OPERATOR_EMAIL>|$EMAIL|g" \
    -e "s|<HOSTNAME>|$HOSTNAME|g" \
    -e "s|<OS>|$OS|g" \
    "$src" > "$dst"
done
```

(If the template doesn't have those placeholder tokens, leave the file as-is — the defaults in the template are themselves usable.)

**VERIFY**

```bash
for id in system-agent code-agent research-agent data-agent comm-agent vision-agent; do
  test -f "$HOME/.openclaw/agents/$id/workspace/IDENTITY.md" && echo "$id ok" || echo "$id NOT ok"
done
```

---

### Step 4 — Nexus workspace files (the orchestrator's own AGENTS.md / TOOLS.md / IDENTITY.md)

**DETECT**

```bash
for f in AGENTS.md TOOLS.md IDENTITY.md; do
  test -f "$HOME/.openclaw/workspace/$f" && echo "$f: present" || echo "$f: absent"
done
```

**ACT**

For each of the three files:

- **If absent**, copy the template / canonical file from the repo:
  - `AGENTS.md` ← `$REPO_DIR/orchestrator/AGENTS.md` (drop-in as-is)
  - `TOOLS.md` ← `$REPO_DIR/orchestrator/TOOLS.md.template` (template — substitute host info)
  - `IDENTITY.md` ← `$REPO_DIR/orchestrator/IDENTITY.md.template` (template — substitute Nexus name/emoji + operator info)
- **If present**, **back up first** (`*.bak.<ts>`) and overlay only `AGENTS.md`. Leave the operator's `TOOLS.md` and `IDENTITY.md` alone — they have host-specific edits.

```bash
ts=$(date +%s)
mkdir -p "$HOME/.openclaw/workspace"

# AGENTS.md — always overlay (the upstream protocol must be current)
test -f "$HOME/.openclaw/workspace/AGENTS.md" \
  && cp "$HOME/.openclaw/workspace/AGENTS.md" "$HOME/.openclaw/workspace/AGENTS.md.bak.$ts"
cp "$REPO_DIR/orchestrator/AGENTS.md" "$HOME/.openclaw/workspace/AGENTS.md"

# TOOLS.md — install only if absent
test -f "$HOME/.openclaw/workspace/TOOLS.md" \
  || cp "$REPO_DIR/orchestrator/TOOLS.md.template" "$HOME/.openclaw/workspace/TOOLS.md"

# IDENTITY.md — install only if absent
test -f "$HOME/.openclaw/workspace/IDENTITY.md" \
  || cp "$REPO_DIR/orchestrator/IDENTITY.md.template" "$HOME/.openclaw/workspace/IDENTITY.md"
```

If `IDENTITY.md` was just installed from the template and Phase B picked defaults (Nexus name = "Conductor", emoji = 🎼), apply them now:

```bash
sed -i \
  -e "s|<NEXUS_NAME>|Conductor|g" \
  -e "s|<NEXUS_EMOJI>|🎼|g" \
  -e "s|<OPERATOR_NAME>|<operator-name>|g" \
  "$HOME/.openclaw/workspace/IDENTITY.md"
```

**VERIFY**

```bash
test -f "$HOME/.openclaw/workspace/AGENTS.md" \
  && grep -q "openclaw-hawkins\|The Nexus\|Tendrils" "$HOME/.openclaw/workspace/AGENTS.md" \
  && echo "nexus AGENTS.md ok" || echo "nexus AGENTS.md NOT ok"
```

---

### Step 5 — Linear oversight (optional)

**DETECT**

```bash
[ -x "$HOME/.local/bin/linear-ticket" ] && [ -f "$HOME/.openclaw/linear.json" ] && existed=true || existed=false
```

**ACT — install path (`existed=false`, operator wants Linear)**

```bash
ts=$(date +%s)
mkdir -p "$HOME/.local/bin"

# CLI binary — always overlay (the upstream version is the canonical one)
test -f "$HOME/.local/bin/linear-ticket" \
  && cp "$HOME/.local/bin/linear-ticket" "$HOME/.local/bin/linear-ticket.bak.$ts"
cp "$REPO_DIR/tools/linear-ticket" "$HOME/.local/bin/linear-ticket"
chmod +x "$HOME/.local/bin/linear-ticket"

# linear.json — only if absent (operator's team UUIDs are unique to them)
test -f "$HOME/.openclaw/linear.json" \
  || cp "$REPO_DIR/tools/linear.json.template" "$HOME/.openclaw/linear.json"

# Linear protocol doc into the Nexus workspace
test -f "$HOME/.openclaw/workspace/LINEAR.md" \
  && cp "$HOME/.openclaw/workspace/LINEAR.md" "$HOME/.openclaw/workspace/LINEAR.md.bak.$ts"
cp "$REPO_DIR/orchestrator/LINEAR.md" "$HOME/.openclaw/workspace/LINEAR.md"
```

If `linear.json` was _just installed_ from the template, you'll need to fill in:

- `workspace_url_key` (the slug from `linear.app/<slug>`)
- `team_id`, `team_key`, `team_name`
- The seven workflow state UUIDs

Fetch them via GraphQL using `$LINEAR_API_KEY` (the operator should have set this; if not, **halt with a clear message** explaining where to get an API token from `linear.app/settings/api`):

```bash
curl -fsS -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ teams { nodes { id key name states { nodes { id name type } } } } organization { urlKey } }"}' \
  | jq '.data'
```

Pick the first team if there's only one; otherwise prefer one whose `key` matches the operator's `git config user.email` domain, or halt and ask. Write the resulting object to `~/.openclaw/linear.json`.

**ACT — reuse path (`existed=true`)**

Operator already has Linear configured. Update only what's stale:

```bash
ts=$(date +%s)

# Upgrade linear-ticket to the upstream version (it's a strict superset).
cp "$HOME/.local/bin/linear-ticket" "$HOME/.local/bin/linear-ticket.bak.$ts"
cp "$REPO_DIR/tools/linear-ticket" "$HOME/.local/bin/linear-ticket"
chmod +x "$HOME/.local/bin/linear-ticket"

# Overlay the LINEAR.md protocol doc into the Nexus workspace (with backup).
test -f "$HOME/.openclaw/workspace/LINEAR.md" \
  && cp "$HOME/.openclaw/workspace/LINEAR.md" "$HOME/.openclaw/workspace/LINEAR.md.bak.$ts"
cp "$REPO_DIR/orchestrator/LINEAR.md" "$HOME/.openclaw/workspace/LINEAR.md"

# Leave ~/.openclaw/linear.json untouched — it has the operator's team UUIDs.
```

**VERIFY**

```bash
$HOME/.local/bin/linear-ticket list --limit 1 >/dev/null && echo "linear ok" || echo "linear NOT ok"
```

Recovery: if `list` fails with `op read failed`, the operator's 1Password isn't loaded — surface that in the report and continue. If it fails with `401`, the API key is wrong — log and continue (Linear is optional).

---

### Step 5.4 — Resolve MariaDB credentials (1Password-first)

VINES + VECNA both need `MARIADB_URL`, `MARIADB_USER`, `MARIADB_PASSWORD`. The
installer must resolve them **before** Step 5.5 so the rest of the flow can
treat them as preconditions. Resolution order:

1. **If `op` (1Password CLI) is installed AND signed in, prefer 1Password.**
   Detect with:

   ```bash
   command -v op >/dev/null && op whoami >/dev/null 2>&1 && have_op=true || have_op=false
   ```

   When `have_op=true`, **ask the operator** which 1Password vault + item
   holds the MariaDB credentials. One consolidated question, three short
   fields (vault, item, optional database name). If the runtime can't ask,
   list candidate items whose title contains "MariaDB" via
   `op item list --vault <vault> | grep -i mariadb` and propose the most
   recent as a default the operator can confirm in one keystroke.

   Then fetch and export, **without ever echoing the values**:

   ```bash
   OP_VAULT="<vault id or name the operator picked>"
   OP_ITEM="<item id or name>"
   OP_DB="${OP_DB:-hawkins}"   # most items store db name in the title, not a field
   export MARIADB_URL="mariadb://$(op item get "$OP_ITEM" --vault "$OP_VAULT" --fields label=server --reveal):$(op item get "$OP_ITEM" --vault "$OP_VAULT" --fields label=port --reveal)/$OP_DB"
   export MARIADB_USER="$(op item get "$OP_ITEM" --vault "$OP_VAULT" --fields label=username --reveal)"
   export MARIADB_PASSWORD="$(op item get "$OP_ITEM" --vault "$OP_VAULT" --fields label=password --reveal)"
   export MARIADB_SSL="${MARIADB_SSL:-insecure}"   # cloud DBs with self-signed certs
   ```

   If the item's `database` field is empty, fall back to the operator-provided
   `OP_DB` (most 1Password "Database" entries leave the field blank because
   the database name lives in the item title).

2. **Else, fall back to env vars** the operator already exported (`MARIADB_URL`,
   `MARIADB_USER`, `MARIADB_PASSWORD`). Detect:

   ```bash
   test -n "${MARIADB_URL:-}" && test -n "${MARIADB_USER:-}" && test -n "${MARIADB_PASSWORD:-}" \
     && have_db_env=true || have_db_env=false
   ```

3. **Else, skip 5.5 and 5.6.** Note in the report which path was used:
   `creds_source=1password|env|none`. **Never** prompt the operator to paste
   a password in plaintext.

The same pattern applies for `LINEAR_API_KEY` — prefer 1Password (look for an
item whose title contains "Linear API"), fall back to the env var. Linear is
optional; never block on it.

---

### Step 5.5 — VINES (durable orchestration state, optional)

**DETECT**

```bash
node -v 2>/dev/null   # need ≥ v20
test -n "${MARIADB_URL:-}" && test -n "${MARIADB_USER:-}" && test -n "${MARIADB_PASSWORD:-}" \
  && have_db_env=true || have_db_env=false
```

If `have_db_env=false`, **skip** Step 5.5 and Step 5.6. (Step 5.4 should have
already populated the env from 1Password if `op` was available — a false here
means both 1Password and env paths were unusable.) Note in the report that
VINES + VECNA were skipped due to missing creds.

**ACT**

```bash
cd "$REPO_DIR"
# Install + build (idempotent)
npm ci --no-audit --no-fund
npm run build
# Apply the schema (idempotent — CREATE TABLE IF NOT EXISTS)
make bootstrap-vines-db
```

**VERIFY**

```bash
node dist/cli.js status     >/dev/null && echo "vines status ok"     || echo "vines status NOT ok"
node dist/cli.js triage --seconds 60 >/dev/null && echo "vines triage ok"     || echo "vines triage NOT ok"
node dist/cli.js recover    >/dev/null && echo "vines recover ok"    || echo "vines recover NOT ok"
```

All three must succeed. If any fail, capture the error message into the report and halt VINES install (the rest of the install continues).

---

### Step 5.6 — VECNA (Hive knowledge sharing, optional)

Activation condition: same as 5.5 (Node ≥ 20 + MariaDB env). Skip otherwise.

**DETECT**

```bash
test -f "$HOME/.config/systemd/user/vecna.service" && existed=true || existed=false
```

**ACT**

```bash
cd "$REPO_DIR"
# Apply schema (idempotent)
make bootstrap-vecna-db

# Pick a port (default 8765; override if it's already taken)
VECNA_PORT=8765
ss -tnlp 2>/dev/null | awk '{print $4}' | grep -q ":$VECNA_PORT$" && VECNA_PORT=18765

# Write the env file (0600) — never check into git
mkdir -p "$HOME/.config/openclaw-hawkins"
umask 077
cat > "$HOME/.config/openclaw-hawkins/vecna.env" <<EOF
MARIADB_URL=$MARIADB_URL
MARIADB_USER=$MARIADB_USER
MARIADB_PASSWORD=$MARIADB_PASSWORD
MARIADB_SSL=${MARIADB_SSL:-preferred}
VECNA_PORT=$VECNA_PORT
VECNA_URL=http://127.0.0.1:$VECNA_PORT
EOF
chmod 600 "$HOME/.config/openclaw-hawkins/vecna.env"

# Install the systemd user unit
mkdir -p "$HOME/.config/systemd/user"
sed \
  -e "s|%h/openclaw-hawkins|$HOME/openclaw-hawkins|g" \
  "$REPO_DIR/examples/vecna.service" > "$HOME/.config/systemd/user/vecna.service"

systemctl --user daemon-reload
systemctl --user enable --now vecna.service
sleep 3
```

**VERIFY**

```bash
export VECNA_URL=http://127.0.0.1:$VECNA_PORT
node dist/hive/cli.js healthz | jq -e '.ok == true and .db == "up"' \
  && echo "vecna ok" || { echo "vecna NOT ok"; journalctl --user -u vecna.service -n 30; }
```

Recovery: if healthz returns `db: down`, the env file likely has wrong `MARIADB_URL`. Surface the error and journalctl tail in the report.

---

### Step 6 — restart the gateway

**ACT**

```bash
openclaw gateway restart
sleep 3
```

**VERIFY**

```bash
openclaw gateway status | grep -q "Runtime: running" && echo "gateway ok" || echo "gateway NOT ok"
```

Recovery: if not running, run `openclaw config validate` and surface the output. Halt.

---

### Step 7 — Tendril smoke tests

**ACT + VERIFY** (combined — the verification _is_ the smoke test)

```bash
for id in system-agent code-agent research-agent data-agent comm-agent vision-agent; do
  reply=$(openclaw agent --agent "$id" \
            --message "Introduce yourself in one sentence. Include your role and one rule you follow." \
            --json --timeout 30 \
          | jq -r '.result.payloads[0].text')
  echo "=== $id ==="
  echo "$reply"
  # Heuristic check: reply mentions its own id or a rule from its AGENTS.md
  echo "$reply" | grep -qiE "$id|specialist|tendril|rule" && echo "$id: ok" || echo "$id: weak"
done
```

A "weak" reply isn't a hard fail (model variation happens), but it's a signal to the operator that the Tendril's AGENTS.md / IDENTITY.md may not be loading. Record the actual replies in the report so the operator can judge.

---

### Step 8 — end-to-end Nexus dispatch test

**ACT + VERIFY**

```bash
openclaw agent --agent main \
  --message "Please ask system-agent to report the current disk usage on /. Synthesize the answer for me." \
  --json --timeout 120 \
  | jq -r '.result.payloads[0].text' \
  | tee /tmp/openclaw-hawkins-e2e.txt
```

A successful run will:

- Acknowledge the operator
- Dispatch via `exec`
- Return a synthesized one-paragraph reply with the disk usage

If the Nexus replies without dispatching (e.g., "I would suggest you run df -h"), the `AGENTS.md` content from Step 4 didn't take effect — re-verify Step 4 and Step 6.

---

## Phase E — Final report

When done (success **or** halt), emit a report. Use this structure:

```
═══ openclaw-hawkins install report ═══

  status:           <ok | partial | halted>
  install mode:     <greenfield | incremental>
  host:             <hostname>  <os>
  duration:         <seconds>

  ── what was created ──
  repo:             $HOME/openclaw-hawkins                <created | updated>
  tendrils:         system-agent, code-agent, …            <created | skipped-existing>
  nexus workspace:  AGENTS.md, TOOLS.md, IDENTITY.md       <installed | overlaid-with-backup>

  ── what was overlaid (backups saved) ──
  <list every .bak.<ts> file you created, full path>

  ── optional add-ons ──
  linear:   <yes (workspace=<slug>) | reused | skipped-missing-env | skipped-failed>
  vines:    <yes (db=<host>/<dbname>) | skipped-missing-env | skipped-failed>
  vecna:    <yes (systemd: vecna.service on port <n>) | skipped-… | skipped-…>

  ── verification ──
  gateway:          <running | NOT running>
  tendril probes:   N/6 ok
  nexus dispatch:   <ok | weak | failed>
  vines status:     <ok | n/a>
  vecna healthz:    <ok | n/a>

  ── soft-missing prerequisites ──
  <list anything from Phase A soft-check that wasn't satisfied — jq, op, etc.>

  ── next steps for the operator ──
  <one-paragraph plain-English summary of what works now>
  <if any halts: what they need to fix, with a copy-paste-able command>

  ── try it ──
  openclaw agent --agent main --message "What can you do?" --json --timeout 30 | jq -r '.result.payloads[0].text'

  ── revert (if you don't like what landed) ──
  All overwritten files were saved at <path>.bak.<unix-ts> alongside the
  originals. Restore with:  mv <path>.bak.<ts> <path>
```

---

## Failure modes & recovery

| Failure                                      | Cause                                               | Recovery                                                                                                                                                                |
| -------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openclaw agent --agent <id>` not recognised | OpenClaw < 2026.5.7                                 | Tell the operator to upgrade. Halt.                                                                                                                                     |
| Specialist returns a generic identity        | `BOOTSTRAP.md` still present in workspace           | `rm ~/.openclaw/agents/<id>/workspace/BOOTSTRAP.md`, then re-run Step 7 for that id                                                                                     |
| Specialist times out                         | Default `--timeout 30` too low for model latency    | Retry with `--timeout 120`. If still slow, model is unhealthy — report.                                                                                                 |
| `linear-ticket: op read failed`              | 1Password service-account token not loaded          | The operator must source the token file. Report; continue (Linear is optional).                                                                                         |
| Linear `401`                                 | Bad API key                                         | Report; continue (Linear is optional).                                                                                                                                  |
| Gateway won't restart                        | `openclaw.json` invalid after operator manual edits | `openclaw config validate` to surface the issue. Halt; do not proceed.                                                                                                  |
| Vision-agent can't process images            | Assigned model is text-only                         | Swap to `ollama/kimi-k2.5:cloud` or another vision-capable model. Phase B should have picked one; if it didn't, log and continue (vision is the least common dispatch). |
| Schema bootstrap fails with "Access denied"  | DB user lacks `CREATE TABLE` privilege              | Report the exact GRANT the user needs. Halt VINES/VECNA install; rest continues.                                                                                        |
| `vecna healthz` returns `db: down`           | `vecna.env` has wrong `MARIADB_URL`                 | Read `journalctl --user -u vecna.service -n 30` and report. Continue (VECNA is optional).                                                                               |
| Port already in use for VECNA                | Another service on 8765                             | Already handled in Step 5.6 — picks 18765 as fallback. If both taken, halt VECNA install.                                                                               |

---

## Do NOT do

- **Don't `openclaw agents delete` an existing agent.** If a name collision exists, you've already detected it in Phase 0 — back up the workspace AGENTS.md and proceed with overlay; never delete.
- **Don't disable existing skills the operator has installed.** You don't own them.
- **Don't commit secrets** (Linear API key, 1Password tokens, `vecna.env`) into any file under version control.
- **Don't kill running OpenClaw sessions.** The gateway restart at Step 6 is the only interruption you cause.
- **Don't overlay `linear.json`.** It contains the operator's team UUIDs which are unique to them.
- **Don't overlay `IDENTITY.md` files that already exist.** Customisation is the operator's; preserve it.

---

## After installation

Point the operator at:

- `~/.openclaw/workspace/AGENTS.md` — full architecture + the Pulse protocol
- `~/.openclaw/workspace/LINEAR.md` (if installed) — ticket lifecycle
- `https://github.com/parijatmukherjee/openclaw-hawkins/blob/main/INSTALL.md` — deeper customisation
- `https://github.com/parijatmukherjee/openclaw-hawkins/blob/main/docs/branding.md` — the Hive-Mind vocabulary
- `https://github.com/parijatmukherjee/openclaw-hawkins/blob/main/docs/pulse-protocol.md` — the workflow phases

The Nexus picks up the new `AGENTS.md` on its next session. From then on, when the operator asks for something non-trivial, the Nexus should acknowledge + dispatch + synthesize.
