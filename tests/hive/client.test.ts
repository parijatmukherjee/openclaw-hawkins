import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HiveTendril } from "../../src/hive/client.js";

beforeEach(() => {
  delete process.env.VECNA_URL;
  delete process.env.VECNA_AUTH_TOKEN;
});

afterEach(() => vi.restoreAllMocks());

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

const fragment = {
  fragmentId: "abc",
  topic: "t",
  subTopic: null,
  content: "c",
  sourceAgent: "system-agent",
  importance: 3,
  linearTicketRef: null,
  isDeprecated: false,
  createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
};

describe("HiveTendril", () => {
  it("healthz round-trips", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true, db: "up", version: "0.1.0" }));
    const t = new HiveTendril({ url: "http://h.local:8765", fetchImpl });
    const res = await t.healthz();
    expect(res.ok).toBe(true);
    expect(fetchImpl.mock.calls[0][0]).toBe("http://h.local:8765/v1/healthz");
  });

  it("connect sends the body", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ fragment, deduplicated: false }, 201));
    const t = new HiveTendril({ url: "http://h:8765", fetchImpl });
    await t.connect({ topic: "t", content: "c", sourceAgent: "system-agent" });
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({ topic: "t" });
  });

  it("recall returns the JSON envelope", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ topic: "t", count: 1, fragments: [fragment] }));
    const t = new HiveTendril({ url: "http://h:8765", fetchImpl });
    const res = await t.recall("deployment", { ticket: "ENG-1", limit: 5 });
    expect(res.count).toBe(1);
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain("/v1/recall/deployment");
    expect(url).toContain("ticket=ENG-1");
    expect(url).toContain("limit=5");
  });

  it("recallAsContext returns plain text", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse("# Hive recall — topic: t\n"));
    const t = new HiveTendril({ url: "http://h:8765", fetchImpl });
    const text = await t.recallAsContext("t");
    expect(text).toContain("Hive recall");
  });

  it("search uses the correct query string", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ query: "nginx", count: 0, fragments: [] }));
    const t = new HiveTendril({ url: "http://h:8765", fetchImpl });
    await t.search("nginx", 10);
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain("query=nginx");
    expect(url).toContain("limit=10");
  });

  it("getFragment returns null on 404", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "not_found", code: "not_found" }, 404));
    const t = new HiveTendril({ url: "http://h:8765", fetchImpl });
    expect(await t.getFragment("abc")).toBeNull();
  });

  it("evolve sends PATCH with the body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        deprecated: { ...fragment, isDeprecated: true },
        replacement: { ...fragment, fragmentId: "new" },
      }),
    );
    const t = new HiveTendril({ url: "http://h:8765", fetchImpl });
    const res = await t.evolve("abc", { content: "x", reason: "wrong" });
    expect(res.replacement.fragmentId).toBe("new");
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("PATCH");
  });

  it("attaches Bearer auth when token is set", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true, db: "up", version: "0.1.0" }));
    const t = new HiveTendril({ url: "http://h:8765", authToken: "tok", fetchImpl });
    await t.healthz();
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("wraps transport errors as hive_unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("dns"));
    const t = new HiveTendril({ url: "http://h:8765", fetchImpl });
    await expect(t.healthz()).rejects.toThrow(/hive_unreachable/);
  });

  it("surfaces non-2xx as HTTP error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "bad" }, 400));
    const t = new HiveTendril({ url: "http://h:8765", fetchImpl });
    await expect(t.connect({ topic: "t", content: "c", sourceAgent: "a" })).rejects.toThrow(
      /hive HTTP 400/,
    );
  });

  it("rejects non-JSON success bodies", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse("not json"));
    const t = new HiveTendril({ url: "http://h:8765", fetchImpl });
    await expect(t.healthz()).rejects.toThrow(/non-JSON/);
  });

  it("getFragment re-throws non-404 errors", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "internal", code: "internal" }, 500));
    const t = new HiveTendril({ url: "http://h:8765", fetchImpl });
    await expect(t.getFragment("abc")).rejects.toThrow(/hive HTTP 500/);
  });

  it("throws on empty success body (every Hive endpoint promises JSON)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    const t = new HiveTendril({ url: "http://h:8765", fetchImpl });
    await expect(t.healthz()).rejects.toThrow(/empty body/);
  });
});
