/**
 * The 12 typed tools the plugin contributes to OpenClaw:
 *
 *   VINES — durable orchestration state (wraps `Ledger`):
 *     vines_triage, vines_start, vines_set_state,
 *     vines_attach_linear_parent, vines_recover, vines_status
 *
 *   VECNA — shared agent memory (wraps `HiveStore`):
 *     vecna_connect, vecna_recall, vecna_evolve,
 *     vecna_search, vecna_fragment, vecna_healthz
 *
 * Each tool exposes a TypeBox schema that the OpenClaw runtime validates
 * before `execute` is called, so handlers operate on already-checked input.
 */
import { jsonResult } from "openclaw/plugin-sdk/core";
import type { AnyAgentTool } from "openclaw/plugin-sdk/core";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Static, TSchema } from "typebox";
import { Type } from "typebox";
import type { LedgerState } from "../types.js";
import {
  type LookupStatus,
  type RecoveryItem,
  markFailedIfOrphaned,
  scanRecovery,
} from "../recovery.js";
import type { HawkinsServices } from "./services.js";

// ---------------------------------------------------------------------------
// VINES tools
// ---------------------------------------------------------------------------

const LEDGER_STATES = Type.Union(
  (["init", "planning", "executing", "success", "failed"] satisfies LedgerState[]).map((s) =>
    Type.Literal(s),
  ),
);

const VinesTriageParams = Type.Object({
  objectiveSummary: Type.String({ minLength: 1, maxLength: 2048 }),
  linearParentId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  orchestrationId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
});

const VinesStartParams = Type.Object({
  orchestrationId: Type.String({ minLength: 1, maxLength: 64 }),
  lastAgentActive: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const VinesSetStateParams = Type.Object({
  orchestrationId: Type.String({ minLength: 1, maxLength: 64 }),
  state: LEDGER_STATES,
  lastAgentActive: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const VinesAttachLinearParentParams = Type.Object({
  orchestrationId: Type.String({ minLength: 1, maxLength: 64 }),
  linearParentId: Type.String({ minLength: 1, maxLength: 64 }),
});

const VinesRecoverParams = Type.Object({
  markOrphanedAsFailed: Type.Optional(Type.Boolean()),
  doneStateNames: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
});

const VinesStatusParams = Type.Object({
  orchestrationId: Type.String({ minLength: 1, maxLength: 64 }),
});

function buildTool<T extends TSchema>(
  name: string,
  label: string,
  description: string,
  parameters: T,
  execute: (
    toolCallId: string,
    params: Static<T>,
    signal?: AbortSignal,
  ) => Promise<AgentToolResult<unknown>>,
): AnyAgentTool {
  const tool: AnyAgentTool = {
    name,
    label,
    description,
    parameters,
    async execute(toolCallId, params, signal) {
      return execute(toolCallId, params as Static<T>, signal);
    },
  };
  return tool;
}

export function makeVinesTriageTool(services: HawkinsServices): AnyAgentTool {
  return buildTool(
    "vines_triage",
    "VINES: triage",
    "Open a new durable orchestration row in VINES (state=init). Returns the orchestration id used by every other VINES tool.",
    VinesTriageParams,
    async (_id, params) => {
      const orchestrationId = await services.ledger.create({
        objectiveSummary: params.objectiveSummary,
        linearParentId: params.linearParentId ?? null,
        ...(params.orchestrationId !== undefined && {
          orchestrationId: params.orchestrationId,
        }),
      });
      const row = await services.ledger.get(orchestrationId);
      return jsonResult({ orchestrationId, state: row?.state ?? "init", row });
    },
  );
}

export function makeVinesStartTool(services: HawkinsServices): AnyAgentTool {
  return buildTool(
    "vines_start",
    "VINES: start executing",
    "Transition a VINES orchestration to state=executing. Records the active Tendril if provided.",
    VinesStartParams,
    async (_id, params) => {
      const ok = await services.ledger.setState(params.orchestrationId, "executing", {
        lastAgentActive: params.lastAgentActive ?? null,
      });
      return jsonResult({ ok, state: "executing", orchestrationId: params.orchestrationId });
    },
  );
}

export function makeVinesSetStateTool(services: HawkinsServices): AnyAgentTool {
  return buildTool(
    "vines_set_state",
    "VINES: set state",
    "Set the VINES orchestration to an arbitrary lifecycle state (init|planning|executing|success|failed).",
    VinesSetStateParams,
    async (_id, params) => {
      const ok = await services.ledger.setState(params.orchestrationId, params.state, {
        lastAgentActive: params.lastAgentActive ?? null,
      });
      return jsonResult({ ok, orchestrationId: params.orchestrationId, state: params.state });
    },
  );
}

export function makeVinesAttachLinearParentTool(services: HawkinsServices): AnyAgentTool {
  return buildTool(
    "vines_attach_linear_parent",
    "VINES: attach Linear parent",
    "Attach (or update) the Linear parent ticket id on an existing VINES orchestration row. Enables Linear-anchored recovery.",
    VinesAttachLinearParentParams,
    async (_id, params) => {
      const ok = await services.ledger.attachLinearParent(
        params.orchestrationId,
        params.linearParentId,
      );
      return jsonResult({
        ok,
        orchestrationId: params.orchestrationId,
        linearParentId: params.linearParentId,
      });
    },
  );
}

export function makeVinesRecoverTool(services: HawkinsServices): AnyAgentTool {
  return buildTool(
    "vines_recover",
    "VINES: recover",
    "Scan unfinished VINES orchestrations and cross-reference Linear to identify resumable vs orphaned vs lookup-failed rows. Optionally marks definitively orphaned rows as failed.",
    VinesRecoverParams,
    async (_id, params) => {
      const linear = services.getLinear();
      const doneStates = params.doneStateNames ? new Set(params.doneStateNames) : undefined;
      const report = linear
        ? await scanRecovery(services.ledger, linear, doneStates)
        : { items: [] as RecoveryItem[] };

      const summary = {
        scanned: report.items.length,
        resumable: report.items.filter((i: RecoveryItem) => i.lookupStatus === "ok").length,
        orphaned: report.items.filter((i: RecoveryItem) => i.lookupStatus === "missing").length,
        lookupFailed: report.items.filter((i: RecoveryItem) => i.lookupStatus === "lookup_failed")
          .length,
        noParentId: report.items.filter((i: RecoveryItem) => i.lookupStatus === "no_parent_id")
          .length,
        markedFailed: 0,
        linearAvailable: linear !== null,
      };

      if (params.markOrphanedAsFailed && linear) {
        for (const item of report.items) {
          if (await markFailedIfOrphaned(services.ledger, item)) summary.markedFailed += 1;
        }
      }

      return jsonResult({
        summary,
        items: report.items.map((i: RecoveryItem) => ({
          orchestrationId: i.ledgerRow.orchestrationId,
          linearParentId: i.ledgerRow.linearParentId,
          state: i.ledgerRow.state,
          lookupStatus: i.lookupStatus satisfies LookupStatus,
          lookupError: i.lookupError ?? null,
          lastCompletedChild: i.lastCompletedChild,
          nextPendingChild: i.nextPendingChild,
        })),
      });
    },
  );
}

export function makeVinesStatusTool(services: HawkinsServices): AnyAgentTool {
  return buildTool(
    "vines_status",
    "VINES: status",
    "Fetch the current ledger row for a VINES orchestration. Returns null if not found.",
    VinesStatusParams,
    async (_id, params) => {
      const row = await services.ledger.get(params.orchestrationId);
      return jsonResult({ row });
    },
  );
}

// ---------------------------------------------------------------------------
// VECNA tools
// ---------------------------------------------------------------------------

const VecnaConnectParams = Type.Object({
  topic: Type.String({ minLength: 1, maxLength: 128 }),
  content: Type.String({ minLength: 1 }),
  sourceAgent: Type.String({ minLength: 1, maxLength: 64 }),
  subTopic: Type.Optional(Type.Union([Type.String({ maxLength: 128 }), Type.Null()])),
  importance: Type.Optional(
    Type.Union([
      Type.Literal(1),
      Type.Literal(2),
      Type.Literal(3),
      Type.Literal(4),
      Type.Literal(5),
    ]),
  ),
  linearRef: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
});

const VecnaRecallParams = Type.Object({
  topic: Type.String({ minLength: 1, maxLength: 128 }),
  ticket: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
  format: Type.Optional(Type.Union([Type.Literal("json"), Type.Literal("context")])),
});

const VecnaEvolveParams = Type.Object({
  fragmentId: Type.String({ minLength: 1, maxLength: 64 }),
  content: Type.String({ minLength: 1 }),
  importance: Type.Optional(
    Type.Union([
      Type.Literal(1),
      Type.Literal(2),
      Type.Literal(3),
      Type.Literal(4),
      Type.Literal(5),
    ]),
  ),
  reason: Type.Optional(Type.String()),
});

const VecnaSearchParams = Type.Object({
  query: Type.String({ minLength: 1 }),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
});

const VecnaFragmentParams = Type.Object({
  fragmentId: Type.String({ minLength: 1, maxLength: 64 }),
});

const VecnaHealthzParams = Type.Object({});

export function makeVecnaConnectTool(services: HawkinsServices): AnyAgentTool {
  return buildTool(
    "vecna_connect",
    "VECNA: connect",
    "Write a knowledge fragment to the VECNA Hive — a shared knowledge store outside this host. This publishes content externally, so it requires explicit operator approval and MUST NOT include secrets, credentials, tokens, internal hostnames, file paths, or personal/customer data. Repeated identical high-importance fragments inside the dedup window collapse into the existing row.",
    VecnaConnectParams,
    async (_id, params) => {
      const result = await services.hive.connect({
        topic: params.topic,
        content: params.content,
        sourceAgent: params.sourceAgent,
        subTopic: params.subTopic ?? null,
        linearRef: params.linearRef ?? null,
        ...(params.importance !== undefined && { importance: params.importance }),
      });
      return jsonResult(result);
    },
  );
}

function formatRecallContext(topic: string, fragments: unknown[]): string {
  if (fragments.length === 0) return `[vecna] no fragments for topic "${topic}".`;
  const lines = [`[vecna] ${fragments.length} fragment(s) for "${topic}":`];
  for (const f of fragments as { sourceAgent: string; importance: number; content: string }[]) {
    lines.push(`  - (${f.sourceAgent}, importance ${f.importance}) ${f.content}`);
  }
  return lines.join("\n");
}

export function makeVecnaRecallTool(services: HawkinsServices): AnyAgentTool {
  return buildTool(
    "vecna_recall",
    "VECNA: recall",
    "Recall non-deprecated fragments for a topic, ranked by ticket-affinity, importance, recency, and decay. Use format='context' to get a pre-summarised string for prompt injection.",
    VecnaRecallParams,
    async (_id, params) => {
      const fragments = await services.hive.recall(params.topic, {
        ...(params.ticket !== undefined && params.ticket !== null && { ticket: params.ticket }),
        ...(params.limit !== undefined && { limit: params.limit }),
      });
      if (params.format === "context") {
        return {
          content: [{ type: "text", text: formatRecallContext(params.topic, fragments) }],
          details: { fragments },
        };
      }
      return jsonResult({ fragments });
    },
  );
}

export function makeVecnaEvolveTool(services: HawkinsServices): AnyAgentTool {
  return buildTool(
    "vecna_evolve",
    "VECNA: evolve",
    "Deprecate an existing VECNA fragment and write a corrected replacement atomically.",
    VecnaEvolveParams,
    async (_id, params) => {
      const result = await services.hive.evolve(params.fragmentId, {
        content: params.content,
        ...(params.importance !== undefined && { importance: params.importance }),
        ...(params.reason !== undefined && { reason: params.reason }),
      });
      return jsonResult(result);
    },
  );
}

export function makeVecnaSearchTool(services: HawkinsServices): AnyAgentTool {
  return buildTool(
    "vecna_search",
    "VECNA: search",
    "Full-text search across non-deprecated VECNA fragments. Use when no clear topic is known.",
    VecnaSearchParams,
    async (_id, params) => {
      const fragments = await services.hive.search(params.query, params.limit);
      return jsonResult({ fragments });
    },
  );
}

export function makeVecnaFragmentTool(services: HawkinsServices): AnyAgentTool {
  return buildTool(
    "vecna_fragment",
    "VECNA: get fragment",
    "Fetch one VECNA fragment by id. Returns null if not found.",
    VecnaFragmentParams,
    async (_id, params) => {
      const fragment = await services.hive.getFragment(params.fragmentId);
      return jsonResult({ fragment });
    },
  );
}

export function makeVecnaHealthzTool(services: HawkinsServices): AnyAgentTool {
  return buildTool(
    "vecna_healthz",
    "VECNA: healthz",
    "Liveness probe for the VECNA Hive. Pings MariaDB and returns { ok, db, version }.",
    VecnaHealthzParams,
    async () => {
      const ok = await services.hive.ping();
      return jsonResult({ ok, db: ok ? "up" : "down" });
    },
  );
}

// ---------------------------------------------------------------------------
// Public: registry of all 12 tool factories
// ---------------------------------------------------------------------------

export function createAllTools(services: HawkinsServices): AnyAgentTool[] {
  return [
    makeVinesTriageTool(services),
    makeVinesStartTool(services),
    makeVinesSetStateTool(services),
    makeVinesAttachLinearParentTool(services),
    makeVinesRecoverTool(services),
    makeVinesStatusTool(services),
    makeVecnaConnectTool(services),
    makeVecnaRecallTool(services),
    makeVecnaEvolveTool(services),
    makeVecnaSearchTool(services),
    makeVecnaFragmentTool(services),
    makeVecnaHealthzTool(services),
  ];
}
