# The Pulse — workflow phase reference

When `openclaw-hawkins` moves past a single-turn reply and engages the
protocol, it enters **The Pulse**. This doc maps each technical phase to
its brand alias and to the exact shell commands the orchestrator (the
Nexus) runs.

For the technical contract see [`../vines/spec.md`](../vines/spec.md).
For the brand language see [`branding.md`](branding.md).

## Phase map

| #   | Technical phase      | Brand alias           | What happens                                                                                | Commands invoked                                                                                                                     |
| --- | -------------------- | --------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 0   | Triage               | **Sensitivity Check** | Estimate work + count agent domains. Activate only when > 30 s **or** > 2 distinct domains. | `vines triage --seconds <n> --domain <id> [--domain <id> …]`                                                                         |
| 1   | Ticket creation      | **Anchoring**         | Create the Linear parent ticket.                                                            | `linear-ticket create --title "..." --state "In Progress"`                                                                           |
| 2   | Ledger row           | (still Anchoring)     | Record the recovery anchor.                                                                 | `vines start --objective "..." --linear-parent <ENG-N>`                                                                              |
| 3   | Research gate        | **Deep Seeking**      | Optional: ask the search-tendril for prior art.                                             | `openclaw agent --agent research-agent --message "..." --json --timeout 300`                                                         |
| 4   | Strategic planning   | (Anchoring continued) | Decompose into sub-tasks; create child tickets.                                             | `linear-ticket create --parent <ENG-N> …`                                                                                            |
| 5   | Specialised dispatch | **The Connection**    | Hand each sub-task to its Tendril.                                                          | `openclaw agent --agent <id> --message "..." --json --timeout <s>`                                                                   |
| 6   | Sync + verify        | (The Connection)      | Comment + transition each sub-ticket as it returns.                                         | `linear-ticket comment <sub> --body "..."` → `linear-ticket update <sub> --state "Done"`                                             |
| 7   | Final report         | **Consolidation**     | Synthesise; close parent; mark VINES success.                                               | `linear-ticket comment <parent> --body "..."` → `linear-ticket update <parent> --state "Done"` → `vines set-state <orch-id> success` |

If a phase fails or the run is aborted:
`vines set-state <orch-id> failed` + `linear-ticket update <parent> --state "Canceled"`.

If the host restarts mid-run, the next boot runs **`vines recover`** once
to discover anything still in the unfinished states (`init` | `planning`
| `executing`). The output names `nextPendingChild` per orchestration so
the Nexus can resume.

## Worked example (Sensitivity Check positive)

Operator says: _"Stand up the staging monitoring stack."_

```bash
# Sensitivity Check
vines triage --seconds 600 --domain system-agent --domain code-agent --domain data-agent
# {"activate": true, "reason": "estimatedSeconds=600 > 30"}

# Anchoring
PARENT=$(linear-ticket create \
  --title "Stand up staging monitoring stack" \
  --description "<operator's request + plan>" \
  --state "In Progress" | jq -r '.identifier')
ORCH=$(vines start \
  --objective "Stand up staging monitoring stack" \
  --linear-parent "$PARENT" --state planning)

# (Optional) Deep Seeking
openclaw agent --agent research-agent \
  --message "Compare Prom vs VictoriaMetrics at our scale" \
  --json --timeout 300 \
  | jq -r '.result.payloads[0].text' \
  | (read -r brief; linear-ticket comment "$PARENT" --body "Research brief: $brief")

# The Connection (loop over sub-tasks)
vines set-state "$ORCH" executing --last-agent system-agent
SUB=$(linear-ticket create \
  --title "[system-agent] Install Prometheus + node_exporter" \
  --parent "$PARENT" --state "In Progress" | jq -r '.identifier')
REPLY=$(openclaw agent --agent system-agent \
  --message "Install Prometheus + node_exporter on staging; verify both up." \
  --json --timeout 600 | jq -r '.result.payloads[0].text')
linear-ticket comment "$SUB" --body "$REPLY"
linear-ticket update  "$SUB" --state "Done"

# Consolidation
linear-ticket comment "$PARENT" --body "Synthesised result for the operator."
linear-ticket update  "$PARENT" --state "Done"
vines set-state "$ORCH" success
```

## Worked example (Sensitivity Check negative)

Operator says: _"What's the weather in Berlin?"_

```bash
vines triage --seconds 5 --domain
# {"activate": false, "reason": "below activation threshold"}
```

Nexus handles inline. No Anchoring. No Connection. No ledger row.

## Reserved phrases in logs

| Phase          | Log line                                                     |
| -------------- | ------------------------------------------------------------ |
| Anchoring      | `[nexus] Anchoring: created parent ENG-NNN`                  |
| Deep Seeking   | `[nexus] Deep Seeking: dispatching research-agent`           |
| The Connection | `[nexus] Connecting to the Web: <agent> ← <sub-id>`          |
| Consolidation  | `[nexus] Consolidating.`                                     |
| Recovery       | `[nexus] The Hive remembers — <N> orchestrations resumable.` |

Use these in narrative log output only; structured (JSON) logs keep the
technical keys.
