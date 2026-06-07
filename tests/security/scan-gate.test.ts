import { describe, expect, it } from "vitest";
// The gate logic is plain ESM; import the pure functions directly.
import { normalizeFindings, evaluate } from "../../scripts/clawhub-scan-gate.mjs";

const SAMPLE = {
  skillspector: {
    issues: [
      { issueId: "SDI-1", file: "agents/code-agent/AGENTS.md", severity: "HIGH" },
      // duplicate issueId+file collapses to one key
      { issueId: "SDI-1", file: "agents/code-agent/AGENTS.md", severity: "HIGH" },
      { issueId: "SQP-2", file: "src/plugin/setup.ts", severity: "MEDIUM" },
    ],
  },
  staticAnalysis: {
    reasonCodes: ["suspicious.exposed_secret_literal"],
    findings: [{ file: "src/config.ts", line: 63 }],
  },
  clawscan: {
    findings: "[SDI-1] expected: fine\n[SQP-2] unexpected: a real concern",
  },
};

describe("normalizeFindings", () => {
  it("produces stable, de-duplicated finding keys", () => {
    const { keys } = normalizeFindings(SAMPLE);
    expect(keys).toEqual([
      "skillspector/SDI-1/agents/code-agent/AGENTS.md",
      "skillspector/SQP-2/src/plugin/setup.ts",
      "static/exposed_secret_literal/src/config.ts",
    ]);
  });

  it("counts clawscan 'unexpected' findings (string form)", () => {
    expect(normalizeFindings(SAMPLE).clawscanUnexpected).toBe(1);
  });

  it("counts clawscan 'unexpected' findings (array form)", () => {
    const r = normalizeFindings({
      clawscan: {
        findings: [
          { status: "expected", text: "x" },
          { status: "unexpected", text: "y" },
        ],
      },
    });
    expect(r.clawscanUnexpected).toBe(1);
  });

  it("tolerates missing report sections", () => {
    expect(normalizeFindings({})).toEqual({ keys: [], clawscanUnexpected: 0 });
  });
});

describe("evaluate", () => {
  const baseline = {
    clawscanUnexpectedMax: 1,
    acceptedFindings: [
      "skillspector/SDI-1/agents/code-agent/AGENTS.md",
      "skillspector/SQP-2/src/plugin/setup.ts",
      "static/exposed_secret_literal/src/config.ts",
    ],
  };

  it("passes when every finding is accepted and clawscan is within budget", () => {
    const r = evaluate(SAMPLE, baseline);
    expect(r.regressed).toBe(false);
    expect(r.newFindings).toEqual([]);
  });

  it("fails when a new finding appears", () => {
    const withNew = {
      ...SAMPLE,
      skillspector: {
        issues: [...SAMPLE.skillspector.issues, { issueId: "SDI-2", file: "src/new-thing.ts" }],
      },
    };
    const r = evaluate(withNew, baseline);
    expect(r.regressed).toBe(true);
    expect(r.newFindings).toEqual(["skillspector/SDI-2/src/new-thing.ts"]);
  });

  it("fails when clawscan 'unexpected' count exceeds the baseline max", () => {
    const stricter = { ...baseline, clawscanUnexpectedMax: 0 };
    const r = evaluate(SAMPLE, stricter);
    expect(r.regressed).toBe(true);
    expect(r.clawscanUnexpected).toBe(1);
    expect(r.clawscanMax).toBe(0);
  });
});
