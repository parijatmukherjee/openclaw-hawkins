import { describe, expect, it, vi } from "vitest";
import request from "supertest";

import { createServer } from "../../src/hive/server.js";
import type { HiveStore } from "../../src/hive/store.js";
import type { Fragment } from "../../src/hive/types.js";

function fakeStore(): HiveStore & {
  ping: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  recall: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  getFragment: ReturnType<typeof vi.fn>;
  evolve: ReturnType<typeof vi.fn>;
} {
  return {
    ping: vi.fn().mockResolvedValue(true),
    connect: vi.fn(),
    recall: vi.fn(),
    search: vi.fn(),
    getFragment: vi.fn(),
    evolve: vi.fn(),
  } as unknown as HiveStore & {
    ping: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    recall: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
    getFragment: ReturnType<typeof vi.fn>;
    evolve: ReturnType<typeof vi.fn>;
  };
}

const fragment = (overrides: Partial<Fragment> = {}): Fragment => ({
  fragmentId: "11111111-2222-3333-4444-555555555555",
  topic: "deployment",
  subTopic: null,
  content: "use nginx 1.27 for now",
  sourceAgent: "system-agent",
  importance: 3,
  linearTicketRef: null,
  isDeprecated: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

describe("GET /v1/healthz", () => {
  it("reports db: up", async () => {
    const store = fakeStore();
    const app = createServer({ store });
    const res = await request(app).get("/v1/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, db: "up" });
  });

  it("reports db: down when ping fails", async () => {
    const store = fakeStore();
    store.ping.mockResolvedValue(false);
    const app = createServer({ store });
    const res = await request(app).get("/v1/healthz");
    expect(res.body.db).toBe("down");
  });
});

describe("POST /v1/connect", () => {
  it("inserts a fresh fragment (201)", async () => {
    const store = fakeStore();
    store.connect.mockResolvedValue({ fragment: fragment(), deduplicated: false });
    const app = createServer({ store });
    const res = await request(app)
      .post("/v1/connect")
      .send({ topic: "t", content: "c", source_agent: "system-agent" });
    expect(res.status).toBe(201);
    expect(res.body.deduplicated).toBe(false);
  });

  it("returns 200 on dedup hit", async () => {
    const store = fakeStore();
    store.connect.mockResolvedValue({ fragment: fragment(), deduplicated: true });
    const app = createServer({ store });
    const res = await request(app)
      .post("/v1/connect")
      .send({ topic: "t", content: "c", source_agent: "a", importance: 5 });
    expect(res.status).toBe(200);
    expect(res.body.deduplicated).toBe(true);
  });

  it("rejects missing topic with 400", async () => {
    const store = fakeStore();
    const app = createServer({ store });
    const res = await request(app).post("/v1/connect").send({ content: "c", source_agent: "a" });
    expect(res.status).toBe(400);
  });

  it("rejects bad importance with 400", async () => {
    const store = fakeStore();
    const app = createServer({ store });
    const res = await request(app)
      .post("/v1/connect")
      .send({ topic: "t", content: "c", source_agent: "a", importance: 9 });
    expect(res.status).toBe(400);
  });

  it("accepts camelCase aliases (sourceAgent, linearRef, subTopic)", async () => {
    const store = fakeStore();
    store.connect.mockResolvedValue({ fragment: fragment(), deduplicated: false });
    const app = createServer({ store });
    const res = await request(app).post("/v1/connect").send({
      topic: "t",
      content: "c",
      sourceAgent: "a",
      subTopic: "sub",
      linearRef: "ENG-1",
      importance: 4,
    });
    expect(res.status).toBe(201);
    const args = store.connect.mock.calls[0][0] as Record<string, unknown>;
    expect(args.sourceAgent).toBe("a");
    expect(args.subTopic).toBe("sub");
    expect(args.linearRef).toBe("ENG-1");
  });
});

describe("GET /v1/recall/:topic", () => {
  it("returns JSON envelope by default", async () => {
    const store = fakeStore();
    store.recall.mockResolvedValue([fragment()]);
    const app = createServer({ store });
    const res = await request(app).get("/v1/recall/deployment?ticket=ENG-1&limit=5");
    expect(res.status).toBe(200);
    expect(res.body.topic).toBe("deployment");
    expect(res.body.count).toBe(1);
    expect(store.recall).toHaveBeenCalledWith("deployment", { ticket: "ENG-1", limit: 5 });
  });

  it("returns plain-text context when format=context", async () => {
    const store = fakeStore();
    store.recall.mockResolvedValue([fragment()]);
    const app = createServer({ store });
    const res = await request(app).get("/v1/recall/deployment?format=context");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.text).toContain("Hive recall — topic: deployment");
  });

  it("rejects unknown format", async () => {
    const store = fakeStore();
    const app = createServer({ store });
    const res = await request(app).get("/v1/recall/x?format=xml");
    expect(res.status).toBe(400);
  });

  it("rejects bad limit", async () => {
    const store = fakeStore();
    const app = createServer({ store });
    const res = await request(app).get("/v1/recall/x?limit=-1");
    expect(res.status).toBe(400);
  });

  it("context output shows '(no fragments)' when empty", async () => {
    const store = fakeStore();
    store.recall.mockResolvedValue([]);
    const app = createServer({ store });
    const res = await request(app).get("/v1/recall/x?format=context");
    expect(res.text).toContain("(no fragments)");
  });
});

describe("GET /v1/search", () => {
  it("requires a query", async () => {
    const store = fakeStore();
    const app = createServer({ store });
    const res = await request(app).get("/v1/search");
    expect(res.status).toBe(400);
  });

  it("returns matching fragments", async () => {
    const store = fakeStore();
    store.search.mockResolvedValue([fragment(), fragment({ fragmentId: "b" })]);
    const app = createServer({ store });
    const res = await request(app).get("/v1/search?query=nginx&limit=10");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(store.search).toHaveBeenCalledWith("nginx", 10);
  });
});

describe("GET /v1/fragments/:id", () => {
  it("returns 404 when missing", async () => {
    const store = fakeStore();
    store.getFragment.mockResolvedValue(null);
    const app = createServer({ store });
    const res = await request(app).get("/v1/fragments/nope");
    expect(res.status).toBe(404);
  });

  it("returns the fragment", async () => {
    const store = fakeStore();
    store.getFragment.mockResolvedValue(fragment());
    const app = createServer({ store });
    const res = await request(app).get("/v1/fragments/abc");
    expect(res.status).toBe(200);
    expect(res.body.topic).toBe("deployment");
  });
});

describe("PATCH /v1/evolve/:id", () => {
  it("supersedes a fragment", async () => {
    const store = fakeStore();
    store.evolve.mockResolvedValue({
      deprecated: fragment({ isDeprecated: true }),
      replacement: fragment({ fragmentId: "new", content: "corrected" }),
    });
    const app = createServer({ store });
    const res = await request(app)
      .patch("/v1/evolve/abc")
      .send({ content: "corrected", importance: 5 });
    expect(res.status).toBe(200);
    expect(res.body.replacement.content).toBe("corrected");
  });

  it("rejects missing content with 400", async () => {
    const store = fakeStore();
    const app = createServer({ store });
    const res = await request(app).patch("/v1/evolve/abc").send({});
    expect(res.status).toBe(400);
  });

  it("translates not-found into 404", async () => {
    const store = fakeStore();
    store.evolve.mockRejectedValue(new Error("fragment not found: abc"));
    const app = createServer({ store });
    const res = await request(app).patch("/v1/evolve/abc").send({ content: "x" });
    expect(res.status).toBe(404);
  });
});

describe("auth middleware", () => {
  it("requires Bearer when token set", async () => {
    const store = fakeStore();
    const app = createServer({ store, authToken: "tok" });
    const denied = await request(app).get("/v1/healthz");
    expect(denied.status).toBe(401);
    const allowed = await request(app).get("/v1/healthz").set("Authorization", "Bearer tok");
    expect(allowed.status).toBe(200);
  });
});

describe("error handler", () => {
  it("surfaces unexpected errors as 500", async () => {
    const store = fakeStore();
    store.recall.mockRejectedValue(new Error("kaboom"));
    const app = createServer({ store });
    const res = await request(app).get("/v1/recall/x");
    expect(res.status).toBe(500);
    expect(res.body.code).toBe("internal");
  });

  it("classifies 'must be' / 'required' messages as 400", async () => {
    const store = fakeStore();
    store.recall.mockRejectedValue(new Error("limit must be a positive integer"));
    const app = createServer({ store });
    const res = await request(app).get("/v1/recall/x");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_request");
  });

  it("healthz surfaces ping exceptions through the error handler", async () => {
    const store = fakeStore();
    store.ping.mockRejectedValue(new Error("db blew up"));
    const app = createServer({ store });
    const res = await request(app).get("/v1/healthz");
    expect(res.status).toBe(500);
  });

  it("rejects non-integer limit query", async () => {
    const store = fakeStore();
    const app = createServer({ store });
    const res = await request(app).get("/v1/recall/x?limit=abc");
    expect(res.status).toBe(400);
  });

  it("rejects bad sub_topic type", async () => {
    const store = fakeStore();
    const app = createServer({ store });
    const res = await request(app)
      .post("/v1/connect")
      .send({ topic: "t", content: "c", source_agent: "a", sub_topic: 42 });
    expect(res.status).toBe(400);
  });

  it("rejects bad linear_ref type", async () => {
    const store = fakeStore();
    const app = createServer({ store });
    const res = await request(app)
      .post("/v1/connect")
      .send({ topic: "t", content: "c", source_agent: "a", linear_ref: 42 });
    expect(res.status).toBe(400);
  });

  it("rejects non-object body to /connect", async () => {
    const store = fakeStore();
    const app = createServer({ store });
    const res = await request(app)
      .post("/v1/connect")
      .set("Content-Type", "application/json")
      .send("[]");
    expect(res.status).toBe(400);
  });

  it("rejects non-object body to /evolve", async () => {
    const store = fakeStore();
    const app = createServer({ store });
    const res = await request(app)
      .patch("/v1/evolve/abc")
      .set("Content-Type", "application/json")
      .send("[]");
    expect(res.status).toBe(400);
  });

  it("rejects bad importance on /evolve", async () => {
    const store = fakeStore();
    const app = createServer({ store });
    const res = await request(app).patch("/v1/evolve/abc").send({ content: "x", importance: 9 });
    expect(res.status).toBe(400);
  });
});
