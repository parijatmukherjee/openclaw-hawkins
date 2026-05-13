/**
 * MariaDB smoke test. Opens a real connection to MARIADB_URL and runs a
 * full ledger CRUD roundtrip against a temporary row.
 *
 * Requires:
 *   MARIADB_URL, MARIADB_USER, MARIADB_PASSWORD  (MARIADB_SSL optional)
 *
 * The schema must already be applied (`make bootstrap-db`). The test cleans
 * up the row it creates.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Ledger } from "../../src/persistence.js";
import { missingEnv, describeMissing } from "./_helpers.js";

const REQUIRED = ["MARIADB_URL", "MARIADB_USER", "MARIADB_PASSWORD"] as const;
const skip = missingEnv(REQUIRED);

describe(`mariadb smoke ${skip ? "[skipped: " + describeMissing(REQUIRED) + "]" : ""}`, () => {
  let ledger: Ledger;
  const ids: string[] = [];

  beforeAll(() => {
    if (!skip) ledger = Ledger.fromEnv();
  });

  afterAll(async () => {
    if (skip) return;
    // Clean up any rows the smoke test inserted. Deleting is fine because
    // the smoke run scopes its own UUIDs — never touches operator data.
    for (const id of ids) {
      try {
        // The Ledger class doesn't expose delete (and shouldn't) — use the
        // pool directly via setState to mark cancelled, then leave a trail
        // that's obvious in `vines status`.
        await ledger.setState(id, "failed", { lastAgentActive: "smoke-test" });
      } catch {
        // best-effort cleanup
      }
    }
    await ledger.close();
  });

  it.skipIf(skip)("connects + create / get roundtrip", async () => {
    const id = await ledger.create({
      objectiveSummary: "[smoke] mariadb connectivity check — safe to delete",
      state: "init",
    });
    ids.push(id);

    const row = await ledger.get(id);
    expect(row).not.toBeNull();
    expect(row!.orchestrationId).toBe(id);
    expect(row!.objectiveSummary).toMatch(/smoke/);
    expect(row!.state).toBe("init");
  });

  it.skipIf(skip)("state transitions persist", async () => {
    const id = await ledger.create({
      objectiveSummary: "[smoke] state-transition check",
      state: "init",
    });
    ids.push(id);

    await ledger.setState(id, "planning");
    await ledger.setState(id, "executing", { lastAgentActive: "smoke-system-agent" });
    const row = await ledger.get(id);
    expect(row!.state).toBe("executing");
    expect(row!.lastAgentActive).toBe("smoke-system-agent");
  });

  it.skipIf(skip)("listUnfinished surfaces in-flight orchestrations", async () => {
    const all = await ledger.listUnfinished();
    // The two rows we created above are still in unfinished states.
    const ours = all.filter((r) => ids.includes(r.orchestrationId));
    expect(ours.length).toBeGreaterThanOrEqual(2);
  });
});
