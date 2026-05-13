# HAWKINS_PROTOCOL.md — Plugin-aware orchestration

This doc tells the Nexus how to use the **openclaw-hawkins** plugin's 12
tools. Drop it alongside your Nexus's `AGENTS.md` (e.g.
`~/.openclaw/workspace/HAWKINS_PROTOCOL.md`) — workspace bootstrap will pick
it up automatically.

It is intentionally small and additive. Your existing `AGENTS.md` keeps its
identity, dispatch rules, Linear ticket protocol, and secrets policy
unchanged. This file only adds the **plugin orchestration vocabulary**.

---

## Step 0 — detect

Before doing anything else this session, check whether the plugin is loaded:

```bash
openclaw plugins list 2>/dev/null | grep -q openclaw-hawkins && plugin_ok=true || plugin_ok=false
```

If `plugin_ok=true`, you have the 12 tools below. If false, fall back to
whatever pre-plugin protocol your `AGENTS.md` describes.

## The 12 tools (call them by name through the agent runtime)

**VINES — durable orchestration state (one row per operator request):**

| Tool                          | When to call it                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `vines_triage`                | Start of any non-trivial operator request (> 30 s of work, or > 1 specialist). Returns an `orchestrationId`.   |
| `vines_attach_linear_parent`  | Right after `vines_triage`, once you've created the Linear parent ticket. Idempotent.                          |
| `vines_set_state`             | After every meaningful transition: `planning` → `executing` → `success` / `failed`.                            |
| `vines_start`                 | Convenience for the most common transition (to `executing`). Equivalent to `vines_set_state(state: executing)`. |
| `vines_status`                | Fetch one orchestration row. Useful for debugging "what state am I in?"                                        |
| `vines_recover`               | Run **once at session start** to detect unfinished orchestrations from a previous crash / restart.             |

**VECNA — shared agent memory (cross-orchestration knowledge):**

| Tool              | When to call it                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `vecna_recall`    | Before dispatching a sub-task, recall prior context on the topic. Use `format: "context"` for prompt injection.    |
| `vecna_connect`   | When a specialist returns a non-trivial result, persist the lesson so the next orchestration benefits.             |
| `vecna_evolve`    | When you discover an existing memory is wrong, supersede it with the corrected fragment.                           |
| `vecna_search`    | Full-text fallback when no clear topic is known.                                                                   |
| `vecna_fragment`  | Look up one fragment by id (rare — only when you have an id from a prior recall).                                  |
| `vecna_healthz`   | Liveness probe. Call at session start to confirm the Hive is reachable.                                            |

## Worked sequence (operator request → final close)

1. **Triage.** Call `vines_triage` with `{ objectiveSummary }`. Capture the
   returned `orchestrationId`. If the work is trivial (< 30 s, one specialist),
   skip the rest and handle inline.
2. **Recall context.** Call `vecna_recall` on the relevant topic with
   `format: "context"`. Inject the returned string into the next specialist
   message.
3. **Linear ticket.** Create the parent ticket per your existing protocol, then
   call `vines_attach_linear_parent` to anchor the orchestration to it.
4. **Plan + execute.** For each sub-task:
   - `vines_set_state(executing, lastAgentActive: '<specialist-id>')`
   - dispatch the specialist via `openclaw agent --agent <id>`
   - When the specialist returns a useful lesson, call `vecna_connect`.
5. **Close out.** `vines_set_state(success)` on completion, or
   `vines_set_state(failed)` on abort.

## On restart / new session

```text
1. vecna_healthz   → db must be up
2. vines_recover   → check summary.resumable; if > 0, resume each
                     orchestration from its lastCompletedChild → nextPendingChild
```

## Important — what NOT to do

- **Don't shell out** to `vines …` / `vecna …` CLI commands in plugin mode.
  The plugin tools are first-class agent tools — call them by name.
- **Don't put `MARIADB_PASSWORD` or `LINEAR_API_KEY` in `openclaw.json`** — the
  plugin's configSchema deliberately rejects them. Secrets live in the
  gateway env only (0600 `EnvironmentFile` or `systemctl --user set-environment`).
- **Don't call `vines_triage` for trivial requests.** Spec §3.1: the protocol
  fires only when work is estimated > 30 s **or** spans > 2 specialist
  domains. Bypass for one-shot questions.

## Verification

Any time the Nexus is unsure the plugin is wired correctly:

```bash
openclaw plugins inspect openclaw-hawkins --runtime --json \
  | jq '.plugin | {status, toolNames, hookNames}'
```

`status` should be `loaded`, `toolNames` should list all 12, and
`hookNames` should include `hawkins/auto-recovery`. If anything is missing,
restart the gateway (`openclaw gateway restart`) before retrying.
