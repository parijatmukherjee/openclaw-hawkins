# Specification: VINES (Versatile Integration for Networked Execution & State)

This document is the canonical specification for the VINES subsystem of
`openclaw-hawkins`. The Node/TypeScript implementation under `src/` and the
operator docs (INSTALL.md, orchestrator/AGENTS.md) all reference this file.
If behaviour drifts from the spec, the spec wins — update the spec first,
then the implementation.

## 1. Overview

VINES (Versatile Integration for Networked Execution & State) is a supervisor-pattern logic framework
designed to manage complex, multi-step tasks. It bridges the gap between
high-level user intent and a specialized worker swarm, utilising Linear for
project management and a cloud MariaDB instance for durable state
persistence and session recovery.

## 2. System Architecture

The orchestrator governs a hub-and-spoke model, coordinating several
specialised domain agents to complete goals that exceed simple single-turn
interactions.

- **Orchestrator** — the central logic engine and decision-maker.
- **Specialised worker swarm:**
  - `research-agent` — internet-connected data gathering and documentation
  - `system-agent` — CLI, infrastructure, and server-side operations
  - `code-agent` — software development, scripting, and logic verification
  - `data-agent` — database management and structured data analysis
  - `comm-agent` — drafting reports, professional messaging, and documentation
  - `vision-agent` — image analysis and visual log inspection
- **External state engines:**
  - Linear API — primary task tracking and project visualisation
  - Cloud MariaDB — persistent session memory and metadata storage

## 3. Operational Protocol

### 3.1 Triage Condition

The orchestrator activates this protocol for any task estimated to require
**more than 30 seconds of execution time** *or* **involving more than two
specialised agent domains**.

Trivial inline requests (one-liners, quick lookups, conversation) bypass the
protocol entirely — no ledger row, no Linear ticket.

### 3.2 Execution Workflow

1. **Ticket Initialization (Linear).** Create a parent ticket in the
   project-management system to track the overall goal.
2. **Persistence.** Record the `linear_parent_id`, objective summary, and
   initial state in the cloud MariaDB ledger. This row is the recovery
   anchor.
3. **Context Augmentation (Research Gate).** Determine whether sufficient
   information exists to proceed. If not, dispatch `research-agent` and
   attach gathered documentation as a comment on the parent ticket.
4. **Strategic Planning.** Decompose the goal into a structured list of
   actionable sub-tasks. Create a child ticket for every discrete step,
   linked to the parent.
5. **Specialised Dispatch.** Delegate sub-tasks to worker agents based on
   the domain requirement of each step.
6. **Synchronisation & Verification.** Monitor worker outputs. Update each
   child ticket to `Done` in Linear only upon successful verification.
7. **Final Reporting.** Mark the parent ticket `Done`. Compile a final
   summary report for the operator detailing actions taken and the
   outcome.

## 4. Technical Configuration

### 4.1 Persistence Schema (MariaDB)

The orchestrator maintains a ledger in the cloud database to ensure
idempotency and the ability to resume tasks after a system restart.

```sql
CREATE TABLE orchestration_ledger (
    orchestration_id   CHAR(36)     NOT NULL PRIMARY KEY,
    linear_parent_id   VARCHAR(255) NULL,
    objective_summary  TEXT         NOT NULL,
    state              ENUM('init', 'planning', 'executing', 'success', 'failed')
                       NOT NULL DEFAULT 'init',
    last_agent_active  VARCHAR(50)  NULL,
    updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                          ON UPDATE CURRENT_TIMESTAMP
);
```

`orchestration_id` is stored as `CHAR(36)` because MariaDB does not have a
native `UUID` SQL type; the column holds the canonical 36-character
hyphenated form. See `vines/schema.sql` for the authoritative definition.

### 4.2 Error Handling & Resilience

- **Interruption Recovery.** Upon service initialisation, the orchestrator
  must query the ledger for any orchestrations in an unfinished state
  (`init`, `planning`, or `executing`).
- **Workflow Re-Sync.** For each recovered orchestration, the orchestrator
  cross-references `linear_parent_id` with the Linear API to identify the
  last completed sub-task and resumes the plan from the point of failure.

## 5. Deployment Requirements

- **Operating system:** Linux-based (Ubuntu / Arch optimised).
- **Environment variables:**
  - `LINEAR_API_KEY` — Linear personal API token. Required.
  - `MARIADB_URL` — base URL of the cloud MariaDB instance, in the form
    `mariadb://<host>[:port]/<database>` (credentials are read from
    `MARIADB_USER` / `MARIADB_PASSWORD`; if the URL itself contains
    credentials they take precedence).
  - `MARIADB_USER` — database user with `INSERT, SELECT, UPDATE` on the
    ledger table.
  - `MARIADB_PASSWORD` — password for `MARIADB_USER`.
- **Communication protocol:** Agent Communication Protocol (ACP) **or**
  structured JSON payloads over an internal bus. The reference
  implementation uses `openclaw agent --agent <id> --json …`, which
  returns structured JSON; that is sufficient and ACP-equivalent for the
  contracts described in §3.2.
