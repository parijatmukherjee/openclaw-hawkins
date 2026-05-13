/**
 * Minimal Linear GraphQL client for VINES.
 *
 * Two responsibilities:
 *   1. Mutations during the §3.2 workflow (create parent / child, comment,
 *      transition state).
 *   2. Reads during §4.2 recovery (fetch issue + list children).
 *
 * Uses the built-in `fetch` available in Node ≥20 (the package's engines
 * floor) — no third-party HTTP lib.
 */

import { loadLinearApiKey } from "./config.js";
import type { LinearIssue } from "./types.js";

export const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";

export interface LinearClientOptions {
  apiKey?: string;
  timeoutMs?: number;
  /** Test seam — defaults to the global `fetch`. */
  fetchImpl?: typeof globalThis.fetch;
}

/**
 * Thin GraphQL wrapper. All methods throw {@link Error} with a descriptive
 * message on API failure; the message always starts with `"Linear "` so the
 * CLI can distinguish Linear vs. database failures by prefix.
 */
export class LinearClient {
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(opts: LinearClientOptions = {}) {
    this.apiKey = opts.apiKey ?? loadLinearApiKey();
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  // ------------------------------------------------------------------
  // Transport
  // ------------------------------------------------------------------

  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(LINEAR_GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Linear API unreachable: ${msg}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Linear API HTTP ${response.status}: ${body}`);
    }

    const payload = (await response.json()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };
    if (payload.errors?.length) {
      const msg = payload.errors.map((e) => e.message).join("; ");
      throw new Error(`Linear GraphQL errors: ${msg}`);
    }
    if (payload.data === undefined) {
      throw new Error("Linear API returned no data field");
    }
    return payload.data;
  }

  // ------------------------------------------------------------------
  // Mutations (spec §3.2 steps 1, 4, 6, 7)
  // ------------------------------------------------------------------

  async createIssue(args: {
    teamId: string;
    title: string;
    description?: string;
    parentId?: string;
    stateId?: string;
  }): Promise<LinearIssue> {
    const mutation = /* GraphQL */ `
      mutation Create($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            title
            url
            state {
              name
            }
            parent {
              id
            }
          }
        }
      }
    `;
    const input: Record<string, unknown> = { teamId: args.teamId, title: args.title };
    if (args.description !== undefined) input.description = args.description;
    if (args.parentId !== undefined) input.parentId = args.parentId;
    if (args.stateId !== undefined) input.stateId = args.stateId;

    const data = await this.query<{ issueCreate: IssueCreateResult }>(mutation, { input });
    if (!data.issueCreate.success || !data.issueCreate.issue) {
      throw new Error(`Linear refused issueCreate for "${args.title}"`);
    }
    return toIssue(data.issueCreate.issue);
  }

  async setState(issueId: string, stateId: string): Promise<void> {
    const mutation = /* GraphQL */ `
      mutation Update($id: String!, $stateId: String!) {
        issueUpdate(id: $id, input: { stateId: $stateId }) {
          success
        }
      }
    `;
    const data = await this.query<{ issueUpdate: { success: boolean } }>(mutation, {
      id: issueId,
      stateId,
    });
    if (!data.issueUpdate.success) {
      throw new Error(`Linear refused state change for ${issueId}`);
    }
  }

  async comment(issueId: string, body: string): Promise<void> {
    const mutation = /* GraphQL */ `
      mutation Comment($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) {
          success
        }
      }
    `;
    const data = await this.query<{ commentCreate: { success: boolean } }>(mutation, {
      issueId,
      body,
    });
    if (!data.commentCreate.success) {
      throw new Error(`Linear refused comment on ${issueId}`);
    }
  }

  // ------------------------------------------------------------------
  // Reads (spec §4.2)
  // ------------------------------------------------------------------

  async getIssue(identifierOrId: string): Promise<LinearIssue | null> {
    const query = /* GraphQL */ `
      query GetIssue($id: String!) {
        issue(id: $id) {
          id
          identifier
          title
          url
          state {
            name
          }
          parent {
            id
          }
        }
      }
    `;
    const data = await this.query<{ issue: RawIssue | null }>(query, { id: identifierOrId });
    return data.issue ? toIssue(data.issue) : null;
  }

  async listChildren(parentIdentifierOrId: string): Promise<LinearIssue[]> {
    const query = /* GraphQL */ `
      query Children($id: String!) {
        issue(id: $id) {
          children(first: 250) {
            nodes {
              id
              identifier
              title
              url
              state {
                name
              }
              parent {
                id
              }
            }
          }
        }
      }
    `;
    const data = await this.query<{
      issue: { children?: { nodes?: RawIssue[] } } | null;
    }>(query, { id: parentIdentifierOrId });
    const nodes = data.issue?.children?.nodes ?? [];
    return nodes.map(toIssue);
  }
}

interface RawIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  state: { name: string } | null;
  parent: { id: string } | null;
}

interface IssueCreateResult {
  success: boolean;
  issue: RawIssue | null;
}

function toIssue(raw: RawIssue): LinearIssue {
  return {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    stateName: raw.state?.name ?? "",
    url: raw.url,
    parentId: raw.parent?.id ?? null,
  };
}
