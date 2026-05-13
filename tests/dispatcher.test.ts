import { describe, expect, it, vi } from "vitest";
import { dispatchSpecialist, parseEnvelope } from "../src/dispatcher.js";
import type { SpecialistId } from "../src/types.js";

function ok(stdout: string, code = 0) {
  return vi.fn().mockResolvedValue({ stdout, stderr: "", code });
}

describe("parseEnvelope", () => {
  it("ok payload extracts text + durationMs", () => {
    const r = parseEnvelope("system-agent", {
      status: "ok",
      result: { payloads: [{ text: "hello" }], meta: { durationMs: 42 } },
    });
    expect(r.status).toBe("ok");
    expect(r.text).toBe("hello");
    expect(r.durationMs).toBe(42);
  });

  it("missing payloads yields empty text", () => {
    const r = parseEnvelope("code-agent", { status: "ok", result: {} });
    expect(r.text).toBe("");
  });

  it("non-numeric duration is dropped", () => {
    const r = parseEnvelope("system-agent", {
      status: "ok",
      result: { meta: { durationMs: "nope" } },
    });
    expect(r.durationMs).toBeNull();
  });

  it("invalid status falls back to failed", () => {
    const r = parseEnvelope("data-agent", { status: 42 });
    expect(r.status).toBe("failed");
  });
});

describe("dispatchSpecialist validation", () => {
  it("rejects unknown agent", async () => {
    await expect(
      dispatchSpecialist("nope" as SpecialistId, "hi", { timeoutSeconds: 1 }),
    ).rejects.toThrow(/unknown specialist/);
  });

  it("rejects empty message", async () => {
    await expect(dispatchSpecialist("system-agent", "   ", { timeoutSeconds: 1 })).rejects.toThrow(
      /non-empty/,
    );
  });
});

describe("dispatchSpecialist runner outcomes", () => {
  const envelope = (text: string) => ({
    status: "ok",
    result: { payloads: [{ text }], meta: { durationMs: 100 } },
  });

  it("returns ok on a clean run", async () => {
    const runner = ok(JSON.stringify(envelope("done")));
    const r = await dispatchSpecialist("system-agent", "task", { timeoutSeconds: 10, runner });
    expect(r.status).toBe("ok");
    expect(r.text).toBe("done");
  });

  it("non-zero exit → failed", async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: "", stderr: "oops", code: 2 });
    const r = await dispatchSpecialist("data-agent", "task", { timeoutSeconds: 10, runner });
    expect(r.status).toBe("failed");
    expect(r.text).toBe("oops");
  });

  it("invalid JSON → failed", async () => {
    const runner = ok("not json");
    const r = await dispatchSpecialist("comm-agent", "task", { timeoutSeconds: 10, runner });
    expect(r.status).toBe("failed");
    expect(r.text).toContain("not json");
  });

  it("timeout (killed=true) maps to timeout status", async () => {
    const runner = vi.fn().mockRejectedValue(Object.assign(new Error("killed"), { killed: true }));
    const r = await dispatchSpecialist("code-agent", "task", { timeoutSeconds: 5, runner });
    expect(r.status).toBe("timeout");
  });

  it("ENOENT maps to unreachable", async () => {
    const runner = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    const r = await dispatchSpecialist("system-agent", "task", { timeoutSeconds: 5, runner });
    expect(r.status).toBe("unreachable");
    expect(r.text).toContain("openclaw");
  });

  it("generic runner error maps to failed", async () => {
    const runner = vi.fn().mockRejectedValue(new Error("weird"));
    const r = await dispatchSpecialist("system-agent", "task", { timeoutSeconds: 5, runner });
    expect(r.status).toBe("failed");
    expect(r.text).toContain("weird");
  });

  it("uses openclawBin override", async () => {
    const runner = ok(JSON.stringify(envelope("ok")));
    await dispatchSpecialist("research-agent", "find x", {
      timeoutSeconds: 60,
      openclawBin: "/custom/openclaw",
      runner,
    });
    expect(runner.mock.calls[0][0]).toBe("/custom/openclaw");
    const args = runner.mock.calls[0][1] as string[];
    expect(args).toEqual([
      "agent",
      "--agent",
      "research-agent",
      "--message",
      "find x",
      "--json",
      "--timeout",
      "60",
    ]);
  });
});
