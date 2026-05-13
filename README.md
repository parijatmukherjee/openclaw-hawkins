<p align="center">
  <img src="banner.png" alt="openclaw-hawkins — The Nexus · The Tendrils · The Hive — Everything is Connected" width="100%">
</p>

# 🩸 Openclaw Hawkins — Multi-Agent Orchestration for OpenClaw

[![CI](https://github.com/parijatmukherjee/openclaw-hawkins/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/parijatmukherjee/openclaw-hawkins/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/parijatmukherjee/openclaw-hawkins/branch/main/graph/badge.svg)](https://codecov.io/gh/parijatmukherjee/openclaw-hawkins)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-43853d?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Code style: Prettier](https://img.shields.io/badge/code_style-prettier-E60000?logo=prettier&logoColor=white)](https://prettier.io)
[![Lint: ESLint](https://img.shields.io/badge/lint-eslint-4b32c3?logo=eslint&logoColor=white)](https://eslint.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-E60000.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/parijatmukherjee/openclaw-hawkins?style=flat&logo=github&logoColor=white&color=E60000&label=stars)](https://github.com/parijatmukherjee/openclaw-hawkins/stargazers)

> **Everything is Connected.**

A drop-in multi-agent orchestration pattern for [OpenClaw](https://openclaw.ai). One conversational orchestrator (**the Nexus**) coordinates six isolated specialist agents (**the Tendrils**), with optional durable state (**VINES**) and Linear-backed ticket oversight. The brand vocabulary is [Stranger Things](https://www.netflix.com/title/80057281)–coloured; the protocol is grounded engineering.

> ⭐ **Find this useful?** Star the repo — it surfaces the pattern to other OpenClaw operators and tells me whether to keep iterating. 🩸

---

## 🕸️ Architecture (the Hive-Mind hierarchy)

```
                ┌─────────────────────────────────────────┐
                │   🎼 The Nexus (orchestrator:main)       │
                │  - Talks to the operator                │
                │  - Decides who handles what             │
                │  - Drives The Pulse end-to-end          │
                │  - Synthesises + reports                │
                └─────────────────┬───────────────────────┘
                                  │ openclaw agent --agent <id> --message "..."
        ┌─────────────────────────┼─────────────────────────┐
        │             │           │           │             │
   ┌────▼───┐    ┌────▼────┐  ┌───▼─────┐  ┌──▼────┐    ┌───▼────┐
   │🔧system│    │⌨️ code  │  │🔍research│  │📊 data│    │ … six  │
   │ agent  │    │ agent   │  │  agent  │  │ agent │    │tendrils│
   └────────┘    └─────────┘  └─────────┘  └───────┘    └────────┘
                                  │
                ┌─────────────────▼──────────────────┐
                │   🧠 The Hive — durable memory     │
                │   • vines_ledger   (orchestration  │
                │      state, per request)           │
                │   • vecna_hive  (shared knowledge) │
                └────────────────────────────────────┘
```

Three layers, full vocabulary in [`docs/branding.md`](docs/branding.md):

- **The Nexus** — the orchestrator. Operator talks only here.
- **The Tendrils** — the six specialists. `system-agent`, `code-agent`, `research-agent`, `data-agent`, `comm-agent`, `vision-agent`.
- **The Hive** — MariaDB-backed persistence. VINES (orchestration state) + VECNA (shared knowledge fragments, see [`vecna/spec.md`](vecna/spec.md)).

---

## 🚀 Three ways to install

### 🔌 As an OpenClaw plugin (recommended)

⚡ **Two commands** if you already have OpenClaw ≥ 2026.5.0 and a reachable MariaDB. This is the fastest path and the one you should use unless you specifically want to work from source.

```bash
# 1. Install from ClawHub (npm fallback works too)
openclaw plugins install clawhub:openclaw-hawkins \
  || openclaw plugins install npm:openclaw-hawkins

# 2. Provision schemas + the 6 specialist agents in one shot
openclaw hawkins setup
```

✨ The plugin registers **12 typed tools** (`vines_*` × 6, `vecna_*` × 6) with the OpenClaw runtime — any agent in your gateway can call them by name. The `hawkins setup` command also prints an exhaustive **post-install banner** listing every tool, verification commands, and the remaining personalisation steps, so a human operator _or_ an AI installer agent can finish the install without consulting any other doc.

Configure the plugin via `openclaw config`:

```bash
openclaw config set plugins.entries.openclaw-hawkins.config.mariadb.url  "mariadb://your-host:3306/hawkins"
openclaw config set plugins.entries.openclaw-hawkins.config.mariadb.user "hawkins"
openclaw config set plugins.entries.openclaw-hawkins.config.mariadb.ssl  "insecure"     # for self-signed cloud certs
# Password MUST come from the gateway env — the plugin schema refuses to store it in openclaw.json.
```

🔒 **Secrets policy:** `MARIADB_PASSWORD` and `LINEAR_API_KEY` are read from the gateway's environment only — never from `openclaw.json`. The plugin's config schema deliberately rejects them. Wire them via a 0600 systemd `EnvironmentFile` (the post-install banner shows the exact recipe), or feed them from 1Password using the SKILL.md recipe.

---

### 🤖 Let an AI agent install it for you

> ⚡ **This repo ships with a [`SKILL.md`](SKILL.md)** — an OpenClaw skill manifest that any capable agent (your existing OpenClaw orchestrator, or any AI assistant with shell access on the host) can use to install and configure this pattern end to end.

🪄 **Step 1.** Drop the skill into your workspace:

```bash
mkdir -p ~/.openclaw/workspace/skills/openclaw-hawkins-installer
curl -fsSL https://raw.githubusercontent.com/parijatmukherjee/openclaw-hawkins/main/SKILL.md \
  > ~/.openclaw/workspace/skills/openclaw-hawkins-installer/SKILL.md
```

💬 **Step 2.** Ask your agent: _"Install openclaw-hawkins on this host."_

✨ The skill walks the agent through prerequisite checks, repo clone, agent creation, workspace overlay, optional Linear wiring, and end-to-end smoke tests. It asks the personalisation questions (Nexus name, vibe, host facts) before making any changes.

---

### 🧑 Install it yourself (from source)

⏱️ The from-source path takes ~5 minutes — useful when working on a feature branch or air-gapped host:

```bash
# 1️⃣ Clone — pin to the latest release tag so the source tree is immutable
git clone --branch v1.0.2 --depth 1 https://github.com/parijatmukherjee/openclaw-hawkins.git ~/openclaw-hawkins
cd ~/openclaw-hawkins

# 2️⃣ Create the 6 specialist agents
./scripts/setup.sh

# 3️⃣ Personalise each specialist's identity
for id in system-agent code-agent research-agent data-agent comm-agent vision-agent; do
  cp agents/$id/IDENTITY.md.template ~/.openclaw/agents/$id/workspace/IDENTITY.md
done

# 4️⃣ Install the Nexus's workspace files
cp orchestrator/AGENTS.md           ~/.openclaw/workspace/AGENTS.md
cp orchestrator/TOOLS.md.template   ~/.openclaw/workspace/TOOLS.md     # then edit
cp orchestrator/IDENTITY.md.template ~/.openclaw/workspace/IDENTITY.md # then edit

# 5️⃣ Restart and smoke-test
openclaw gateway restart
openclaw agent --agent system-agent --message "Introduce yourself in one line." --json --timeout 30
```

📖 Full step-by-step (Linear + VINES) lives in **[INSTALL.md](INSTALL.md)**.

---

## ✅ Prerequisites

**The minimum (Nexus + Tendrils, no Hive):**

- 🐚 **OpenClaw ≥ 2026.5.7** with the gateway running. Check: `openclaw --version` and `openclaw gateway status`.
- 🧠 **At least one model with auth.** Defaults assume `ollama/kimi-k2.6:cloud` (text) and `ollama/kimi-k2.5:cloud` (vision). Substitute OpenAI / Groq / any Anthropic-compatible provider via env vars to `setup.sh`.

**Optional add-ons:**

- 📋 A **Linear** account (any plan) if you want ticket oversight. The CLI reads its API key from `$LINEAR_API_KEY` by default; if you'd rather keep the key in 1Password, the [`op` CLI](https://developer.1password.com/docs/cli/) is a supported fallback (see `orchestrator/LINEAR.md`). Neither `op` nor a 1Password account is required.
- 🟢 **Node ≥ 20** + a **MariaDB** instance (local or cloud — TLS supported including self-signed via `MARIADB_SSL=insecure`) if you want **VINES**, the durable-state layer.

---

## 🔀 The Pulse (how dispatch flows)

When the Nexus decides a request isn't trivial, it enters **The Pulse**. Five named phases:

```
operator request
       ↓
🩸 Sensitivity Check    → does this need the full protocol?  (vines triage)
       ↓ (yes)
🩸 Anchoring            → parent Linear ticket + VINES row   (linear-ticket create / vines start)
       ↓
🩸 Deep Seeking         → optional research-agent dispatch
       ↓
🩸 The Connection       → loop dispatch to each Tendril       (openclaw agent --agent ...)
       ↓
🩸 Consolidation        → close tickets + final reply         (vines set-state ... success)
```

Detailed worked examples + log strings: [`docs/pulse-protocol.md`](docs/pulse-protocol.md). Spec contract: [`vines/spec.md`](vines/spec.md).

A typical conversation:

```
🗣️ operator: "Install Docker and confirm the daemon is running."
   ↓
🎼 Nexus: "Anchoring as ENG-12. Connecting to the Web…"
   ↓ (dispatches in background; remains responsive in chat)
   ↓
🔧 system-agent: returns a structured report
   ↓
🎼 Nexus: "Consolidating. Docker 26.1 installed, daemon active. (ENG-12)"
```

---

## 🎭 The Tendrils

Six specialists, each a true top-level OpenClaw agent (`openclaw agents add <id>`) — not a subagent — with its own `~/.openclaw/agents/<id>/workspace/`, memory dir, and scoped persona in `AGENTS.md`.

|     | Agent (functional id) | Brand alias    | Scope                                                          | Default model            |
| --- | --------------------- | -------------- | -------------------------------------------------------------- | ------------------------ |
| 🔧  | `system-agent`        | sys-tendril    | apt, systemd, ufw, cron, disk, logs, host config               | `ollama/kimi-k2.6:cloud` |
| ⌨️  | `code-agent`          | code-tendril   | software dev, debugging, testing, git                          | `ollama/kimi-k2.6:cloud` |
| 🔍  | `research-agent`      | search-tendril | web research, comparisons, sourced reports                     | `ollama/kimi-k2.6:cloud` |
| 📊  | `data-agent`          | data-tendril   | CSV/JSON/Excel parsing, analysis, charts                       | `ollama/kimi-k2.6:cloud` |
| ✉️  | `comm-agent`          | comm-tendril   | email/chat drafts, calendar (always drafts — never auto-sends) | `ollama/kimi-k2.6:cloud` |
| 👁️  | `vision-agent`        | vision-tendril | image analysis, OCR, screenshots                               | `ollama/kimi-k2.5:cloud` |

> The functional ids stay stable for OpenClaw. Tendril aliases are used in branded prose; they don't replace the ids in code, on disk, or in `openclaw agent --agent ...` invocations.

---

## 🤔 Why this pattern?

A single OpenClaw agent that "does everything" hits two walls fast:

1. 🧱 **Context bloat.** Every tool, every memory, every skill loads on every turn. Trivial routing pays the same token cost as deep domain work.
2. 🪞 **No real specialisation.** Subagents share the parent's workspace and memory — isolation is conventional, not structural.

✨ This pattern solves both:

- 🪶 The Nexus stays lean: routing + light conversation + quick lookups (≤ 30 s inline).
- 🧱 Tendrils are independent processes with their own contexts. Memory and learning accumulate per-domain.
- 🎯 Dispatch is one CLI command. Response is structured JSON. The Nexus handles synthesis.

---

## 📋 Optional: Linear oversight (Anchoring + ticket lifecycle)

[Linear](https://linear.app) gives the operator a live view of what the Nexus is doing. Wire it up and every non-trivial Pulse creates:

- 🗂️ a **parent ticket** per operator request,
- 📌 a **sub-ticket** per Tendril dispatch,
- 💬 **comments** with each Tendril's reply,
- 🚦 **state transitions** (In Progress → Done).

🤫 Trivial inline-handled requests (jokes, weather, ≤ 30 s lookups) don't get tickets, so the board doesn't fill with noise.

Setup: [`orchestrator/LINEAR.md`](orchestrator/LINEAR.md). CLI: [`tools/linear-ticket`](tools/linear-ticket) (Node ≥ 20, built-ins only — no `npm install` needed to run it).

---

## 🧠 Durable orchestration with **VINES** — _Versatile Integration for Networked Execution & State_

The Nexus + Tendrils pattern above is **stateless**: a crash mid-Pulse loses the plan. **VINES** is the durability layer — a Node/TypeScript library + CLI that adds **persistent orchestration state in MariaDB and Linear-backed recovery** to the same pattern. Canonical spec: [`vines/spec.md`](vines/spec.md).

> 🧭 **Mental model.** VINES owns _state_ — one durable row per request that records "where am I in this orchestration, who's the active Tendril, what's the Linear parent ticket". If the host reboots mid-Pulse, VINES is what lets the Nexus pick up exactly where it left off instead of asking the operator to start over.

What you get:

- 💾 **Survives restarts.** A single `orchestration_ledger` row per request; recovery scans for unfinished runs on startup and cross-references Linear for the resume point.
- 🩸 **Sensitivity Check gate.** Spec §3.1: protocol fires only when work is estimated > 30 s **or** spans > 2 specialist domains. Trivial requests bypass it.
- 🧭 **Linear-anchored recovery.** Every durable orchestration carries a `linearParentId`; `vines recover` walks the parent's children to figure out the last completed step + next pending one, and **distinguishes transient Linear API errors from truly orphaned work** so a flaky network never destroys live state.
- 🔍 **Operator visibility.** `vines status` and `vines recover` give a live view of the swarm without opening Linear.

Install (after MariaDB is available — local or cloud):

```bash
make install                             # npm ci / npm install
make build                               # compile TypeScript → dist/
export MARIADB_URL=mariadb://h:3306/hawkins
export MARIADB_USER=hawkins
export MARIADB_PASSWORD=...
export LINEAR_API_KEY=lin_api_...
make bootstrap-vines-db                  # apply vines/schema.sql
npx vines status                         # confirm the ledger is reachable
```

Full env-var matrix and the worked end-to-end agent integration sequence: [`INSTALL.md §9`](INSTALL.md). Library + CLI API: [`src/`](src/).

---

## 🐙 Shared memory with **VECNA** — _Versatile Entity for Contextual Network Awareness_

Where VINES owns _state_, **VECNA** owns _memory_. It is the Hive's **cross-orchestration knowledge layer** — a Node/TypeScript service + client + CLI that gives every Tendril a shared, searchable, decay-aware memory of what the swarm has learned across every request it has ever handled. Canonical spec: [`vecna/spec.md`](vecna/spec.md).

> 🧬 **Mental model.** When `system-agent` discovers something useful at 3 PM ("setting `innodb_buffer_pool_size` to 2G fixed our latency on Ubuntu 24.04") it calls `vecna connect`. When `data-agent` hits a similar problem at 9 PM, it calls `vecna recall mariadb-tuning` and gets back the fragment, already ranked by importance, ticket-affinity, and recency. The Nexus pre-fetches relevant memory at the start of each Pulse and injects it into the next prompt. **The swarm stops forgetting.**

What you get:

- 🩸 **Topic-based recall.** `GET /v1/recall/:topic` returns non-deprecated fragments ranked by ticket-affinity → `importance` (1–5) → recency, with a decay penalty for stale (> 6 months) low-importance entries. Pick `format=json` for programmatic use or `format=context` to receive a pre-summarised string ready to inject into the next prompt.
- 🧬 **Knowledge evolution.** When an old memory is wrong (outdated API version, deprecated config knob), any Tendril calls `vecna evolve <id>` — VECNA atomically deprecates the old fragment and inserts the corrected one on the same topic, so the recall pipeline self-corrects over time.
- 🔁 **Dedup window.** Repeated high-importance writes within a 5-minute window are collapsed instead of producing noise; the existing fragment is returned with a `deduplicated: true` flag.
- 🔍 **Global full-text search.** When no clear topic is known, `vecna search "<keyword>"` falls back to `MATCH(content) AGAINST (?)` across every non-deprecated fragment.
- 🩻 **Decay logic.** Recall ranking automatically deprioritises fragments older than 6 months unless `importance = 5` ("vital") — enforced at query time in the `ORDER BY`, no background job needed.
- 🌐 **Two deployment modes.** Embed `HiveStore` directly in any Node process for in-process recall, or run the standalone `vecna serve` HTTP Nexus (Express, optional Bearer auth, default `127.0.0.1:8765`) so non-Node Tendrils can talk to the Hive over the network.

Install (after MariaDB is available):

```bash
make bootstrap-vecna-db                  # apply vecna/schema.sql
export VECNA_AUTH_TOKEN=$(openssl rand -hex 32)   # optional but recommended
make vecna-serve                         # start the Hive Nexus on 127.0.0.1:8765
# in another shell:
vecna connect --topic mariadb-tuning \
              --content "innodb_buffer_pool_size=2G fixed our latency" \
              --source system-agent --importance 5
vecna recall mariadb-tuning              # see the fragment come back
```

Full env-var matrix (port, auth token, dedup window) + the hardened systemd user unit for production: [`INSTALL.md §10`](INSTALL.md). HTTP API contract: [`vecna/spec.md §5`](vecna/spec.md). Library + CLI: [`src/hive/`](src/hive/).

---

## ➕ Adding a new Tendril

1. 🆔 Pick a functional id (kebab-case, e.g. `media-agent`).
2. 🏗️ `openclaw agents add media-agent --non-interactive --model <model> --workspace ~/.openclaw/agents/media-agent/workspace`
3. 📝 Drop in an `AGENTS.md` (start from any specialist's as a template).
4. 🎭 Personalise `IDENTITY.md`.
5. 📚 Add it to the registry table in `~/.openclaw/workspace/AGENTS.md` (your Nexus's workspace doc).
6. 🔄 Restart gateway. 🧪 Smoke-test.

---

## 📁 Repository layout

```
openclaw-hawkins/
├── 🤖 SKILL.md                 # AI agent installer manifest
├── 📖 README.md                # You are here
├── 📘 INSTALL.md               # Detailed human install guide
├── 🧪 CHANGELOG.md             # Notable changes
├── 🤝 CONTRIBUTING.md          # How to contribute
├── 🛡️  SECURITY.md             # Vulnerability disclosure
├── ⚖️  LICENSE                 # MIT
├── 🧰 Makefile                 # Operator + developer entrypoints
├── 📦 package.json             # npm package metadata, scripts, deps
├── 🩸 docs/                    # Brand + workflow vocabulary
│   ├── branding.md             # Naming + tone + colors (canonical)
│   ├── pulse-protocol.md       # Phase-by-phase workflow reference
│   └── colors.json             # Design tokens
├── 🧠 vines/                   # VINES subsystem — canonical contract
│   ├── spec.md                 # The specification (source of truth)
│   └── schema.sql              # `orchestration_ledger` table
├── 🧱 src/                     # VINES TypeScript implementation
│   ├── persistence.ts          # MariaDB ledger CRUD
│   ├── linear-client.ts        # Linear GraphQL client
│   ├── dispatcher.ts           # openclaw agent --json wrapper
│   ├── orchestrator.ts         # §3 protocol engine + §3.1 Sensitivity Check
│   ├── recovery.ts             # §4.2 cross-reference + resume
│   └── cli.ts                  # `vines` CLI
├── 🧪 tests/                   # vitest suites; coverage gated in CI
├── 🎼 orchestrator/            # Goes into your Nexus's workspace
│   ├── AGENTS.md               # Dispatch protocol + architecture
│   ├── TOOLS.md.template       # Tool surface (template)
│   ├── IDENTITY.md.template    # Nexus identity (template)
│   └── LINEAR.md               # Optional ticket oversight protocol
├── 🎭 agents/                  # One subdir per Tendril
│   ├── system-agent/   🔧
│   ├── code-agent/     ⌨️
│   ├── research-agent/ 🔍
│   ├── data-agent/     📊
│   ├── comm-agent/     ✉️
│   └── vision-agent/   👁️
├── 🧩 skills/                  # Per-Tendril skill manifests
├── 🛠️  tools/
│   ├── linear-ticket           # Linear CLI (Node, built-ins only)
│   └── linear.json.template    # Linear config template
└── 🚀 scripts/
    ├── setup.sh                # Tendril bootstrap
    └── bootstrap-vines-db.sh   # Apply vines/schema.sql via mariadb client
```

---

## 📐 Conventions

- 🗣️ **Nexus = the only conversational endpoint.** The operator talks only to the Nexus. Tendrils never address the operator directly.
- ⏱️ **30-second rule.** Anything the Nexus can answer in ≤ 30 s of inline tool use → answer inline. Everything else → The Connection.
- 🚦 **Parallel cap.** No more than 2 Tendril dispatches in flight at once. Sequential by default.
- 🩹 **Failure handling.** Tendril timeouts and errors get surfaced in plain language with next-step options. No raw stack traces at the operator.
- 🔒 **No secrets** in tickets, comments, or Tendril replies. Truncate or redact before logging.

---

## 🧪 Quality

Each badge at the top of this README maps to a real, enforced gate:

| Badge                         | What it guarantees                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟢 **CI**                     | Every push and PR runs the full pipeline on Node 20 and 22. PRs can't merge red.                                                                            |
| 📊 **Coverage**               | `vitest --coverage` with v8 — gated at **statements ≥ 95 %, functions ≥ 95 %, branches ≥ 88 %, lines ≥ 95 %**. Falling below fails CI.                      |
| 📘 **TypeScript: strict**     | `tsconfig.json` enables `strict`, `noUnusedLocals`, `noUnusedParameters`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, `noImplicitOverride`. |
| 💅 **Code style: Prettier**   | `npm run format:check` runs in CI.                                                                                                                          |
| 🧹 **Lint: ESLint**           | Flat config with `typescript-eslint` _recommended-type-checked_. PRs with lint errors fail CI.                                                              |
| 🐚 **(Hidden)** shell scripts | `shellcheck` runs against `scripts/` in CI.                                                                                                                 |

### Run the suites locally

```bash
make install           # one-time
make check             # lint + format-check + typecheck + tests (the CI gate)
make coverage          # tests with coverage thresholds enforced
make smoke             # smoke tests against real MariaDB / Linear / openclaw
                       # (auto-skipped when env vars are absent — see CONTRIBUTING.md)
```

The smoke suite under `tests/smoke/` exists _in addition_ to the hermetic unit suite. It's gated on env-var presence (`MARIADB_URL`, `LINEAR_API_KEY`, …) so contributors can run `make check` safely without secrets while operators can verify the wiring end-to-end with real services.

---

## ⭐ One more thing

If `openclaw-hawkins` saved you from a tangled single-agent setup, **please [star the repo](https://github.com/parijatmukherjee/openclaw-hawkins/stargazers)** — it's the only signal I get that the pattern is landing, and it surfaces it to other OpenClaw operators. 🩸

PRs welcome too. Especially: **OpenClaw plugin packaging** (tracked in [#2](https://github.com/parijatmukherjee/openclaw-hawkins/issues/2)), async dispatch, per-Tendril skill scoping, alternative ticket backends (GitHub Issues / Notion / Plane), and adapters for other agent runtimes.

---

## ⚖️ License

📜 MIT. Use it, fork it, change everything.

---

## 🙏 Credits

🌱 Pattern crystallised while wrestling with a single-agent setup that kept hitting context limits.

🧩 The Tendril-skill manifests in `skills/` are adapted from the [agent-orchestrator](https://github.com/lcp14262/agent-orchestrator) ClawHub skill (MIT-0) by lcp14262.

🦞 OpenClaw is at [openclaw.ai](https://openclaw.ai). The Stranger Things brand vocabulary belongs to Netflix and the Duffer Brothers; this repo uses it as homage only.
