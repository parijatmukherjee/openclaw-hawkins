import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinearClient, LINEAR_GRAPHQL_ENDPOINT } from "../src/linear-client.js";

beforeEach(() => {
  process.env.LINEAR_API_KEY = "test-token";
});

afterEach(() => {
  delete process.env.LINEAR_API_KEY;
});

function jsonResponse(payload: unknown, init: Partial<ResponseInit> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("LinearClient construction", () => {
  it("loads the API key from env", () => {
    const client = new LinearClient();
    expect(client).toBeInstanceOf(LinearClient);
  });

  it("rejects when LINEAR_API_KEY missing", () => {
    delete process.env.LINEAR_API_KEY;
    expect(() => new LinearClient()).toThrow(/LINEAR_API_KEY/);
  });

  it("explicit apiKey wins over env", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true } }));
    const client = new LinearClient({ apiKey: "explicit", fetchImpl });
    await client.query("query { ok }");
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("explicit");
  });
});

describe("LinearClient.query transport", () => {
  it("sends POST to the GraphQL endpoint with auth + body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true } }));
    const client = new LinearClient({ fetchImpl });
    const result = await client.query<{ ok: boolean }>("query { ok }", { x: 1 });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(LINEAR_GRAPHQL_ENDPOINT);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("test-token");
    expect(JSON.parse(init.body as string)).toEqual({
      query: "query { ok }",
      variables: { x: 1 },
    });
  });

  it("surfaces non-2xx as HTTP error", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 401, statusText: "Unauthorized" }));
    const client = new LinearClient({ fetchImpl });
    await expect(client.query("q")).rejects.toThrow(/Linear API HTTP 401/);
  });

  it("surfaces network errors", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("dns"));
    const client = new LinearClient({ fetchImpl });
    await expect(client.query("q")).rejects.toThrow(/Linear API unreachable/);
  });

  it("surfaces GraphQL errors", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ errors: [{ message: "boom" }, { message: "again" }] }));
    const client = new LinearClient({ fetchImpl });
    await expect(client.query("q")).rejects.toThrow(/Linear GraphQL errors: boom; again/);
  });

  it("rejects empty data field", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new LinearClient({ fetchImpl });
    await expect(client.query("q")).rejects.toThrow(/no data field/);
  });
});

describe("LinearClient mutations", () => {
  it("createIssue minimal input", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: "u",
              identifier: "ENG-1",
              title: "x",
              url: "https://linear.app/x",
              state: { name: "Todo" },
              parent: null,
            },
          },
        },
      }),
    );
    const client = new LinearClient({ fetchImpl });
    const issue = await client.createIssue({ teamId: "T", title: "x" });
    expect(issue.identifier).toBe("ENG-1");
    expect(issue.stateName).toBe("Todo");
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.variables.input).toEqual({ teamId: "T", title: "x" });
  });

  it("createIssue forwards all optional fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: "u",
              identifier: "ENG-9",
              title: "x",
              url: "u",
              state: { name: "Todo" },
              parent: { id: "p" },
            },
          },
        },
      }),
    );
    const client = new LinearClient({ fetchImpl });
    await client.createIssue({
      teamId: "T",
      title: "x",
      description: "d",
      parentId: "p",
      stateId: "s",
    });
    const input = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string).variables
      .input as Record<string, unknown>;
    expect(input.description).toBe("d");
    expect(input.parentId).toBe("p");
    expect(input.stateId).toBe("s");
  });

  it("createIssue rejects on success:false", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { issueCreate: { success: false, issue: null } } }));
    const client = new LinearClient({ fetchImpl });
    await expect(client.createIssue({ teamId: "T", title: "x" })).rejects.toThrow(
      /refused issueCreate/,
    );
  });

  it("setState ok / refused", async () => {
    const ok = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { issueUpdate: { success: true } } }));
    await new LinearClient({ fetchImpl: ok }).setState("u", "s");

    const bad = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { issueUpdate: { success: false } } }));
    await expect(new LinearClient({ fetchImpl: bad }).setState("u", "s")).rejects.toThrow(
      /state change/,
    );
  });

  it("comment ok / refused", async () => {
    const ok = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { commentCreate: { success: true } } }));
    await new LinearClient({ fetchImpl: ok }).comment("u", "hi");

    const bad = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { commentCreate: { success: false } } }));
    await expect(new LinearClient({ fetchImpl: bad }).comment("u", "hi")).rejects.toThrow(
      /comment/,
    );
  });
});

describe("LinearClient reads", () => {
  it("getIssue returns parsed issue", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          issue: {
            id: "u",
            identifier: "ENG-7",
            title: "t",
            url: "x",
            state: { name: "In Progress" },
            parent: null,
          },
        },
      }),
    );
    const issue = await new LinearClient({ fetchImpl }).getIssue("ENG-7");
    expect(issue?.identifier).toBe("ENG-7");
    expect(issue?.stateName).toBe("In Progress");
  });

  it("getIssue returns null when absent", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { issue: null } }));
    expect(await new LinearClient({ fetchImpl }).getIssue("nope")).toBeNull();
  });

  it("listChildren returns nodes in order", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          issue: {
            children: {
              nodes: [
                {
                  id: "1",
                  identifier: "ENG-2",
                  title: "a",
                  url: "u",
                  state: { name: "Done" },
                  parent: { id: "p" },
                },
                {
                  id: "2",
                  identifier: "ENG-3",
                  title: "b",
                  url: "u",
                  state: { name: "Todo" },
                  parent: { id: "p" },
                },
              ],
            },
          },
        },
      }),
    );
    const kids = await new LinearClient({ fetchImpl }).listChildren("ENG-1");
    expect(kids.map((c) => c.identifier)).toEqual(["ENG-2", "ENG-3"]);
  });

  it("listChildren copes with missing parent / children fields", async () => {
    let fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { issue: null } }));
    expect(await new LinearClient({ fetchImpl }).listChildren("p")).toEqual([]);

    fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { issue: {} } }));
    expect(await new LinearClient({ fetchImpl }).listChildren("p")).toEqual([]);
  });
});
