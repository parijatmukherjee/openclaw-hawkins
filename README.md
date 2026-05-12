# 🦞 openclaw-orchestra

**Drop-in multi-agent orchestration pattern for [OpenClaw](https://openclaw.ai).**

One thin orchestrator + N isolated specialists, each with their own workspace, memory, and tool surface. Optional Linear-backed ticket oversight so a human can watch what the swarm is doing.

```
┌─────────────────────────────────────────┐
│       Orchestrator (agent:main)         │
│  - Talks to the operator                │
│  - Picks the right specialist           │
│  - Dispatches via `openclaw agent`      │
│  - Synthesizes + reports                │
│  - NEVER blocks the conversation        │
└─────────────────┬───────────────────────┘
                  │ openclaw agent --agent <id> --message "..."
    ┌─────────────┼─────────────┬─────────────┐
    │             │             │             │
┌───▼────┐  ┌────▼────┐  ┌────▼────┐  ┌────▼────┐
│system  │  │code     │  │research │  │data     │   ...
│agent   │  │agent    │  │agent    │  │agent    │
└────────┘  └─────────┘  └─────────┘  └─────────┘
```

## Why this pattern?

A single OpenClaw agent that "does everything" hits two walls quickly:

1. **Context bloat.** Every tool, every memory, every skill loads on every turn. Trivial routing decisions pay the same token cost as deep domain reasoning.
2. **No real specialization.** Subagents share the parent's workspace and memory — isolation is conventional, not structural.

This repo solves both:

- The orchestrator stays lean: routing + light conversation + quick lookups (≤30s inline).
- Specialists are **true top-level OpenClaw agents** (`openclaw agents add <id>`), each with its own `~/.openclaw/agents/<id>/workspace/`, its own `AGENTS.md`, its own memory.
- Dispatch is cross-agent: `openclaw agent --agent <id> --message "..." --json` from the orchestrator's `exec` tool.
- Optional Linear integration gives the operator a parent ticket per request + sub-ticket per dispatch, so the work tree is visible at a glance.

## What's in here

```
openclaw-orchestra/
├── orchestrator/                  # Goes into your main agent's workspace
│   ├── AGENTS.md                  # The dispatch protocol + architecture
│   ├── TOOLS.md.template          # Tool surface + integration notes (templated)
│   ├── IDENTITY.md.template       # Orchestrator identity template
│   └── LINEAR.md                  # Optional: ticket oversight protocol
├── agents/                        # Goes into each specialist's workspace
│   ├── system-agent/
│   ├── code-agent/
│   ├── research-agent/
│   ├── data-agent/
│   ├── comm-agent/
│   └── vision-agent/
├── skills/                        # The corresponding agent-skill manifests
│   ├── system-agent-skill/
│   ├── code-agent-skill/
│   ├── research-agent-skill/
│   ├── data-agent-skill/
│   ├── comm-agent-skill/
│   └── vision-agent-skill/
├── tools/
│   ├── linear-ticket              # Optional Linear CLI wrapper (Python, stdlib only)
│   └── linear.json.template       # Template config for the CLI
└── scripts/
    └── setup.sh                   # Bootstrap: creates the 6 isolated agents on your host
```

## Quick start

Requires: OpenClaw ≥ 2026.5.7 installed and the gateway running. A model with auth (this template defaults to `ollama/kimi-k2.6:cloud`, swap as needed).

```bash
git clone https://github.com/parijatmukherjee/openclaw-orchestra.git ~/openclaw-orchestra
cd ~/openclaw-orchestra
./scripts/setup.sh                  # creates the 6 specialist agents + copies workspace templates
```

Then in your orchestrator's workspace at `~/.openclaw/workspace/`:

```bash
cp orchestrator/AGENTS.md       ~/.openclaw/workspace/AGENTS.md
cp orchestrator/TOOLS.md.template ~/.openclaw/workspace/TOOLS.md   # then edit for your env
cp orchestrator/IDENTITY.md.template ~/.openclaw/workspace/IDENTITY.md  # then personalize
# Optional Linear integration:
cp orchestrator/LINEAR.md       ~/.openclaw/workspace/LINEAR.md
cp tools/linear-ticket ~/.local/bin/ && chmod +x ~/.local/bin/linear-ticket
cp tools/linear.json.template ~/.openclaw/linear.json    # then fill in your team/state IDs
```

Restart the gateway: `openclaw gateway restart`.

Smoke-test:

```bash
openclaw agent --agent system-agent \
  --message "Introduce yourself in one line." \
  --json --timeout 30
```

Detailed steps and customization: see [INSTALL.md](INSTALL.md).

## The dispatch primitive

```bash
openclaw agent --agent <id> --message "<task>" --json --timeout <seconds>
```

Returns structured JSON. The specialist's reply is at `result.payloads[0].text`. The orchestrator parses this and re-speaks it in its own voice to the operator.

## The roster (default)

| Agent | Scope | Default model |
|-------|-------|---------------|
| `system-agent` | apt, systemd, ufw, cron, disk, logs, host config | `ollama/kimi-k2.6:cloud` |
| `code-agent` | software dev, debugging, testing, git | `ollama/kimi-k2.6:cloud` |
| `research-agent` | web research, comparisons, sourced reports | `ollama/kimi-k2.6:cloud` |
| `data-agent` | CSV/JSON/Excel parsing, analysis, charts | `ollama/kimi-k2.6:cloud` |
| `comm-agent` | email/chat drafts, calendar (always drafts — never auto-sends) | `ollama/kimi-k2.6:cloud` |
| `vision-agent` | image analysis, OCR, screenshots — needs image-capable model | `ollama/kimi-k2.5:cloud` |

These are starting points. Each agent's workspace is yours to edit. Add new specialists, retire ones you don't need, swap models — the pattern doesn't care.

## Optional: Linear oversight

If you have a Linear workspace (free tier is enough), wire the orchestrator to create:

- a parent ticket per operator request,
- a sub-ticket per specialist dispatch,
- comments with each specialist's reply,
- state transitions (In Progress → Done) tracking the lifecycle.

The operator sees the whole tree in real time on the Linear board. Useful when the orchestrator is delegating multi-step work and you want to know what's happening without scrolling chat.

Full protocol: [orchestrator/LINEAR.md](orchestrator/LINEAR.md). CLI: [tools/linear-ticket](tools/linear-ticket).

## Adding a new specialist

1. Pick an id (kebab-case, e.g. `media-agent`).
2. Create the isolated agent:
   ```bash
   openclaw agents add media-agent --non-interactive \
     --model ollama/kimi-k2.6:cloud \
     --workspace ~/.openclaw/agents/media-agent/workspace
   ```
3. Drop in an `AGENTS.md` describing its scope (use `agents/system-agent/AGENTS.md` as a starting point — same structure, different content).
4. Add it to the registry table in your orchestrator's `AGENTS.md`.
5. Restart the gateway.
6. Smoke-test: `openclaw agent --agent media-agent --message "Introduce yourself." --json --timeout 30`.

## Conventions

- **Orchestrator = the only conversational endpoint.** Operator talks only to the orchestrator. Specialists never address the operator directly.
- **30-second rule.** Anything the orchestrator can answer in ≤30s of inline tool use → answer inline, no dispatch. Everything else → dispatch.
- **Parallel cap.** No more than 2 specialist dispatches in flight at once. Sequential by default.
- **Failure handling.** If a specialist times out or returns junk, the orchestrator explains in plain language and offers next steps (retry / try another / hand back). No raw stack traces at the operator.
- **No secrets in tickets / comments / specialist replies passed through.** Truncate or redact before logging.

## License

MIT. Use it, fork it, change everything.

## Credits

Pattern crystallized while wrestling with a single-agent setup that kept hitting context limits. The agent-skill manifests in `skills/` are adapted from the [agent-orchestrator](https://github.com/lcp14262/agent-orchestrator) ClawHub skill (MIT-0) by lcp14262.

OpenClaw is at [openclaw.ai](https://openclaw.ai).
