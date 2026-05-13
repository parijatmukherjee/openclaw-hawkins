import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  delete process.env.VECNA_URL;
  delete process.env.VECNA_AUTH_TOKEN;
  vi.resetModules();
});

afterEach(() => vi.restoreAllMocks());

const importMain = async () => (await import("../../src/hive/cli.js")).main;

function captureOutput() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const o = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
    stdout.push(String(c));
    return true;
  });
  const e = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
    stderr.push(String(c));
    return true;
  });
  return {
    stdout: () => stdout.join(""),
    stderr: () => stderr.join(""),
    restore: () => {
      o.mockRestore();
      e.mockRestore();
    },
  };
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
  createdAt: "2026-01-01T00:00:00.000Z",
};

function stubFetch(map: Record<string, (init: RequestInit | undefined) => Response>) {
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [prefix, fn] of Object.entries(map)) {
      if (url.startsWith(prefix)) return Promise.resolve(fn(init));
    }
    return Promise.resolve(new Response("not stubbed: " + url, { status: 599 }));
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("vecna connect", () => {
  it("posts a fragment and prints the result", async () => {
    stubFetch({
      "http://127.0.0.1:8765/v1/connect": () =>
        new Response(JSON.stringify({ fragment, deduplicated: false }), { status: 201 }),
    });
    const main = await importMain();
    const out = captureOutput();
    const rc = await main([
      "node",
      "vecna",
      "connect",
      "--topic",
      "t",
      "--content",
      "c",
      "--source-agent",
      "system-agent",
      "--importance",
      "4",
      "--linear-ref",
      "ENG-1",
    ]);
    out.restore();
    expect(rc).toBe(0);
    expect(out.stdout()).toContain('"fragment"');
  });

  it("rejects bad --importance", async () => {
    const main = await importMain();
    const out = captureOutput();
    const rc = await main([
      "node",
      "vecna",
      "connect",
      "--topic",
      "t",
      "--content",
      "c",
      "--source-agent",
      "a",
      "--importance",
      "9",
    ]);
    out.restore();
    expect(rc).not.toBe(0);
  });
});

describe("vecna recall", () => {
  it("prints JSON by default", async () => {
    stubFetch({
      "http://127.0.0.1:8765/v1/recall/": () =>
        new Response(JSON.stringify({ topic: "t", count: 1, fragments: [fragment] })),
    });
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vecna", "recall", "deployment", "--limit", "5"]);
    out.restore();
    expect(rc).toBe(0);
    expect(JSON.parse(out.stdout()).count).toBe(1);
  });

  it("prints plain text when --format context", async () => {
    stubFetch({
      "http://127.0.0.1:8765/v1/recall/": () => new Response("# Hive recall — topic: deployment\n"),
    });
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vecna", "recall", "deployment", "--format", "context"]);
    out.restore();
    expect(rc).toBe(0);
    expect(out.stdout()).toContain("Hive recall");
  });

  it("rejects bad --format", async () => {
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vecna", "recall", "x", "--format", "xml"]);
    out.restore();
    expect(rc).not.toBe(0);
  });
});

describe("vecna search", () => {
  it("calls /v1/search with the query", async () => {
    stubFetch({
      "http://127.0.0.1:8765/v1/search": () =>
        new Response(JSON.stringify({ query: "nginx", count: 0, fragments: [] })),
    });
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vecna", "search", "--query", "nginx", "--limit", "10"]);
    out.restore();
    expect(rc).toBe(0);
  });
});

describe("vecna evolve", () => {
  it("PATCHes the fragment", async () => {
    stubFetch({
      "http://127.0.0.1:8765/v1/evolve/": () =>
        new Response(
          JSON.stringify({
            deprecated: { ...fragment, isDeprecated: true },
            replacement: { ...fragment, fragmentId: "new" },
          }),
        ),
    });
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vecna", "evolve", "abc", "--content", "corrected"]);
    out.restore();
    expect(rc).toBe(0);
    expect(out.stdout()).toContain('"replacement"');
  });
});

describe("vecna fragment", () => {
  it("returns 0 + body on success", async () => {
    stubFetch({
      "http://127.0.0.1:8765/v1/fragments/": () => new Response(JSON.stringify(fragment)),
    });
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vecna", "fragment", "abc"]);
    out.restore();
    expect(rc).toBe(0);
  });

  it("returns 2 when missing", async () => {
    stubFetch({
      "http://127.0.0.1:8765/v1/fragments/": () =>
        new Response(JSON.stringify({ error: "not_found", code: "not_found" }), { status: 404 }),
    });
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vecna", "fragment", "missing"]);
    out.restore();
    expect(rc).toBe(2);
  });
});

describe("vecna healthz", () => {
  it("returns 0 when ok", async () => {
    stubFetch({
      "http://127.0.0.1:8765/v1/healthz": () =>
        new Response(JSON.stringify({ ok: true, db: "up", version: "0.1.0" })),
    });
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vecna", "healthz"]);
    out.restore();
    expect(rc).toBe(0);
  });

  it("surfaces hive_unreachable as exit 3", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("ECONNREFUSED")));
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vecna", "healthz"]);
    out.restore();
    expect(rc).toBe(3);
    expect(out.stderr()).toContain("hive:");
  });
});

describe("vecna --help / unknown", () => {
  it("--help exits 0", async () => {
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vecna", "--help"]);
    out.restore();
    expect(rc).toBe(0);
  });

  it("unknown subcommand exits non-zero", async () => {
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vecna", "ghost"]);
    out.restore();
    expect(rc).not.toBe(0);
  });
});
