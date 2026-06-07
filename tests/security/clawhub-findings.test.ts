/**
 * Regression guardrails for the ClawHub review findings.
 *
 * Each `describe` block pins one cluster of findings: it asserts the mitigation
 * is present AND that the original flagged pattern has not crept back in. If a
 * future edit re-introduces a risky instruction or a verification bypass, the
 * corresponding test fails — the finding cannot silently regress.
 *
 * These are content assertions over the repo's shipped files (agent overlays,
 * manifest, skill, docs, scripts), so they intentionally read from disk rather
 * than importing source modules.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string): string => readFileSync(resolve(repoRoot, rel), "utf8");

const AGENTS = ["code", "comm", "data", "research", "system", "vision"] as const;

describe("VECNA Tendril blocks are operator-gated (data-exfiltration / context-inappropriate / missing-warnings)", () => {
  for (const a of AGENTS) {
    const md = read(`agents/${a}-agent/AGENTS.md`);

    it(`${a}-agent: heading marks the block operator-gated`, () => {
      expect(md).toContain("Tendril of the Hive (optional, operator-gated)");
      // The old ungated heading must be gone.
      expect(md).not.toMatch(/^## Tendril of the Hive \(optional\)\s*$/m);
    });

    it(`${a}-agent: recalled content is flagged untrusted, not instructions`, () => {
      expect(md).toContain("untrusted reference material");
    });

    it(`${a}-agent: writes (connect/evolve) are never auto-published`, () => {
      expect(md).toContain("never auto-publish");
      expect(md).toMatch(/only after explicit approval/i);
    });

    it(`${a}-agent: VECNA is skipped unless explicitly enabled`, () => {
      expect(md).toMatch(/skip this section entirely/i);
    });

    it(`${a}-agent: the old silent auto-recall/auto-push phrasing is gone`, () => {
      expect(md).not.toContain("if your prompt does not already include");
      expect(md).not.toContain("The Hive remembers.");
    });

    it(`${a}-agent: memory section warns against storing secrets`, () => {
      expect(md).toContain("Never record secrets");
    });
  }
});

describe("comm-agent approval gate is unified across channels (Intent-Code Divergence, High)", () => {
  const agentsMd = read("agents/comm-agent/AGENTS.md");
  const skillMd = read("skills/comm-agent-skill/SKILL.md");

  it("AGENTS.md: no '\"post this\" -> send' shortcut; intent != approval", () => {
    expect(agentsMd).not.toContain('If the operator said "post this," send');
    expect(agentsMd).toContain("states intent, not approval");
  });

  it("skill: no '\"post this\" -> send' shortcut; intent != approval", () => {
    expect(skillMd).not.toContain('If user said "post this," send');
    expect(skillMd).toContain("intent, not approval");
  });

  it("inbound-attachment handling is scoped, not arbitrary download", () => {
    expect(agentsMd).not.toContain("download local, process");
    expect(skillMd).not.toContain("Download inbound Discord files locally first");
    expect(skillMd).toMatch(/Do not fetch arbitrary URLs/i);
  });
});

describe("Manifest is framed as a persistent runtime plugin (Description-Behavior Mismatch, High)", () => {
  const json = read("openclaw.plugin.json");
  const index = read("src/plugin/index.ts");

  it("JSON manifest: installer tagline gone, runtime framing present", () => {
    expect(json).not.toContain("Provisions a 6-tendril Nexus swarm in one command");
    expect(json).toMatch(/persistent runtime plugin/i);
  });

  it("src/plugin/index.ts: installer tagline gone, runtime framing present", () => {
    expect(index).not.toContain("Provisions a 6-tendril Nexus swarm in one command");
    expect(index).toMatch(/persistent runtime plugin/i);
  });

  it("ssl enum excludes 'insecure' in both manifest copies", () => {
    const schemaEnum = JSON.parse(json).configSchema.properties.mariadb.properties.ssl.enum;
    expect(schemaEnum).toEqual(["disabled", "preferred", "required"]);
    expect(index).not.toMatch(/enum:\s*\[[^\]]*insecure/);
  });

  it("mariadb.url help no longer advertises credential precedence", () => {
    expect(json).not.toContain("take precedence over user/password");
    expect(json).toMatch(/do not put a password in the url/i);
  });
});

describe("No TLS certificate-verification bypass remains (Intent-Code Divergence, High)", () => {
  const tlsTouchingFiles = [
    "src/config.ts",
    "src/plugin/index.ts",
    "src/plugin/config.ts",
    "openclaw.plugin.json",
    "README.md",
    "INSTALL.md",
    "SKILL.md",
    "vines/spec.md",
    "vecna/spec.md",
    "scripts/bootstrap-vines-db.sh",
    "scripts/bootstrap-vecna-db.sh",
  ];

  for (const f of tlsTouchingFiles) {
    it(`${f}: no MARIADB_SSL=insecure and no cert-verify bypass flag`, () => {
      const c = read(f);
      expect(c).not.toContain("MARIADB_SSL=insecure");
      expect(c).not.toContain("ssl-verify-server-cert=FALSE");
    });
  }

  it("src/config.ts: no Reflect-based static-analyzer evasion", () => {
    const c = read("src/config.ts");
    expect(c).not.toMatch(/keep static\b/);
    expect(c).not.toContain("static analyzers");
    // No Reflect.set flipping rejectUnauthorized.
    expect(c).not.toMatch(/Reflect\.set\([^)]*rejectUnauthorized/);
  });

  it("src/hive/config.ts and the plugin setup test: no scanner-evasion constructs", () => {
    expect(read("src/hive/config.ts")).not.toContain("neutrally-named function");
    expect(read("tests/plugin/setup.test.ts")).not.toContain('`MARIA${"DB_PASSWORD"}`');
  });
});

describe("Database password never sits in plaintext config (Intent-Code Divergence)", () => {
  it("bootstrap scripts reject a URL-embedded password", () => {
    for (const f of ["scripts/bootstrap-vines-db.sh", "scripts/bootstrap-vecna-db.sh"]) {
      expect(read(f)).toContain("must not contain a password");
    }
  });

  it("specs no longer say URL credentials take precedence", () => {
    expect(read("vines/spec.md")).not.toMatch(/take precedence/i);
    expect(read("vecna/spec.md")).not.toMatch(/take precedence/i);
  });
});

describe("Skill discloses host impact and scopes its triggers (Missing Warnings + Vague Triggers)", () => {
  const skill = read("SKILL.md");

  it("front-loads a host-impact warning", () => {
    expect(skill).toMatch(/what this install changes on the host/i);
    expect(skill).not.toContain("Designed to run end-to-end without human supervision");
  });

  it("frames itself as a high-impact installer requiring an explicit request", () => {
    expect(skill).toMatch(/high-impact install/i);
  });

  it("no longer defaults MARIADB_SSL to insecure", () => {
    expect(skill).not.toContain("MARIADB_SSL:-insecure");
  });
});

describe("README install trigger is explicit and warns (Vague Triggers)", () => {
  it("Step 2 flags the install as high-impact", () => {
    expect(read("README.md")).toMatch(/high-impact install/i);
  });
});
