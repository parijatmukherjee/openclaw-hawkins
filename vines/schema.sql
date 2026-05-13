-- =============================================================================
-- VINES (Versatile Integration for Networked Execution & State) (VINES) — ledger schema
-- See vines/spec.md §4.1 for the contract this table implements.
--
-- This file does NOT issue CREATE DATABASE or CREATE USER. The DBA provisions
-- the database and a user with INSERT/SELECT/UPDATE on this table, then runs
-- this file against the chosen database. The bootstrap helper at
-- scripts/bootstrap-vines-db.sh wraps the same idea.
-- =============================================================================

CREATE TABLE IF NOT EXISTS orchestration_ledger (
    orchestration_id   CHAR(36)     NOT NULL PRIMARY KEY
                                    COMMENT 'UUID v4, canonical 36-char hyphenated form',
    linear_parent_id   VARCHAR(255) NULL
                                    COMMENT 'Linear issue identifier (e.g. ENG-42) or UUID',
    objective_summary  TEXT         NOT NULL
                                    COMMENT 'Operator-facing description of the goal',
    state              ENUM('init', 'planning', 'executing', 'success', 'failed')
                       NOT NULL DEFAULT 'init'
                                    COMMENT 'Lifecycle state — see vines/spec.md §3.2',
    last_agent_active  VARCHAR(50)  NULL
                                    COMMENT 'Specialist id last dispatched (telemetry)',
    updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                            ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_state (state),
    INDEX idx_linear_parent_id (linear_parent_id),
    INDEX idx_updated_at (updated_at)
)
ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci;
