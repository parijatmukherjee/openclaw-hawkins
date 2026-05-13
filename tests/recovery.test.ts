import { describe, expect, it, vi } from "vitest";
import type { Ledger } from "../src/persistence.js";
import type { LinearClient } from "../src/linear-client.js";
import {
  DEFAULT_DONE_STATE_NAMES,
  isLinearOrphaned,
  isResumable,
  markFailedIfOrphaned,
  orphaned,
  resumable,
  scanRecovery,
} from "../src/recovery.js";
import type { LinearIssue, OrchestrationRow } from "../src/types.js";

function row(overrides: Partial<OrchestrationRow> = {}): OrchestrationRow {
  return {
    orchestrationId: "oid-1",
    linearParentId: "ENG-1",
    objectiveSummary: "objective",
    state: "executing",
    lastAgentActive: null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function issue(idx: number, stateName = "Todo"): LinearIssue {
  return {
    id: `uuid-${idx}`,
    identifier: `ENG-${idx}`,
    title: `t-${idx}`,
    stateName,
    url: "u",
    parentId: null,
  };
}

function fakeLedger(rows: OrchestrationRow[] = []) {
  return {
    listUnfinished: vi.fn().mockResolvedValue(rows),
    setState: vi.fn().mockResolvedValue(true),
  } as unknown as Ledger;
}

function fakeLinear(overrides: Partial<LinearClient> = {}) {
  return {
    getIssue: vi.fn().mockResolvedValue(null),
    listChildren: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as LinearClient;
}

describe("scanRecovery", () => {
  it("returns an empty report when no unfinished rows", async () => {
    const report = await scanRecovery(fakeLedger([]), fakeLinear());
    expect(report.items).toEqual([]);
    expect(resumable(report)).toEqual([]);
    expect(orphaned(report)).toEqual([]);
  });

  it("surfaces rows without a Linear parent id", async () => {
    const report = await scanRecovery(fakeLedger([row({ linearParentId: null })]), fakeLinear());
    expect(report.items).toHaveLength(1);
    const item = report.items[0];
    expect(item.parentIssue).toBeNull();
    expect(item.children).toEqual([]);
    expect(isLinearOrphaned(item)).toBe(false);
  });

  it("marks orphaned when Linear has no record of the parent", async () => {
    const linear = fakeLinear({ getIssue: vi.fn().mockResolvedValue(null) });
    const report = await scanRecovery(fakeLedger([row()]), linear);
    expect(orphaned(report)).toHaveLength(1);
  });

  it("finds last completed + next pending children", async () => {
    const linear = fakeLinear({
      getIssue: vi.fn().mockResolvedValue(issue(1)),
      listChildren: vi
        .fn()
        .mockResolvedValue([
          issue(2, "Done"),
          issue(3, "Done"),
          issue(4, "Todo"),
          issue(5, "Todo"),
        ]),
    });
    const report = await scanRecovery(fakeLedger([row()]), linear);
    const item = report.items[0];
    expect(item.lastCompletedChild?.identifier).toBe("ENG-3");
    expect(item.nextPendingChild?.identifier).toBe("ENG-4");
    expect(isResumable(item)).toBe(true);
    expect(resumable(report)).toHaveLength(1);
  });

  it("all-done children → not resumable", async () => {
    const linear = fakeLinear({
      getIssue: vi.fn().mockResolvedValue(issue(1)),
      listChildren: vi.fn().mockResolvedValue([issue(2, "Done"), issue(3, "Completed")]),
    });
    const report = await scanRecovery(fakeLedger([row()]), linear);
    expect(isResumable(report.items[0])).toBe(false);
    expect(report.items[0].lastCompletedChild?.identifier).toBe("ENG-3");
  });

  it("Linear getIssue failure is swallowed (item appears orphaned)", async () => {
    const linear = fakeLinear({
      getIssue: vi.fn().mockRejectedValue(new Error("API down")),
    });
    const report = await scanRecovery(fakeLedger([row()]), linear);
    expect(isLinearOrphaned(report.items[0])).toBe(true);
  });

  it("Linear listChildren failure yields empty children list", async () => {
    const linear = fakeLinear({
      getIssue: vi.fn().mockResolvedValue(issue(1)),
      listChildren: vi.fn().mockRejectedValue(new Error("hiccup")),
    });
    const report = await scanRecovery(fakeLedger([row()]), linear);
    expect(report.items[0].children).toEqual([]);
    expect(isResumable(report.items[0])).toBe(false);
  });

  it("listChildren failure handles non-Error rejection", async () => {
    const linear = fakeLinear({
      getIssue: vi.fn().mockResolvedValue(issue(1)),
      listChildren: vi.fn().mockRejectedValue("string-rejection"),
    });
    const report = await scanRecovery(fakeLedger([row()]), linear);
    expect(report.items[0].children).toEqual([]);
  });

  it("custom done-state set is honoured", async () => {
    const linear = fakeLinear({
      getIssue: vi.fn().mockResolvedValue(issue(1)),
      listChildren: vi.fn().mockResolvedValue([issue(2, "Shipped"), issue(3, "Backlog")]),
    });
    const report = await scanRecovery(fakeLedger([row()]), linear, new Set(["Shipped"]));
    expect(report.items[0].lastCompletedChild?.identifier).toBe("ENG-2");
    expect(report.items[0].nextPendingChild?.identifier).toBe("ENG-3");
  });

  it("default DONE set covers expected names", () => {
    for (const name of ["Done", "Completed", "Closed", "Canceled", "Duplicate"]) {
      expect(DEFAULT_DONE_STATE_NAMES.has(name)).toBe(true);
    }
  });
});

describe("markFailedIfOrphaned", () => {
  it("marks orphaned items as failed", async () => {
    const ledger = fakeLedger();
    const item = {
      ledgerRow: row(),
      parentIssue: null,
      children: [],
      lastCompletedChild: null,
      nextPendingChild: null,
    };
    expect(await markFailedIfOrphaned(ledger, item)).toBe(true);
    expect(
      (ledger as unknown as { setState: ReturnType<typeof vi.fn> }).setState,
    ).toHaveBeenCalled();
  });

  it("no-ops for items with a parent issue", async () => {
    const ledger = fakeLedger();
    const item = {
      ledgerRow: row(),
      parentIssue: issue(1),
      children: [],
      lastCompletedChild: null,
      nextPendingChild: null,
    };
    expect(await markFailedIfOrphaned(ledger, item)).toBe(false);
  });

  it("no-ops when there's no Linear parent id at all", async () => {
    const ledger = fakeLedger();
    const item = {
      ledgerRow: row({ linearParentId: null }),
      parentIssue: null,
      children: [],
      lastCompletedChild: null,
      nextPendingChild: null,
    };
    expect(await markFailedIfOrphaned(ledger, item)).toBe(false);
  });
});
