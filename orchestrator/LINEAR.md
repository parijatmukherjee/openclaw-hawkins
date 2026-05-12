# LINEAR.md — Optional ticket oversight protocol

Linear gives the operator a live view of what the orchestrator is doing. Whenever the orchestrator delegates non-trivial work, a ticket tree records the parent task + each specialist dispatch. The operator opens the Linear board to see "what's in flight / what's done / what's stuck."

This integration is **optional**. If you don't configure `~/.openclaw/linear.json`, the orchestrator simply skips the ticket steps and works without them.

## When to create tickets

✓ Any time the orchestrator dispatches to a specialist (`openclaw agent --agent <id> ...`). One parent ticket per operator-request; one sub-ticket per dispatch.

✗ Trivial inline-handled requests (≤ 30 s): no ticket. Weather, jokes, time-of-day, quick lookups, conversation.

✗ Clarification or follow-up on an existing parent: COMMENT on the existing ticket, don't open a new one.

✗ When the operator explicitly says "don't track this" or "skip the ticket."

Rule of thumb: if it's worth delegating, it's worth a ticket. Otherwise the board fills with noise.

## Lifecycle

```
Operator sends a request
  │
  ▼ (if trivial, just reply — no ticket)
  ▼ (else)
Step 1: Create PARENT ticket, state=in_progress
        `linear-ticket create --title "..." --description "..." --state in_progress`
        Parse the JSON. Grab `identifier` (e.g. ENG-12) and `url`.
  │
Step 2: Acknowledge the operator with the parent ticket URL in the reply.
  │
  ▼ (for each specialist dispatch — repeat 3–5):
Step 3: Create SUB-TICKET, parent=<parent-id>, state=in_progress
        `linear-ticket create --title "[<agent>] <terse>" --description "<exact message>" --parent <parent-id> --state in_progress`
        The sub-ticket description = the exact `--message` you'll send (the audit trail).
Step 4: Run the dispatch.
        `openclaw agent --agent <id> --message "..." --json --timeout <s>`
Step 5: Comment + close the sub-ticket.
        `linear-ticket comment <sub-id> --body "<specialist reply, trimmed/redacted if needed>"`
        `linear-ticket update <sub-id> --state done`
  │
  ▼ (all sub-tickets done)
Step 6: Mark parent done.
        `linear-ticket update <parent-id> --state done`
Step 7: Report to operator with synthesized result + parent URL.
```

### Failure paths

- Specialist times out → comment the timeout on sub-ticket → sub-ticket Canceled → retry once with longer `--timeout`; if it fails again, escalate to operator.
- Specialist returns status≠ok → comment the failure → sub-ticket Canceled → ask operator what to do.
- Specialist needs clarification → comment the question on sub-ticket → ask operator in chat → comment the answer back → re-dispatch.
- `linear-ticket` itself fails (network, auth) → surface the error plainly to operator; do the work without ticketing and tell them why. Don't pretend a ticket exists when it doesn't.

## CLI

The wrapper is at `~/.local/bin/linear-ticket` (install from [tools/linear-ticket](../tools/linear-ticket)). It uses the Linear GraphQL API. All output is JSON on stdout. Pipe to `jq` to extract fields.

```bash
linear-ticket create  --title "..." [--description "..."] [--parent <id>] [--state <name>]
linear-ticket update  <id> [--state <name>] [--title "..."] [--description "..."]
linear-ticket comment <id> --body "..."
linear-ticket get     <id>
linear-ticket list    [--state <name>] [--parent <id>] [--limit N]
```

**States** (lowercase, underscores): `backlog | todo | in_progress | in_review | done | canceled | duplicate`. The CLI maps these to your team's actual state UUIDs (read from `~/.openclaw/linear.json`).

Both human keys (`ENG-12`) and UUIDs work as the issue reference.

### Useful jq extractions

```bash
IDENTIFIER=$(linear-ticket create ... | jq -r .identifier)
URL=$(linear-ticket create ... | jq -r .url)
STATE=$(linear-ticket get ENG-12 | jq -r .state.name)
OPEN_SUBS=$(linear-ticket list --parent ENG-12 | jq -r '.[] | select(.state.name != "Done") | .identifier')
```

## Worked examples

### Single-specialist task

```bash
# Operator: "Install jq"

PARENT=$(linear-ticket create \
  --title "Install jq" \
  --description "Operator asked to install jq. Dispatching to system-agent." \
  --state in_progress | jq -r .identifier)

# Tell operator: "Delegating to system-agent. Tracking at <PARENT url>."

SUB=$(linear-ticket create \
  --title "[system-agent] Install jq via apt" \
  --description "apt-get install -y jq; verify with jq --version" \
  --parent $PARENT --state in_progress | jq -r .identifier)

REPLY=$(openclaw agent --agent system-agent \
  --message "Install jq via apt. Verify the version. Report concisely." \
  --json --timeout 180 | jq -r '.result.payloads[0].text')

linear-ticket comment $SUB --body "$REPLY"
linear-ticket update $SUB --state done
linear-ticket update $PARENT --state done

# Tell operator: "Done — jq <version> installed. Ticket: <PARENT url>."
```

### Multi-specialist task

```bash
# Operator: "Research 3 password managers and draft an announcement email about my choice."

PARENT=$(linear-ticket create \
  --title "Password manager research + announcement email" \
  --description "Phase 1: research-agent compares 3 password managers. Operator picks one. Phase 2: comm-agent drafts the email." \
  --state in_progress | jq -r .identifier)

# Phase 1
SUB1=$(linear-ticket create \
  --title "[research-agent] Compare Bitwarden / Vaultwarden / Passbolt" \
  --description "Compare features, pricing, self-hostability. Structured table + sources." \
  --parent $PARENT --state in_progress | jq -r .identifier)
REPLY1=$(openclaw agent --agent research-agent --message "..." --json --timeout 300 | jq -r '.result.payloads[0].text')
linear-ticket comment $SUB1 --body "$REPLY1"
linear-ticket update $SUB1 --state done

# Report phase 1 to operator. Operator picks Bitwarden.

# Phase 2
SUB2=$(linear-ticket create \
  --title "[comm-agent] Draft Bitwarden announcement email" \
  --description "Draft (don't send) an email announcing the switch to Bitwarden." \
  --parent $PARENT --state in_progress | jq -r .identifier)
REPLY2=$(openclaw agent --agent comm-agent --message "..." --json --timeout 180 | jq -r '.result.payloads[0].text')
linear-ticket comment $SUB2 --body "$REPLY2"
linear-ticket update $SUB2 --state done

linear-ticket update $PARENT --state done
```

### Specialist fails

```bash
# Specialist times out
linear-ticket comment $SUB --body "FAILED: timed out at 600s. Retrying with longer timeout."
linear-ticket update $SUB --state canceled

RETRY=$(linear-ticket create \
  --title "[<agent>] <same task> (retry, extended timeout)" \
  --description "..." \
  --parent $PARENT --state in_progress | jq -r .identifier)
REPLY=$(openclaw agent --agent <id> --message "..." --json --timeout 900 | jq -r '.result.payloads[0].text')
linear-ticket comment $RETRY --body "$REPLY"
linear-ticket update $RETRY --state done

# If retry also fails: tell operator plainly; parent stays In Progress until operator decides.
```

## Rules (non-negotiable)

- **NEVER put secrets in ticket titles, descriptions, or comments.** Truncate or redact specialist replies before commenting if they include tokens, keys, or sensitive paths.
- **Keep titles ≤80 chars.** Detail goes in the description.
- **Don't mark parent Done while any sub-ticket is still In Progress.**
- **Don't bulk-close stale tickets** without operator approval.
- **No more than 5 tickets in "In Progress" at once.** Close or cancel before opening more.
- **Don't `--state canceled` or `--state duplicate` without a comment explaining why.**
- **Don't paste raw JSON dumps as descriptions** — use natural language.
- **Don't edit a sub-ticket's scope after dispatch.** If the work changes, open a new sub-ticket.

## Setup

1. Create a Linear workspace + team (free tier is plenty for single-operator use).
2. Generate a Personal API key from Settings → API. It starts with `lin_api_`.
3. Fetch your team ID and workflow state IDs:
   ```bash
   curl -s -X POST https://api.linear.app/graphql \
     -H "Authorization: <your-lin_api_key>" \
     -H "Content-Type: application/json" \
     -d '{"query":"{ teams { nodes { id key name states { nodes { id name type } } } } organization { urlKey } }"}' | jq
   ```
4. Copy `tools/linear.json.template` to `~/.openclaw/linear.json` and fill in:
   - `workspace_url_key` (from `organization.urlKey`)
   - `team_id`, `team_key`, `team_name` (from `teams.nodes[*]`)
   - The seven state UUIDs in `states.{backlog, todo, in_progress, in_review, done, canceled, duplicate}` (from `team.states.nodes[*]`).
5. Store the API key securely:
   - **Recommended:** 1Password — store as an item, then set `api_key_secret_ref` in `~/.openclaw/linear.json` to the `op://<vault>/<item>/<field>` reference. The CLI will call `op read` on each invocation.
   - **Alternative:** Set `LINEAR_API_KEY` in your shell environment.
6. Copy `tools/linear-ticket` to `~/.local/bin/linear-ticket` and `chmod +x`. Smoke-test with `linear-ticket list --limit 5`.
