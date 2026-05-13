/**
 * The Nexus — VECNA Hive REST server.
 *
 * Implements `vecna/spec.md` §5. Exported as a factory so tests can
 * mount the app against a fake `HiveStore` without listening on a port.
 */

import express, { type Express, type Request, type Response, type NextFunction } from "express";

import type { HiveStore } from "./store.js";
import type { ConnectInput, EvolveInput, Fragment } from "./types.js";
import { isImportance } from "./types.js";
import { accessLog, narrate } from "./log.js";

export interface ServerOptions {
  store: HiveStore;
  authToken?: string | null;
  version?: string;
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

export function createServer(opts: ServerOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(accessLog);
  if (opts.authToken) {
    app.use(bearerAuth(opts.authToken));
  }

  const version = opts.version ?? "0.1.0";

  // ──────────────────────────────────────────────────────────────────
  // GET /v1/healthz
  // ──────────────────────────────────────────────────────────────────
  app.get(
    "/v1/healthz",
    asyncHandler(async (_req, res) => {
      const dbUp = await opts.store.ping();
      res.json({ ok: true, db: dbUp ? "up" : "down", version });
    }),
  );

  // ──────────────────────────────────────────────────────────────────
  // POST /v1/connect
  // ──────────────────────────────────────────────────────────────────
  app.post(
    "/v1/connect",
    asyncHandler(async (req, res) => {
      const input = parseConnect(req.body);
      const result = await opts.store.connect(input);
      const status = result.deduplicated ? 200 : 201;
      res.status(status).json(result);
    }),
  );

  // ──────────────────────────────────────────────────────────────────
  // GET /v1/recall/:topic
  // ──────────────────────────────────────────────────────────────────
  app.get(
    "/v1/recall/:topic",
    asyncHandler(async (req, res) => {
      const topic = req.params.topic;
      const ticket = stringQuery(req, "ticket") ?? undefined;
      const limit = intQuery(req, "limit") ?? undefined;
      const format = stringQuery(req, "format") ?? "json";
      if (format !== "json" && format !== "context") {
        throw httpError(400, "bad_format", "format must be json or context");
      }
      const fragments = await opts.store.recall(topic, {
        ...(ticket !== undefined ? { ticket } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
      if (fragments.length > 0) narrate("The Hive remembers", { topic, hits: fragments.length });
      if (format === "context") {
        res.type("text/plain").send(renderContext(topic, fragments));
        return;
      }
      res.json({ topic, count: fragments.length, fragments });
    }),
  );

  // ──────────────────────────────────────────────────────────────────
  // GET /v1/search?query=...
  // ──────────────────────────────────────────────────────────────────
  app.get(
    "/v1/search",
    asyncHandler(async (req, res) => {
      const query = stringQuery(req, "query");
      if (query === null || query.trim().length === 0) {
        throw httpError(400, "missing_query", "query is required");
      }
      const limit = intQuery(req, "limit") ?? undefined;
      const fragments = await opts.store.search(query, limit);
      res.json({ query, count: fragments.length, fragments });
    }),
  );

  // ──────────────────────────────────────────────────────────────────
  // GET /v1/fragments/:id
  // ──────────────────────────────────────────────────────────────────
  app.get(
    "/v1/fragments/:id",
    asyncHandler(async (req, res) => {
      const fragment = await opts.store.getFragment(req.params.id);
      if (!fragment) throw httpError(404, "not_found", `no such fragment: ${req.params.id}`);
      res.json(fragment);
    }),
  );

  // ──────────────────────────────────────────────────────────────────
  // PATCH /v1/evolve/:id
  // ──────────────────────────────────────────────────────────────────
  app.patch(
    "/v1/evolve/:id",
    asyncHandler(async (req, res, next) => {
      const input = parseEvolve(req.body);
      try {
        const result = await opts.store.evolve(req.params.id, input);
        narrate("Evolving knowledge", {
          deprecated: result.deprecated.fragmentId,
          replacement: result.replacement.fragmentId,
        });
        res.json(result);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("fragment not found")) {
          next(httpError(404, "not_found", err.message));
          return;
        }
        throw err;
      }
    }),
  );

  // ──────────────────────────────────────────────────────────────────
  // Error handler
  // ──────────────────────────────────────────────────────────────────
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isHttpError(err)) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    const status =
      msg.toLowerCase().includes("must be") || msg.toLowerCase().includes("required") ? 400 : 500;
    res.status(status).json({ error: msg, code: status === 400 ? "bad_request" : "internal" });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Auth + parsing helpers
// ---------------------------------------------------------------------------

function bearerAuth(expected: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    const supplied = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    if (supplied === expected) {
      next();
      return;
    }
    res.status(401).json({ error: "unauthorized", code: "unauthorized" });
  };
}

function parseConnect(body: unknown): ConnectInput {
  if (!isObject(body)) throw httpError(400, "bad_body", "JSON body required");
  const topic = body.topic;
  const content = body.content;
  const sourceAgent = body.source_agent ?? body.sourceAgent;
  if (typeof topic !== "string" || topic.length === 0) {
    throw httpError(400, "bad_topic", "topic must be a non-empty string");
  }
  if (typeof content !== "string" || content.length === 0) {
    throw httpError(400, "bad_content", "content must be a non-empty string");
  }
  if (typeof sourceAgent !== "string" || sourceAgent.length === 0) {
    throw httpError(400, "bad_source_agent", "source_agent must be a non-empty string");
  }
  const input: ConnectInput = { topic, content, sourceAgent };
  const subTopic = body.sub_topic ?? body.subTopic;
  if (subTopic !== undefined && subTopic !== null) {
    if (typeof subTopic !== "string")
      throw httpError(400, "bad_sub_topic", "sub_topic must be a string");
    input.subTopic = subTopic;
  }
  if (body.importance !== undefined) {
    if (!isImportance(body.importance))
      throw httpError(400, "bad_importance", "importance must be 1–5");
    input.importance = body.importance;
  }
  const linearRef = body.linear_ref ?? body.linearRef;
  if (linearRef !== undefined && linearRef !== null) {
    if (typeof linearRef !== "string")
      throw httpError(400, "bad_linear_ref", "linear_ref must be a string");
    input.linearRef = linearRef;
  }
  return input;
}

function parseEvolve(body: unknown): EvolveInput {
  if (!isObject(body)) throw httpError(400, "bad_body", "JSON body required");
  const content = body.content;
  if (typeof content !== "string" || content.length === 0) {
    throw httpError(400, "bad_content", "content must be a non-empty string");
  }
  const out: EvolveInput = { content };
  if (body.importance !== undefined) {
    if (!isImportance(body.importance))
      throw httpError(400, "bad_importance", "importance must be 1–5");
    out.importance = body.importance;
  }
  if (body.reason !== undefined && typeof body.reason === "string") {
    out.reason = body.reason;
  }
  return out;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringQuery(req: Request, key: string): string | null {
  const value = req.query[key];
  if (typeof value === "string") return value;
  return null;
}

function intQuery(req: Request, key: string): number | null {
  const value = stringQuery(req, key);
  if (value === null) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw httpError(400, "bad_int", `${key} must be a positive integer; got '${value}'`);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Context rendering (format=context)
// ---------------------------------------------------------------------------

function renderContext(topic: string, fragments: ReadonlyArray<Fragment>): string {
  if (fragments.length === 0) return `# Hive recall — topic: ${topic}\n(no fragments)\n`;
  const lines: string[] = [`# Hive recall — topic: ${topic}`, ""];
  for (const f of fragments) {
    const age = humanAge(f.createdAt);
    const ticket = f.linearTicketRef ? ` [${f.linearTicketRef}]` : "";
    lines.push(`- (${f.sourceAgent}, importance=${f.importance}, ${age})${ticket}`);
    lines.push(`  ${f.content.replace(/\n/g, " ")}`);
  }
  return lines.join("\n") + "\n";
}

function humanAge(date: Date): string {
  const ms = Date.now() - date.getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d ago`;
  const months = Math.floor(days / 30);
  return `${months} mo ago`;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

interface HttpError extends Error {
  status: number;
  code: string;
}

function httpError(status: number, code: string, message: string): HttpError {
  const err = new Error(message) as HttpError;
  err.status = status;
  err.code = code;
  return err;
}

function isHttpError(err: unknown): err is HttpError {
  return (
    err instanceof Error &&
    typeof (err as HttpError).status === "number" &&
    typeof (err as HttpError).code === "string"
  );
}
