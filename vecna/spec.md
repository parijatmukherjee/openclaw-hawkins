# Specification: VECNA (Versatile Entity for Contextual Network Awareness)

This document is the canonical specification for the VECNA subsystem of
`openclaw-hawkins`. The Node/TypeScript implementation under `src/hive/`
and the operator docs (INSTALL.md, orchestrator/AGENTS.md) all reference
this file. If behaviour drifts from the spec, the spec wins — update the
spec first, then the implementation.

## 1. System Vision

VECNA is a specialised sidecar service providing **Inter-Agent Knowledge
Sharing**. It ensures that the collective experience of the swarm is
preserved, searchable, and reusable. It solves the "context window"
problem by providing a "topic-based recall" mechanism, allowing agents
to stay lightweight while remaining highly informed.

VECNA is complementary to VINES, not a replacement. VINES tracks
**state** (per-orchestration lifecycle, recovery anchors). VECNA tracks
**memory** (cross-orchestration learning, durable lessons). Both
subsystems live in the same MariaDB instance but own separate tables
and have separate spec contracts.

## 2. Architectural Components

- **The Nexus (Node.js API).** A RESTful Express service that
  standardises how agents talk to the Hive. Source: `src/hive/server.ts`.
- **The Hive (cloud MariaDB).** Durable storage where fragments are
  indexed and linked. Schema: `vecna/schema.sql`.
- **The Tendrils (agent clients).** Lightweight wrappers that agents use
  to `connect()` (write) and `recall()` (read). Node client:
  `src/hive/client.ts`. Shell-callable CLI: `src/hive/cli.ts` → the
  `vecna` binary.

## 3. Data Model (MariaDB Schema)

The schema is designed for speed and relational context.

```sql
CREATE TABLE vecna_hive (
    fragment_id        CHAR(36)     PRIMARY KEY,     -- UUID for global tracking
    topic              VARCHAR(128) NOT NULL,        -- Primary context (e.g. 'nginx-config')
    sub_topic          VARCHAR(128) NULL,            -- Specifics (e.g. 'ssl-certs')
    content            TEXT         NOT NULL,        -- The actual knowledge fragment
    source_agent       VARCHAR(64)  NOT NULL,        -- e.g. 'code-agent'
    importance         TINYINT      NOT NULL DEFAULT 3, -- 1 (Trash) to 5 (Vital)
    linear_ticket_ref  VARCHAR(64)  NULL,            -- Links to the VINES Linear ticket
    is_deprecated      BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_topic (topic),
    INDEX idx_source_agent (source_agent),
    INDEX idx_created_at (created_at),
    INDEX idx_is_deprecated (is_deprecated),
    FULLTEXT idx_content (content)
);
```

The four `idx_*` btree indexes (`source_agent`, `created_at`,
`is_deprecated` in addition to the spec's `topic`) are required by the
recall-ranking query. The `FULLTEXT idx_content` index supports global
keyword search.

## 4. Operational Workflow

### 4.1 Memory Ingestion — `vecna.connect()`

When an agent completes a task or hits a unique error, it "connects"
that knowledge to the Hive.

1. **Agent action.** Agent sends a JSON payload to the VECNA Nexus.
2. **Deduplication.** The Nexus checks for an existing fragment with
   identical `(topic, source_agent, content)` created within the last
   `VECNA_DEDUP_WINDOW_MIN` minutes (default 5), but only when
   `importance ≥ 4`. If a duplicate is found, the existing fragment is
   returned with a flag — no new row is inserted.
3. **Persistence.** Otherwise, VECNA assigns a UUID and commits the
   fragment.

### 4.2 Selective Recall — `vecna.recall()`

When the Nexus starts a task, it calls VECNA to "remember" previous
attempts.

- **Request.** `GET /v1/recall/:topic?ticket=ABC-123&limit=20&format=json|context`
- **Filter logic.** VECNA pulls non-deprecated fragments where
  `topic = :topic`. The ORDER BY ranks them by:
  1. Fragments tagged with the current `linear_ticket_ref` first.
  2. `importance` descending (with `importance = 5` always trumping
     age).
  3. Newer fragments before older ones.
  4. **Decay penalty:** fragments older than 6 months without
     `importance = 5` are demoted below current ones.
- **Injection.** When `format=context`, the Nexus receives a
  pre-summarised string ready to inject into the next prompt. When
  `format=json`, it receives the array of fragment rows.

### 4.3 Global Search — `vecna.search()`

`GET /v1/search?query=keyword&limit=20` — full-text search across all
non-deprecated fragments via `MATCH(content) AGAINST (?)`. Useful for
the search-tendril when no clear topic is known.

### 4.4 Knowledge Evolution — `vecna.evolve()`

If an agent finds that a past memory was wrong (e.g. an outdated API
version), it issues `PATCH /v1/evolve/:id` with the corrected content.
VECNA performs an atomic two-step:

1. `UPDATE vecna_hive SET is_deprecated = TRUE WHERE fragment_id = :id`.
2. `INSERT` a new fragment on the same topic, with the corrected
   content, carrying the same `linear_ticket_ref` if any.

The two rows are not linked by a foreign key; lineage is informal via
shared topic + chronological ordering. (A `replaces_fragment_id` column
is a future iteration.)

## 5. API Specification (Node.js / Express)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/healthz` | Liveness probe. Returns `{ ok, db: "up"|"down", version }`. |
| `POST` | `/v1/connect` | Submit a new fragment. Body schema in §5.1. Returns the persisted fragment + `deduplicated: bool`. |
| `GET` | `/v1/recall/:topic` | Topic-scoped recall. Query params: `ticket`, `limit`, `format=json\|context`. |
| `GET` | `/v1/search` | Full-text search. Query params: `query`, `limit`. |
| `GET` | `/v1/fragments/:id` | Fetch one fragment by UUID. |
| `PATCH` | `/v1/evolve/:id` | Deprecate the old fragment + insert the corrected replacement. Body: `{ content, importance?, reason? }`. Returns `{ deprecated, replacement }`. |

All responses are JSON. Errors return `{ error: string, code: string }`
plus the appropriate HTTP status.

### 5.1 `POST /v1/connect` body

```json
{
  "topic": "mariadb-optimization",
  "sub_topic": "innodb",
  "content": "Setting innodb_buffer_pool_size to 2G resolved the latency on Ubuntu 22.04.",
  "source_agent": "system-agent",
  "importance": 5,
  "linear_ref": "ENG-42"
}
```

- `topic`, `content`, `source_agent` are required.
- `sub_topic`, `importance`, `linear_ref` are optional. `importance`
  defaults to 3, must be 1–5.

## 6. Knowledge Evolution and Decay

VECNA is not a static log; it is an evolving mind.

- **Self-correction.** Any agent (typically the code-tendril when it
  discovers an outdated API note) calls `PATCH /v1/evolve/:id` to
  supersede a previous fragment.
- **Decay logic.** VECNA automatically deprioritises memories older
  than 6 months unless they carry `importance = 5`. Decay is enforced
  at query time in the recall ORDER BY, not via a background job.

## 7. Deployment Requirements

- **Operating system.** Linux (Ubuntu / Arch recommended).
- **Runtime.** Node ≥ 20.
- **Database.** MariaDB instance reachable from the host. Uses the same
  env-var contract as VINES — see `vines/spec.md §5`.
- **Environment variables.**
  - `MARIADB_URL` — `mariadb://<host>[:port]/<database>` (a username may be
    included, but never a password — it would be stored in plaintext; rejected).
  - `MARIADB_USER`, `MARIADB_PASSWORD` — DB credentials; the password comes
    from the environment only.
  - `MARIADB_SSL` — `disabled | preferred | required` (default `preferred`).
    All TLS modes verify the server certificate.
  - `VECNA_PORT` — TCP port for the Nexus (default `8765`).
  - `VECNA_HOST` — bind address (default `127.0.0.1`).
  - `VECNA_AUTH_TOKEN` — optional. When set, the Nexus requires
    `Authorization: Bearer <token>` on every request.
  - `VECNA_DEDUP_WINDOW_MIN` — dedup window in minutes (default `5`).
  - `VECNA_URL` — used by clients/CLI to find the Nexus
    (default `http://127.0.0.1:8765`).

## 8. Generic Use-Case Example

> **Operator:** "Why is the server slow?"
>
> **Nexus:** *(calls VECNA)* `GET /v1/recall/server-performance`
>
> **VECNA:** returns a fragment from `system-agent` (2 h ago):
> *"Detected high I/O wait on MariaDB."*
>
> **Nexus → operator:** "The Hive remembers — the system-agent noted
> high I/O wait on MariaDB earlier. Dispatching the data-agent to check
> long-running queries."

This is the VECNA protocol. It turns a group of isolated scripts into a
single, learning organism.
