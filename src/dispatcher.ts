/**
 * Specialist dispatch primitive.
 *
 * Wraps `openclaw agent --agent <id> --message <task> --json --timeout <s>`.
 * Honours spec §3.2 step 5 ("Specialised Dispatch") and §5's "structured JSON
 * payloads" clause.
 *
 * Replace `dispatchSpecialist` with an ACP transport if you have one — the
 * {@link DispatchResult} shape is the only contract callers depend on.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { VALID_SPECIALISTS, type DispatchResult, type SpecialistId } from "./types.js";

// PATH availability is resolved via execFile's ENOENT — no `which` dependency.
const execFileAsync = promisify(execFile);

export interface DispatchOptions {
  timeoutSeconds: number;
  /** Override the binary lookup; defaults to `openclaw` on PATH. */
  openclawBin?: string;
  /** Test seam — receives (file, args, opts) and returns {stdout, stderr, code}. */
  runner?: (
    file: string,
    args: string[],
    opts: { timeout: number },
  ) => Promise<{ stdout: string; stderr: string; code: number }>;
}

/**
 * Send `message` to `agent` via OpenClaw and parse the reply. Never throws on
 * dispatch failure — returns a {@link DispatchResult} with a non-`ok` status
 * so callers can render the failure into a Linear comment.
 *
 * Throws only on programmer errors: unknown agent, empty message.
 */
export async function dispatchSpecialist(
  agent: SpecialistId,
  message: string,
  opts: DispatchOptions,
): Promise<DispatchResult> {
  if (!VALID_SPECIALISTS.has(agent)) {
    throw new Error(`unknown specialist: ${agent}`);
  }
  if (!message.trim()) {
    throw new Error("message must be non-empty");
  }

  const bin = opts.openclawBin ?? "openclaw";
  const cliArgs = [
    "agent",
    "--agent",
    agent,
    "--message",
    message,
    "--json",
    "--timeout",
    String(Math.floor(opts.timeoutSeconds)),
  ];
  const subprocessTimeout = (opts.timeoutSeconds + 15) * 1000;

  const runner = opts.runner ?? defaultRunner;
  let stdout: string;
  let stderr: string;
  let code: number;
  try {
    ({ stdout, stderr, code } = await runner(bin, cliArgs, { timeout: subprocessTimeout }));
  } catch (err: unknown) {
    if (isTimeoutError(err)) {
      return blank(agent, "timeout", "");
    }
    if (isENoEnt(err)) {
      return blank(agent, "unreachable", `\`${bin}\` not on PATH`);
    }
    return blank(agent, "failed", err instanceof Error ? err.message : String(err));
  }

  if (code !== 0) {
    return blank(agent, "failed", (stderr || stdout || "").trim());
  }

  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return blank(agent, "failed", stdout.trim());
  }
  return parseEnvelope(agent, envelope);
}

/**
 * Pure helper extracted for tests — translate an `openclaw agent` JSON envelope
 * into a {@link DispatchResult}.
 */
export function parseEnvelope(
  agent: SpecialistId,
  envelope: Record<string, unknown>,
): DispatchResult {
  const status = pickStatus(envelope.status);
  const result = (envelope.result ?? {}) as Record<string, unknown>;
  const payloads = (result.payloads ?? []) as Array<Record<string, unknown>>;
  const text = payloads.length > 0 && typeof payloads[0]?.text === "string" ? payloads[0].text : "";
  const meta = (result.meta ?? {}) as Record<string, unknown>;
  const dur = meta.durationMs;
  const durationMs = typeof dur === "number" && Number.isFinite(dur) ? Math.floor(dur) : null;
  return { agent, status, text, durationMs, raw: envelope };
}

function pickStatus(value: unknown): DispatchResult["status"] {
  if (value === "ok" || value === "failed" || value === "timeout" || value === "unreachable") {
    return value;
  }
  return "failed";
}

function blank(
  agent: SpecialistId,
  status: DispatchResult["status"],
  text: string,
): DispatchResult {
  return { agent, status, text, durationMs: null, raw: {} };
}

interface NodeError {
  code?: string;
  killed?: boolean;
  signal?: string;
}

function isTimeoutError(err: unknown): boolean {
  const e = err as NodeError;
  return !!e && (e.killed === true || e.signal === "SIGTERM");
}

function isENoEnt(err: unknown): boolean {
  return (err as NodeError)?.code === "ENOENT";
}

async function defaultRunner(
  file: string,
  args: string[],
  opts: { timeout: number },
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      timeout: opts.timeout,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { stdout: stdout.toString(), stderr: stderr.toString(), code: 0 };
  } catch (err: unknown) {
    const e = err as NodeError & {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      code?: number | string;
    };
    if (typeof e.code === "string") throw err; // ENOENT etc. — propagate
    return {
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
      code: typeof e.code === "number" ? e.code : 1,
    };
  }
}
