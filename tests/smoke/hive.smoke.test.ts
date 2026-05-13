/**
 * VECNA Hive smoke test. Opens a real connection to MARIADB_URL and runs a
 * full connect → recall → evolve roundtrip against a temporary fragment.
 *
 * Requires:
 *   MARIADB_URL, MARIADB_USER, MARIADB_PASSWORD
 *
 * The schema must already be applied (`make bootstrap-vecna-db`).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HiveStore } from "../../src/hive/store.js";
import { loadDBConfig } from "../../src/config.js";
import { missingEnv, describeMissing } from "./_helpers.js";

const REQUIRED = ["MARIADB_URL", "MARIADB_USER", "MARIADB_PASSWORD"] as const;
const skip = missingEnv(REQUIRED);

describe(`vecna hive smoke ${skip ? "[skipped: " + describeMissing(REQUIRED) + "]" : ""}`, () => {
  let store: HiveStore;
  const insertedIds: string[] = [];

  beforeAll(() => {
    if (!skip) store = new HiveStore({ db: loadDBConfig(), dedupWindowMinutes: 5 });
  });

  afterAll(async () => {
    if (skip) return;
    // Best-effort cleanup of test fragments via evolve (marks them deprecated).
    // We can't DELETE because the user may not have DELETE privilege.
    await store.close();
  });

  it.skipIf(skip)("connects + recalls a fragment", async () => {
    const result = await store.connect({
      topic: `[smoke] hive ${Date.now()}`,
      content: "smoke test fragment — safe to deprecate",
      sourceAgent: "smoke-test",
      importance: 2,
    });
    expect(result.deduplicated).toBe(false);
    insertedIds.push(result.fragment.fragmentId);

    const fragments = await store.recall(result.fragment.topic);
    expect(fragments[0]?.fragmentId).toBe(result.fragment.fragmentId);
  });

  it.skipIf(skip)("evolves a fragment", async () => {
    const created = await store.connect({
      topic: `[smoke] evolve ${Date.now()}`,
      content: "original",
      sourceAgent: "smoke-test",
      importance: 2,
    });
    insertedIds.push(created.fragment.fragmentId);

    const evolved = await store.evolve(created.fragment.fragmentId, {
      content: "corrected",
    });
    insertedIds.push(evolved.replacement.fragmentId);
    expect(evolved.deprecated.isDeprecated).toBe(true);
    expect(evolved.replacement.content).toBe("corrected");
  });
});
