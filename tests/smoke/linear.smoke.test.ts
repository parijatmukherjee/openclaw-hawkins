/**
 * Linear API smoke test. Issues a *read-only* GraphQL query through the
 * real LinearClient.
 *
 * Requires:
 *   LINEAR_API_KEY                    (always)
 *   SMOKE_LINEAR_ISSUE_ID  optional   ENG-42 / UUID to fetch via getIssue
 *
 * The test does not write to Linear under any circumstance.
 */
import { describe, expect, it } from "vitest";

import { LinearClient } from "../../src/linear-client.js";
import { missingEnv, describeMissing } from "./_helpers.js";

const REQUIRED = ["LINEAR_API_KEY"] as const;
const skip = missingEnv(REQUIRED);

describe(`linear smoke ${skip ? "[skipped: " + describeMissing(REQUIRED) + "]" : ""}`, () => {
  it.skipIf(skip)("authenticates and runs a viewer query", async () => {
    const client = new LinearClient();
    // `viewer` is the cheapest authenticated read on Linear.
    const data = await client.query<{ viewer: { id: string; name: string } }>(
      "query { viewer { id name } }",
    );
    expect(data.viewer.id).toBeTruthy();
    expect(typeof data.viewer.name).toBe("string");
  });

  it.skipIf(skip || !process.env.SMOKE_LINEAR_ISSUE_ID)(
    "fetches a known issue via getIssue",
    async () => {
      const client = new LinearClient();
      const ref = process.env.SMOKE_LINEAR_ISSUE_ID!;
      const issue = await client.getIssue(ref);
      expect(issue).not.toBeNull();
      expect(issue!.identifier).toBeTruthy();
      expect(issue!.url).toMatch(/^https:\/\//);
    },
  );
});
