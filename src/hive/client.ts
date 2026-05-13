/**
 * HiveTendril — Node client for the VECNA Hive Nexus.
 *
 * Embedders use this when calling from within a Node process. Shell-driven
 * agents use the `vecna` CLI (which wraps the same HTTP surface).
 *
 * Errors carry a useful message; HTTP transport failures bubble as
 * `Error` with `code: "hive_unreachable"` so callers can distinguish
 * "service down" from "bad input".
 */

import { loadVecnaClientConfig, type ClientConfig } from "./config.js";
import type {
  ConnectInput,
  ConnectResult,
  EvolveInput,
  EvolveResult,
  Fragment,
  RecallOptions,
} from "./types.js";

export interface HiveTendrilOptions {
  url?: string;
  authToken?: string | null;
  timeoutMs?: number;
  /** Test seam — defaults to global `fetch`. */
  fetchImpl?: typeof globalThis.fetch;
}

export class HiveTendril {
  private readonly config: ClientConfig;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(opts: HiveTendrilOptions = {}) {
    const env = loadVecnaClientConfig();
    this.config = {
      url: opts.url ?? env.url,
      authToken: opts.authToken === undefined ? env.authToken : opts.authToken,
      timeoutMs: opts.timeoutMs ?? env.timeoutMs,
    };
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  async healthz(): Promise<{ ok: boolean; db: "up" | "down"; version: string }> {
    return this.request<{ ok: boolean; db: "up" | "down"; version: string }>("GET", "/v1/healthz");
  }

  async connect(input: ConnectInput): Promise<ConnectResult> {
    return this.request<ConnectResult>("POST", "/v1/connect", input);
  }

  async recall(
    topic: string,
    opts: RecallOptions = {},
  ): Promise<{ topic: string; count: number; fragments: Fragment[] }> {
    const params = new URLSearchParams();
    if (opts.ticket) params.set("ticket", opts.ticket);
    if (opts.limit) params.set("limit", String(opts.limit));
    const q = params.toString();
    const path = `/v1/recall/${encodeURIComponent(topic)}${q ? `?${q}` : ""}`;
    return this.request("GET", path);
  }

  async recallAsContext(topic: string, opts: RecallOptions = {}): Promise<string> {
    const params = new URLSearchParams({ format: "context" });
    if (opts.ticket) params.set("ticket", opts.ticket);
    if (opts.limit) params.set("limit", String(opts.limit));
    return this.requestText("GET", `/v1/recall/${encodeURIComponent(topic)}?${params.toString()}`);
  }

  async search(
    query: string,
    limit?: number,
  ): Promise<{ query: string; count: number; fragments: Fragment[] }> {
    const params = new URLSearchParams({ query });
    if (limit) params.set("limit", String(limit));
    return this.request("GET", `/v1/search?${params.toString()}`);
  }

  async getFragment(id: string): Promise<Fragment | null> {
    try {
      return await this.request<Fragment>("GET", `/v1/fragments/${encodeURIComponent(id)}`);
    } catch (err) {
      if (err instanceof Error && err.message.includes("not_found")) return null;
      throw err;
    }
  }

  async evolve(id: string, input: EvolveInput): Promise<EvolveResult> {
    return this.request<EvolveResult>("PATCH", `/v1/evolve/${encodeURIComponent(id)}`, input);
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const text = await this.requestText(method, path, body);
    if (text.length === 0) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`hive returned non-JSON body for ${method} ${path}: ${text.slice(0, 200)}`);
    }
  }

  private async requestText(method: string, path: string, body?: unknown): Promise<string> {
    const url = this.config.url + path;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.config.authToken) headers.Authorization = `Bearer ${this.config.authToken}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const init: RequestInit = { method, headers, signal: controller.signal };
    if (body !== undefined) init.body = JSON.stringify(body);
    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`hive_unreachable: ${msg} (${method} ${url})`);
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`hive HTTP ${response.status}: ${text || response.statusText}`);
    }
    return text;
  }
}
