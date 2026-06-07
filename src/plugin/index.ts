/**
 * OpenClaw plugin entry for openclaw-hawkins.
 *
 * Wires together:
 *   - 12 typed tools (6 VINES + 6 VECNA) from `./tools.ts`
 *   - `openclaw hawkins setup` CLI command from `./setup.ts`
 *   - optional `gateway_start` auto-recovery hook from `./hooks.ts`
 *   - a background service that releases pooled connections on `gateway_stop`
 */
import { buildJsonPluginConfigSchema, definePluginEntry } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import { type HawkinsPluginConfig, isAutoRecoveryEnabled, isVecnaEnabled } from "./config.js";
import { buildAutoRecoveryHandler } from "./hooks.js";
import { runSetup } from "./setup.js";
import { createServices } from "./services.js";
import { createVecnaTools, createVinesTools } from "./tools.js";

const PLUGIN_ID = "openclaw-hawkins";

const CONFIG_SCHEMA = buildJsonPluginConfigSchema({
  type: "object",
  additionalProperties: false,
  properties: {
    mariadb: {
      type: "object",
      additionalProperties: false,
      description:
        "Non-secret connection metadata only. MARIADB_PASSWORD must come from the gateway env (a 0600 EnvironmentFile or `systemctl --user set-environment`) — the plugin schema deliberately rejects passwords so secrets never sit as plaintext in openclaw.json.",
      properties: {
        url: { type: "string" },
        user: { type: "string" },
        ssl: {
          type: "string",
          enum: ["disabled", "preferred", "required"],
        },
      },
    },
    autoRecovery: { type: "boolean" },
    vecna: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        dedupWindowMinutes: { type: "number", minimum: 0 },
      },
    },
  },
});

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "OpenClaw Hawkins — VINES + VECNA",
  description:
    "Persistent runtime plugin for OpenClaw. Activates on gateway startup and registers durable-orchestration (VINES) tools for a 6-tendril Nexus swarm. Shared-agent-memory (VECNA) is disabled by default and enforced: its read/write/search tools are not registered at all unless the operator sets `vecna.enabled=true` — so an agent cannot reach the shared store even if prompted to. When enabled, VECNA reads from and writes to a shared knowledge store outside this host.",
  configSchema: CONFIG_SCHEMA,
  register(api: OpenClawPluginApi) {
    const pluginConfig = (api.pluginConfig ?? {}) as HawkinsPluginConfig;
    const services = createServices(pluginConfig);

    // 1. Register the six VINES tools always. The six VECNA tools cross a trust
    //    boundary (a shared store outside the host), so they are registered ONLY
    //    when the operator has explicitly enabled VECNA — hard enforcement, not
    //    just prompt guidance. When disabled, the vecna_* tools do not exist, so
    //    no agent can use them even if instructed to.
    for (const tool of createVinesTools(services)) {
      api.registerTool(tool);
    }
    if (isVecnaEnabled(pluginConfig)) {
      for (const tool of createVecnaTools(services)) {
        api.registerTool(tool);
      }
      api.logger.info("[hawkins] VECNA enabled — registered the vecna_* tools");
    } else {
      api.logger.info(
        "[hawkins] VECNA disabled — vecna_* tools not registered. Set " +
          "plugins.entries.openclaw-hawkins.config.vecna.enabled=true to enable.",
      );
    }

    // 2. Register the `openclaw hawkins setup` CLI command.
    api.registerCli(
      ({ program }) => {
        program
          .command("hawkins")
          .description("openclaw-hawkins (VINES + VECNA) management commands")
          .addCommand(
            program
              .createCommand("setup")
              .description(
                "Apply VINES + VECNA schemas to MariaDB and create the 6 specialist agents.",
              )
              .option("--skip-agents", "Apply schemas only; skip agent creation.")
              .option("--agents-base <dir>", "Override the agents base dir.")
              .action(async (options: { skipAgents?: boolean; agentsBase?: string }) => {
                await runSetup({
                  pluginConfig,
                  ...(options.skipAgents !== undefined && { skipAgents: options.skipAgents }),
                  ...(options.agentsBase !== undefined && { agentsBaseDir: options.agentsBase }),
                });
              }),
          );
      },
      {
        descriptors: [
          {
            name: "hawkins",
            description: "openclaw-hawkins management commands",
            hasSubcommands: true,
          },
        ],
      },
    );

    // 3. Optional auto-recovery on gateway start.
    api.registerHook(
      "gateway_start",
      buildAutoRecoveryHandler({
        enabled: isAutoRecoveryEnabled(pluginConfig),
        services,
        logger: api.logger,
      }),
      { name: "hawkins/auto-recovery" },
    );

    // 4. Service lifecycle: release pools when the gateway stops.
    api.registerService({
      id: `${PLUGIN_ID}/services`,
      start: () => {
        api.logger.info("[hawkins] services ready (lazy-init: ledger + hive open on first use)");
      },
      stop: async () => {
        await services.close();
        api.logger.info("[hawkins] services closed");
      },
    });
  },
});
