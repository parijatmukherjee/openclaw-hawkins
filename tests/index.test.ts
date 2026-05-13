import { describe, expect, it } from "vitest";
import * as pkg from "../src/index.js";

describe("public API surface", () => {
  it("re-exports the core symbols", () => {
    expect(pkg.Orchestrator).toBeDefined();
    expect(pkg.Ledger).toBeDefined();
    expect(pkg.LinearClient).toBeDefined();
    expect(pkg.dispatchSpecialist).toBeDefined();
    expect(pkg.scanRecovery).toBeDefined();
    expect(pkg.triage).toBeDefined();
    expect(pkg.VALID_SPECIALISTS).toBeInstanceOf(Set);
    expect(pkg.UNFINISHED_STATES).toEqual(["init", "planning", "executing"]);
  });
});
