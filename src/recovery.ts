/**
 * Recovery — implements `aso/spec.md` §4.2.
 *
 * On service initialisation, find every orchestration in an unfinished state
 * (init | planning | executing), and for each cross-reference its
 * `linear_parent_id` with Linear to figure out the last completed sub-task
 * and the next pending one. The result is a report; resumption policy is
 * the caller's decision.
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

export interface RecoveryItem {
  ledgerRow: OrchestrationRow;
  parentIssue: LinearIssue | null;
  children: LinearIssue[];
  lastCompletedChild: LinearIssue | null;
  nextPendingChild: LinearIssue | null;
}

export interface RecoveryReport {
  items: RecoveryItem[];
}

export function isResumable(item: RecoveryItem): boolean {
  return item.nextPendingChild !== null;
}

export function isLinearOrphaned(item: RecoveryItem): boolean {
  return item.ledgerRow.linearParentId !== null && item.parentIssue === null;
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
      });
      continue;
    }

    const parent = await safeGetIssue(linear, row.linearParentId);
    if (parent === null) {
      items.push({
        ledgerRow: row,
        parentIssue: null,
        children: [],
        lastCompletedChild: null,
        nextPendingChild: null,
      });
      continue;
    }

    const children = await safeListChildren(linear, row.linearParentId);
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
      parentIssue: parent,
      children,
      lastCompletedChild: lastDone,
      nextPendingChild: nextPending,
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

/**
 * Helper: if Linear has lost the parent, the orchestration cannot be
 * cross-referenced and is effectively abandoned. Move it to `failed`.
 */
export async function markFailedIfOrphaned(ledger: Ledger, item: RecoveryItem): Promise<boolean> {
  if (!isLinearOrphaned(item)) return false;
  return ledger.setState(item.ledgerRow.orchestrationId, "failed");
}

// ---------------------------------------------------------------------------
// Internals — swallow Linear errors during recovery so a flaky API doesn't
// block startup. Errors are not silent: callers see them as `parentIssue:
// null` (orphaned) or `children: []`, and structured logging records the
// actual error message.
// ---------------------------------------------------------------------------

async function safeGetIssue(linear: LinearClient, id: string): Promise<LinearIssue | null> {
  try {
    return await linear.getIssue(id);
  } catch (err: unknown) {
    process.stderr.write(`[aso/recovery] Linear getIssue(${id}) failed: ${asMessage(err)}\n`);
    return null;
  }
}

async function safeListChildren(linear: LinearClient, id: string): Promise<LinearIssue[]> {
  try {
    return await linear.listChildren(id);
  } catch (err: unknown) {
    process.stderr.write(`[aso/recovery] Linear listChildren(${id}) failed: ${asMessage(err)}\n`);
    return [];
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
