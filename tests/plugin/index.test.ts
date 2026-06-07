import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createServicesMock,
  runSetupMock,
  buildAutoRecoveryHandlerMock,
  createVinesToolsMock,
  createVecnaToolsMock,
} = vi.hoisted(() => ({
  createServicesMock: vi.fn(),
  runSetupMock: vi.fn(async () => undefined),
  buildAutoRecoveryHandlerMock: vi.fn(() => async () => undefined),
  createVinesToolsMock: vi.fn(() => [
    { name: "vines_triage", label: "x", description: "x", parameters: { type: "object" } },
    { name: "vines_status", label: "x", description: "x", parameters: { type: "object" } },
  ]),
  createVecnaToolsMock: vi.fn(() => [
    { name: "vecna_connect", label: "y", description: "y", parameters: { type: "object" } },
    { name: "vecna_healthz", label: "y", description: "y", parameters: { type: "object" } },
  ]),
}));

vi.mock("../../src/plugin/services.js", () => ({
  createServices: createServicesMock,
}));
vi.mock("../../src/plugin/setup.js", () => ({
  runSetup: runSetupMock,
  defaultSpecialists: () => [],
}));
vi.mock("../../src/plugin/hooks.js", () => ({
  buildAutoRecoveryHandler: buildAutoRecoveryHandlerMock,
}));
vi.mock("../../src/plugin/tools.js", () => ({
  createVinesTools: createVinesToolsMock,
  createVecnaTools: createVecnaToolsMock,
}));

import plugin from "../../src/plugin/index.js";

function fakeApi() {
  return {
    pluginConfig: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerTool: vi.fn(),
    registerCli: vi.fn(),
    registerHook: vi.fn(),
    registerService: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("plugin entry", () => {
  it("exposes the canonical id + name", () => {
    expect(plugin.id).toBe("openclaw-hawkins");
    expect(plugin.name).toContain("Hawkins");
  });

  it("register() wires services, tools, CLI, hook, and service lifecycle", () => {
    const api = fakeApi();
    createServicesMock.mockReturnValue({
      ledger: {},
      hive: {},
      getLinear: () => null,
      close: vi.fn(async () => undefined),
    });
    // `plugin.register` is part of the DefinedPluginEntry shape — invoke it
    // directly with our fake API and verify the side-effects.
    (plugin as unknown as { register: (api: unknown) => void }).register(api);

    expect(createServicesMock).toHaveBeenCalledOnce();
    // VINES tools always register; VECNA tools are gated off by default.
    expect(createVinesToolsMock).toHaveBeenCalledOnce();
    expect(createVecnaToolsMock).not.toHaveBeenCalled();
    expect(api.registerTool).toHaveBeenCalledTimes(2); // 2 mock VINES tools only
    expect(api.registerCli).toHaveBeenCalledOnce();
    expect(api.registerHook).toHaveBeenCalledWith("gateway_start", expect.any(Function), {
      name: "hawkins/auto-recovery",
    });
    expect(api.registerService).toHaveBeenCalledOnce();
    expect(buildAutoRecoveryHandlerMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it("registerCli registrar contributes a 'hawkins' command with a 'setup' subcommand", () => {
    const api = fakeApi();
    createServicesMock.mockReturnValue({
      ledger: {},
      hive: {},
      getLinear: () => null,
      close: vi.fn(async () => undefined),
    });
    (plugin as unknown as { register: (api: unknown) => void }).register(api);

    const registrar = api.registerCli.mock.calls[0]![0] as (ctx: { program: unknown }) => void;
    const command = vi.fn().mockReturnThis();
    const description = vi.fn().mockReturnThis();
    const addCommand = vi.fn().mockReturnThis();
    const option = vi.fn().mockReturnThis();
    const action = vi.fn().mockReturnThis();
    const createCommand = vi.fn(() => ({
      description,
      option,
      action,
    }));

    const program = {
      command: command.mockReturnValue({ description, addCommand }),
      createCommand,
    };
    registrar({ program });
    expect(command).toHaveBeenCalledWith("hawkins");
    expect(createCommand).toHaveBeenCalledWith("setup");
  });

  it("does NOT register VECNA tools by default (hard-gated off)", () => {
    const api = fakeApi(); // pluginConfig = {}
    createServicesMock.mockReturnValue({
      ledger: {},
      hive: {},
      getLinear: () => null,
      close: vi.fn(async () => undefined),
    });
    (plugin as unknown as { register: (api: unknown) => void }).register(api);
    expect(createVecnaToolsMock).not.toHaveBeenCalled();
    expect(api.registerTool).toHaveBeenCalledTimes(2); // VINES only
  });

  it("registers VECNA tools only when vecna.enabled is true", () => {
    const api = fakeApi();
    api.pluginConfig = { vecna: { enabled: true } };
    createServicesMock.mockReturnValue({
      ledger: {},
      hive: {},
      getLinear: () => null,
      close: vi.fn(async () => undefined),
    });
    (plugin as unknown as { register: (api: unknown) => void }).register(api);
    expect(createVinesToolsMock).toHaveBeenCalledOnce();
    expect(createVecnaToolsMock).toHaveBeenCalledOnce();
    expect(api.registerTool).toHaveBeenCalledTimes(4); // 2 VINES + 2 VECNA
  });

  it("auto-recovery is enabled when plugin config opts in", () => {
    const api = fakeApi();
    api.pluginConfig = { autoRecovery: true };
    createServicesMock.mockReturnValue({
      ledger: {},
      hive: {},
      getLinear: () => null,
      close: vi.fn(async () => undefined),
    });
    (plugin as unknown as { register: (api: unknown) => void }).register(api);
    expect(buildAutoRecoveryHandlerMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
  });

  it("registerService.stop closes pooled connections", async () => {
    const api = fakeApi();
    const close = vi.fn(async () => undefined);
    createServicesMock.mockReturnValue({
      ledger: {},
      hive: {},
      getLinear: () => null,
      close,
    });
    (plugin as unknown as { register: (api: unknown) => void }).register(api);

    const service = api.registerService.mock.calls[0]![0] as {
      id: string;
      start: (ctx: unknown) => Promise<void>;
      stop: (ctx: unknown) => Promise<void>;
    };
    expect(service.id).toBe("openclaw-hawkins/services");
    await service.start({});
    expect(api.logger.info).toHaveBeenCalledWith(expect.stringContaining("services ready"));
    await service.stop({});
    expect(close).toHaveBeenCalledOnce();
    expect(api.logger.info).toHaveBeenCalledWith(expect.stringContaining("services closed"));
  });
});
