/**
 * Tiny JSON-lines logger middleware for the Nexus.
 *
 * Per `docs/branding.md`, log lines lean Stranger-Things-flavoured but
 * stay structured. Each access log is one JSON line on stdout.
 */

import type { NextFunction, Request, Response } from "express";

export function accessLog(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const line = {
      ts: new Date().toISOString(),
      msg: "[nexus] hive request",
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 1000) / 1000,
      ua: req.headers["user-agent"] ?? null,
      sourceAgent: req.headers["x-source-agent"] ?? null,
    };
    process.stdout.write(JSON.stringify(line) + "\n");
  });
  next();
}

/** Narrative log for in-process events (recall hits, evolve, etc.). */
export function narrate(message: string, fields: Record<string, unknown> = {}): void {
  const line = { ts: new Date().toISOString(), msg: `[nexus] ${message}`, ...fields };
  process.stdout.write(JSON.stringify(line) + "\n");
}
