-- =============================================================================
-- VECNA — Hive knowledge-fragment schema
-- See vecna/spec.md §3 for the contract this table implements.
--
-- This file does NOT issue CREATE DATABASE or CREATE USER. The DBA provisions
-- the database and a user with INSERT/SELECT/UPDATE on this table, then runs
-- this file against the chosen database. The bootstrap helper at
-- scripts/bootstrap-vecna-db.sh wraps the same idea.
-- =============================================================================

CREATE TABLE IF NOT EXISTS vecna_hive (
    fragment_id        CHAR(36)     NOT NULL PRIMARY KEY
                                    COMMENT 'UUID v4 — global fragment identifier',
    topic              VARCHAR(128) NOT NULL
                                    COMMENT 'Primary context (e.g. nginx-config)',
    sub_topic          VARCHAR(128) NULL
                                    COMMENT 'Specifics (e.g. ssl-certs)',
    content            TEXT         NOT NULL
                                    COMMENT 'The knowledge fragment itself',
    source_agent       VARCHAR(64)  NOT NULL
                                    COMMENT 'Functional agent id (e.g. code-agent)',
    importance         TINYINT      NOT NULL DEFAULT 3
                                    COMMENT '1 (transient) to 5 (vital)',
    linear_ticket_ref  VARCHAR(64)  NULL
                                    COMMENT 'Links to the VINES Linear parent ticket',
    is_deprecated      BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_topic (topic),
    INDEX idx_source_agent (source_agent),
    INDEX idx_created_at (created_at),
    INDEX idx_is_deprecated (is_deprecated),
    FULLTEXT idx_content (content)
)
ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci;
