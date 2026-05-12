<p align="center">
  <img src="banner.png" alt="openclaw-orchestra" width="100%">
</p>

# 🦞 openclaw-orchestra — Multi-Agent Orchestration for OpenClaw (Claude-Powered Autonomous Workflows)

[![GitHub stars](https://img.shields.io/github/stars/parijatmukherjee/openclaw-orchestra?style=social)](https://github.com/parijatmukherjee/openclaw-orchestra/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**🎼 Drop-in multi-agent orchestration pattern for [OpenClaw](https://openclaw.ai).**

> ⭐ **Find this useful?** Hit the star button up top — it helps other OpenClaw operators discover the pattern, and it tells me whether to keep iterating on it. Thank you. 🙏

One conversational orchestrator + six isolated specialist agents (🔧 `system`, ⌨️ `code`, 🔍 `research`, 📊 `data`, ✉️ `comm`, 👁️ `vision`). The operator only talks to the orchestrator. Specialists do the heavy lifting in their own workspaces, with their own memory and tools. Optional 📋 Linear-backed ticket oversight gives you a live board of what the swarm is working on.

```
┌─────────────────────────────────────────┐
│   🎼 Orchestrator (agent:main)           │
│  - Talks to the operator                │
│  - Picks the right specialist           │
│  - Dispatches via `openclaw agent`      │
│  - Synthesizes + reports                │
└─────────────────┬───────────────────────┘
                  │
    ┌─────────────┼─────────────┬─────────────┐
    │             │             │             │
┌───▼────┐  ┌────▼────┐  ┌────▼────┐  ┌────▼────┐
│🔧system│  │⌨️ code  │  │🔍research│  │📊 data  │  …
│ agent  │  │ agent   │  │ agent   │  │ agent   │
└────────┘  └─────────┘  └─────────┘  └─────────┘
```

---

## 🚀 Two ways to install

### 🤖 Let an AI agent install it for you

> ⚡ **This repo ships with a [`SKILL.md`](SKILL.md)** — an OpenClaw skill manifest that any capable agent (your existing OpenClaw orchestrator, Claude Code, or any AI with shell access on the host) can use to install and configure this pattern end to end.

🪄 **Step 1.** Drop the skill into your workspace:

```bash
mkdir -p ~/.openclaw/workspace/skills/openclaw-orchestra-installer
curl -fsSL https://raw.githubusercontent.com/parijatmukherjee/openclaw-orchestra/main/SKILL.md \
  > ~/.openclaw/workspace/skills/openclaw-orchestra-installer/SKILL.md
```

💬 **Step 2.** Ask your agent:

> "Install openclaw-orchestra on this host."

✨ The skill walks the agent through prerequisite checks, repo clone, agent creation, workspace overlay, optional Linear wiring, and end-to-end smoke tests. It will ask you the personalization questions (orchestrator name, vibe, host facts) before making changes.

💡 If you don't have a working orchestrator yet, you can paste the contents of `SKILL.md` into a Claude Code / Codex / any shell-capable AI session running on the target host.

---

### 🧑 Install it yourself

⏱️ The human path takes ~5 minutes:

```bash
# 1️⃣ Clone
git clone https://github.com/parijatmukherjee/openclaw-orchestra.git ~/openclaw-orchestra
cd ~/openclaw-orchestra

# 2️⃣ Create the 6 specialist agents
./scripts/setup.sh

# 3️⃣ Personalize each specialist's identity
for id in system-agent code-agent research-agent data-agent comm-agent vision-agent; do
  cp agents/$id/IDENTITY.md.template ~/.openclaw/agents/$id/workspace/IDENTITY.md
done
# then edit each ~/.openclaw/agents/<id>/workspace/IDENTITY.md
# (fill in your name + host)

# 4️⃣ Install the orchestrator workspace files
cp orchestrator/AGENTS.md       ~/.openclaw/workspace/AGENTS.md
cp orchestrator/TOOLS.md.template ~/.openclaw/workspace/TOOLS.md     # then edit
cp orchestrator/IDENTITY.md.template ~/.openclaw/workspace/IDENTITY.md  # then edit

# 5️⃣ Restart and smoke-test
openclaw gateway restart
openclaw agent --agent system-agent --message "Introduce yourself in one line." --json --timeout 30
```

📖 Full step-by-step (including the optional Linear integration) is in **[INSTALL.md](INSTALL.md)**.

---

## ✅ Prerequisites

- 🐚 **OpenClaw ≥ 2026.5.7** with the gateway running. Check: `openclaw --version` and `openclaw gateway status`.
- 🧠 **At least one working model with auth.** Defaults assume `ollama/kimi-k2.6:cloud` (text) and `ollama/kimi-k2.5:cloud` (vision). Substitute Anthropic / OpenAI / Groq / etc. via env vars to `setup.sh`.
- 🔐 **(Optional)** `op` (1Password CLI) and a Linear account if you want ticket oversight.

---

## 🔀 How dispatch works

The orchestrator runs this in its `exec` tool whenever it needs a specialist:

```bash
openclaw agent --agent <id> --message "<task>" --json --timeout <seconds>
```

The response is structured JSON. The orchestrator parses `result.payloads[0].text`, synthesizes it into its own voice, and replies to the operator.

📜 A typical conversation flow:

```
🗣️ operator: "Install Docker and confirm the daemon is running."
   ↓
🎼 orchestrator: "Delegating to system-agent — expect ~2 min."
   ↓ (dispatches in background; remains responsive in chat)
   ↓
🔧 system-agent: returns a structured report
   ↓
🎼 orchestrator: "Done. Docker 26.1 installed, daemon active. (Ticket DOB-12)"
```

If Linear is wired up, a parent ticket + sub-ticket(s) record this whole chain on your board.

---

## 🎭 What you get

Six specialist agents, each isolated:

| | Agent | Scope | Default model |
|---|-------|-------|---------------|
| 🔧 | `system-agent` | apt, systemd, ufw, cron, disk, logs, host config | `ollama/kimi-k2.6:cloud` |
| ⌨️ | `code-agent` | software dev, debugging, testing, git | `ollama/kimi-k2.6:cloud` |
| 🔍 | `research-agent` | web research, comparisons, sourced reports | `ollama/kimi-k2.6:cloud` |
| 📊 | `data-agent` | CSV/JSON/Excel parsing, analysis, charts | `ollama/kimi-k2.6:cloud` |
| ✉️ | `comm-agent` | email/chat drafts, calendar (always drafts — never auto-sends) | `ollama/kimi-k2.6:cloud` |
| 👁️ | `vision-agent` | image analysis, OCR, screenshots | `ollama/kimi-k2.5:cloud` (vision-capable) |

Each one is a **true top-level OpenClaw agent** (`openclaw agents add <id>`) — not a subagent — with its own `~/.openclaw/agents/<id>/workspace/`, its own memory dir, its own scoped persona in `AGENTS.md`.

---

## 🤔 Why this pattern?

A single OpenClaw agent that "does everything" hits two walls quickly:

1. 🧱 **Context bloat.** Every tool, every memory, every skill loads on every turn. Trivial routing decisions pay the same token cost as deep domain work.
2. 🪞 **No real specialization.** Subagents share the parent's workspace and memory — isolation is conventional, not structural.

✨ This pattern solves both:

- 🪶 The orchestrator stays lean: routing + light conversation + quick lookups (≤30s inline).
- 🧱 Specialists are independent processes with their own contexts. Their memory and learning accumulate per-domain.
- 🎯 Dispatch is one CLI command. Response is structured JSON. The orchestrator handles the synthesis.

---

## 📋 Optional: Linear oversight

[Linear](https://linear.app) gives the operator a live view of what the orchestrator is doing. Wire it up and every non-trivial dispatch creates:

- 🗂️ a **parent ticket** per operator request,
- 📌 a **sub-ticket** per specialist dispatch,
- 💬 **comments** with each specialist's reply,
- 🚦 **state transitions** (In Progress → Done) tracking the lifecycle.

🤫 Trivial inline-handled requests (jokes, weather, ≤30s lookups) don't get tickets, so the board doesn't fill with noise.

Setup is in [orchestrator/LINEAR.md](orchestrator/LINEAR.md). CLI is [tools/linear-ticket](tools/linear-ticket) (Python, stdlib-only, ~250 lines).

---

## ➕ Adding a new specialist

1. 🆔 Pick an id (kebab-case, e.g. `media-agent`).
2. 🏗️ Create the agent: `openclaw agents add media-agent --non-interactive --model <model> --workspace ~/.openclaw/agents/media-agent/workspace`
3. 📝 Drop in an `AGENTS.md` (use any specialist's as a starting point — same structure, different scope).
4. 🎭 Personalize `IDENTITY.md`.
5. 📚 Add it to the registry table in `~/.openclaw/workspace/AGENTS.md` (your orchestrator's workspace doc).
6. 🔄 Restart gateway. 🧪 Smoke-test.

---

## 📁 Repository layout

```
openclaw-orchestra/
├── 🤖 SKILL.md                 # AI agent installer manifest
├── 📖 README.md                # You are here
├── 📘 INSTALL.md               # Detailed human install guide
├── ⚖️  LICENSE                 # MIT
├── 🎼 orchestrator/            # Goes into your main agent's workspace
│   ├── AGENTS.md               # Dispatch protocol + architecture
│   ├── TOOLS.md.template       # Tool surface (template)
│   ├── IDENTITY.md.template    # Orchestrator identity (template)
│   └── LINEAR.md               # Optional ticket oversight protocol
├── 🎭 agents/                  # One subdir per specialist
│   ├── system-agent/   🔧
│   │   ├── AGENTS.md           # Scoped persona
│   │   └── IDENTITY.md.template
│   ├── code-agent/     ⌨️
│   ├── research-agent/ 🔍
│   ├── data-agent/     📊
│   ├── comm-agent/     ✉️
│   └── vision-agent/   👁️
├── 🧩 skills/                  # Per-specialist skill manifests
├── 🛠️  tools/
│   ├── linear-ticket           # Linear CLI (stdlib Python)
│   └── linear.json.template    # Linear config template
└── 🚀 scripts/setup.sh         # Bootstrap script
```

---

## 📐 Conventions

- 🗣️ **Orchestrator = the only conversational endpoint.** The operator talks only to the orchestrator. Specialists never address the operator directly.
- ⏱️ **30-second rule.** Anything the orchestrator can answer in ≤30s of inline tool use → answer inline. Everything else → dispatch.
- 🚦 **Parallel cap.** No more than 2 specialist dispatches in flight at once. Sequential by default.
- 🩹 **Failure handling.** Specialist timeouts and errors get surfaced in plain language with next-step options. No raw stack traces at the operator.
- 🔒 **No secrets** in tickets, comments, or specialist replies passed through. Truncate or redact before logging.

---

## ⭐ One more thing

If `openclaw-orchestra` saved you from a tangled single-agent setup, **please [star the repo](https://github.com/parijatmukherjee/openclaw-orchestra/stargazers)** — it's the only signal I get that the pattern is landing for people, and it surfaces it to other OpenClaw operators. 🙏

PRs welcome too. Especially: async dispatch, per-agent skill scoping, alternative ticket backends (GitHub Issues / Notion / Plane), and adapters for other agent runtimes.

---

## ⚖️ License

📜 MIT. Use it, fork it, change everything.

---

## 🙏 Credits

🌱 Pattern crystallized while wrestling with a single-agent setup that kept hitting context limits.

🧩 The agent-skill manifests in `skills/` are adapted from the [agent-orchestrator](https://github.com/lcp14262/agent-orchestrator) ClawHub skill (MIT-0) by lcp14262.

🦞 OpenClaw is at [openclaw.ai](https://openclaw.ai).
