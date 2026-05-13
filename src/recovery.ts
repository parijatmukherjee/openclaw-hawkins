/**
 * Recovery — implements `vines/spec.md` §4.2.
 *
 * On service initialisation, find every orchestration in an unfinished state
 * (init | planning | executing), and for each cross-reference its
 * `linear_parent_id` with Linear to figure out the last completed sub-task
 * and the next pending one. The result is a report; resumption policy is
 * the caller's decision.
 *
 * Importantly, recovery distinguishes three failure modes:
 *
 *   - **truly missing**   — Linear returned `issue: null`. The parent no
 *                           longer exists; safe to mark the orchestration
 *                           failed.
 *   - **lookup failed**   — Linear API errored (network, 5xx, auth).
 *                           Recovery shouldn't destroy state on a
 *                           transient outage; surface for the operator
 *                           to retry.
 *   - **present**         — fragments cross-referenced normally.
 *
 * The discriminator lives on `RecoveryItem.lookupStatus` so callers can
 * distinguish "issue truly missing" from "issue lookup failed".
 */

import type { Ledger } from "./persistence.js";
import type { LinearClient } from "./linear-client.js";
import type { LinearIssue, OrchestrationRow } from "./types.js";

/** Linear workflow-state names considered "done" by default. */
export const DEFAULT_DONE_STATE_NAMES: ReadonlySet<string> = new Set([
  "Done",
  "Completed",
  "Closed",
  "Canceled",
  "Duplicate",
]);

/**
 * How the recovery scan was able to look up the parent issue.
 *  - `ok`            — `parentIssue` is present, children list is reliable.
 *  - `missing`       — Linear definitively returned no issue; orphaned.
 *  - `lookup_failed` — Linear API errored. Treat as transient; don't
 *                      auto-fail the orchestration.
 *  - `no_parent_id`  — Ledger row had no `linear_parent_id` to look up.
 */
export type LookupStatus = "ok" | "missing" | "lookup_failed" | "no_parent_id";

export interface RecoveryItem {
  ledgerRow: OrchestrationRow;
  parentIssue: LinearIssue | null;
  children: LinearIssue[];
  lastCompletedChild: LinearIssue | null;
  nextPendingChild: LinearIssue | null;
  lookupStatus: LookupStatus;
  lookupError?: string;
}

export interface RecoveryReport {
  items: RecoveryItem[];
}

export function isResumable(item: RecoveryItem): boolean {
  return item.nextPendingChild !== null;
}

/**
 * Truly orphaned: ledger row pointed at a Linear issue, and Linear
 * **definitively** said the issue doesn't exist (not "lookup_failed").
 */
export function isLinearOrphaned(item: RecoveryItem): boolean {
  return item.lookupStatus === "missing";
}

/** Lookup failed transiently — caller should retry, not fail. */
export function isLookupFailed(item: RecoveryItem): boolean {
  return item.lookupStatus === "lookup_failed";
}

export async function scanRecovery(
  ledger: Ledger,
  linear: LinearClient,
  doneStateNames: ReadonlySet<string> = DEFAULT_DONE_STATE_NAMES,
): Promise<RecoveryReport> {
  const rows = await ledger.listUnfinished();
  const items: RecoveryItem[] = [];

  for (const row of rows) {
    if (row.linearParentId === null) {
      items.push({
        ledgerRow: row,
        parentIssue: null,
        children: [],
        lastCompletedChild: null,
        nextPendingChild: null,
        lookupStatus: "no_parent_id",
      });
      continue;
    }

    const fetched = await safeGetIssue(linear, row.linearParentId);
    if (fetched.kind === "error") {
      items.push({
        ledgerRow: row,
        parentIssue: null,
        children: [],
        lastCompletedChild: null,
        nextPendingChild: null,
        lookupStatus: "lookup_failed",
        lookupError: fetched.message,
      });
      continue;
    }
    if (fetched.value === null) {
      items.push({
        ledgerRow: row,
        parentIssue: null,
        children: [],
        lastCompletedChild: null,
        nextPendingChild: null,
        lookupStatus: "missing",
      });
      continue;
    }

    const childrenResult = await safeListChildren(linear, row.linearParentId);
    const children = childrenResult.kind === "ok" ? childrenResult.value : [];
    let lastDone: LinearIssue | null = null;
    let nextPending: LinearIssue | null = null;
    for (const child of children) {
      if (doneStateNames.has(child.stateName)) {
        lastDone = child;
      } else if (nextPending === null) {
        nextPending = child;
      }
    }
    items.push({
      ledgerRow: row,
      parentIssue: fetched.value,
      children,
      lastCompletedChild: lastDone,
      nextPendingChild: nextPending,
      lookupStatus: "ok",
      ...(childrenResult.kind === "error" ? { lookupError: childrenResult.message } : {}),
    });
  }

  return { items };
}

export function resumable(report: RecoveryReport): RecoveryItem[] {
  return report.items.filter(isResumable);
}

export function orphaned(report: RecoveryReport): RecoveryItem[] {
  return report.items.filter(isLinearOrphaned);
}

/** Items where the Linear lookup failed transiently — don't auto-fail. */
export function lookupFailed(report: RecoveryReport): RecoveryItem[] {
  return report.items.filter(isLookupFailed);
}

/**
 * Helper: if Linear definitively reports the parent is missing, the
 * orchestration cannot be cross-referenced and is effectively abandoned.
 * Move it to `failed`. **Does not** fail transient-lookup items, by design.
 */
export async function markFailedIfOrphaned(ledger: Ledger, item: RecoveryItem): Promise<boolean> {
  if (!isLinearOrphaned(item)) return false;
  return ledger.setState(item.ledgerRow.orchestrationId, "failed");
}

// ---------------------------------------------------------------------------
// Internals — swallow Linear errors so a flaky API doesn't block startup.
// Errors are surfaced via `kind: "error"` so callers can tell them apart from
// the "truly missing" result.
// ---------------------------------------------------------------------------

type Lookup<T> = { kind: "ok"; value: T } | { kind: "error"; message: string };

async function safeGetIssue(linear: LinearClient, id: string): Promise<Lookup<LinearIssue | null>> {
  try {
    return { kind: "ok", value: await linear.getIssue(id) };
  } catch (err: unknown) {
    const message = asMessage(err);
    process.stderr.write(`[vines/recovery] Linear getIssue(${id}) failed: ${message}\n`);
    return { kind: "error", message };
  }
}

async function safeListChildren(linear: LinearClient, id: string): Promise<Lookup<LinearIssue[]>> {
  try {
    return { kind: "ok", value: await linear.listChildren(id) };
  } catch (err: unknown) {
    const message = asMessage(err);
    process.stderr.write(`[vines/recovery] Linear listChildren(${id}) failed: ${message}\n`);
    return { kind: "error", message };
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
