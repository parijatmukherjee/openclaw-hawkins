# Branding Strategy — openclaw-hawkins

This document is the canonical brand reference for `openclaw-hawkins`.
Anything the repo presents to a reader — README copy, log strings, doc
tone, banner art, badge colours — derives from what's written here.

> **Tagline:** _Everything is Connected._

## 1. Primary identity

|                     |                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Repository          | `openclaw-hawkins`                                                                            |
| Theme               | Hawkins, Indiana — the town from _Stranger Things_ where every layer of the system converges. |
| Atmospheric posture | Objective, high-performance, slightly omniscient.                                             |
| Visual posture      | Pulse Red on Void Black, with Vascular Maroon as accent.                                      |

## 2. Brand architecture (Hive-Mind hierarchy)

The system has three layers. Code, docs, and logs use the layer's
brand name when speaking _about_ the layer, while keeping technical
identifiers (file names, env vars, CLI binaries) stable.

### 2.1 The Nexus — the orchestrator

The central intelligence. Breaks down user intent, drives the protocol,
synthesises results.

- **Codebase term:** orchestrator (the existing `orchestrator/` directory
  and `agent:main` slot).
- **Brand term:** _the Nexus_.
- **User-facing persona name:** whatever the operator chooses (Dobby,
  Maestro, Conductor, …).

### 2.2 The Tendrils — the specialist agents

The specialist workers. Each handles one domain.

| Functional id (code) | Brand term     |
| -------------------- | -------------- |
| `system-agent`       | sys-tendril    |
| `code-agent`         | code-tendril   |
| `research-agent`     | search-tendril |
| `data-agent`         | data-tendril   |
| `comm-agent`         | comm-tendril   |
| `vision-agent`       | vision-tendril |

> **Important:** the functional ids are the source of truth in code and
> on the host. Tendril names are _aliases_ used in branded prose. We do
> not rename agents at the OpenClaw level — that would break every
> operator who's already run `setup.sh`.

### 2.3 The Hive — the persistence layer

The "Upside Down" of the system. Memory that survives sessions.

- **Codebase term:** the `vines_ledger` table (state, owned by VINES) and
  the `vecna_hive` table (knowledge, owned by VECNA — to be added).
- **Brand term:** _the Hive_.
- **Key verb:** agents don't _save data_; they _connect to the Hive_.

## 3. The Pulse (workflow naming)

When a single-turn reply isn't enough and the system enters the protocol,
it enters **The Pulse**. Each technical phase has a brand alias:

| Technical phase | Brand alias       | Description                                                                  |
| --------------- | ----------------- | ---------------------------------------------------------------------------- |
| Triage          | Sensitivity Check | Detecting if the task is complex (> 30 s of work or > 2 specialist domains). |
| Ticket Creation | Anchoring         | Creating the Linear parent ticket.                                           |
| Research        | Deep Seeking      | Querying the search-tendril (`research-agent`).                              |
| Delegation      | The Connection    | Dispatching tasks to multiple Tendrils.                                      |
| Completion      | Consolidation     | Merging results into a final report.                                         |

Detailed mapping with worked examples lives in
[`pulse-protocol.md`](pulse-protocol.md).

## 4. Messaging and tone

The tone is **objective, high-performance, slightly omniscient**. Logs
and user-facing copy occasionally lean into the Stranger Things register
without becoming kitsch.

### Reserved phrases

| Phrase                     | When to use                                         |
| -------------------------- | --------------------------------------------------- |
| _"The Hive remembers."_    | A successful memory recall returned useful context. |
| _"Connecting to the Web…"_ | Dispatching to a Tendril.                           |
| _"Evolving knowledge…"_    | An agent corrects or supersedes a past memory.      |
| _"Anchoring…"_             | Creating the Linear parent ticket.                  |
| _"Consolidating."_         | Composing the final synthesised reply.              |

Use these sparingly. Once per phase per request is plenty.

## 5. Visual language

### Palette

| Role      | Name            | Hex       |
| --------- | --------------- | --------- |
| Primary   | Pulse Red       | `#E60000` |
| Secondary | Void Black      | `#000000` |
| Tertiary  | Vascular Maroon | `#4A0E0E` |

Machine-readable tokens: [`colors.json`](colors.json).

### Imagery

- Interconnected networks. Neural webs. Vines tangled around nodes.
- Clock-face motifs (the passage of time and the chime of state
  transitions).
- High contrast: black backgrounds, red accents, occasional maroon glow.

### Where the palette appears

- README badges (where shields.io supports custom hex).
- The banner image at the top of the README.
- Social preview image (1280×640).
- Diagram strokes in docs (when rendering, not in ASCII).

## 6. What is intentionally NOT branded

To keep the repo usable by operators who don't care about the Stranger
Things motif:

- **Agent ids** (`system-agent`, `code-agent`, …) — stable for OpenClaw.
- **Env var names** (`MARIADB_URL`, `LINEAR_API_KEY`, …) — subsystem-agnostic.
- **CLI binary names** (`vines`, soon `vecna`) — short, ergonomic.
- **Table names** (`vines_ledger`, `vecna_hive`) — descriptive.
- **Spec documents** (`vines/spec.md`, soon `vecna/spec.md`) — technical
  contracts. The branding overlay lives in narrative docs, not in the
  specifications it would muddy.

The line: _brand the prose, not the protocol._
