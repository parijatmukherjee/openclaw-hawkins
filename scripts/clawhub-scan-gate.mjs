#!/usr/bin/env node
/**
 * clawhub-scan-gate — fail when a published version's ClawHub scan contains a
 * finding that is NOT in the accepted baseline (a regression).
 *
 * ClawHub's heavy scanners (VirusTotal, skillspector, clawscan) run server-side
 * on a *published* version, so this is a post-publish / scheduled gate — it
 * cannot block the publish itself, but it surfaces regressions as a failed check
 * (and the workflow opens an issue). It deliberately does NOT require a "clean"
 * verdict: the standing "suspicious" verdict comes from accepted items recorded
 * in clawhub-baseline.json (false-positive secret literals + installer-scope
 * judgments). See that file for the rationale.
 *
 * Usage:
 *   node scripts/clawhub-scan-gate.mjs --version 2.0.1
 *   node scripts/clawhub-scan-gate.mjs --version 2.0.1 --update      # rewrite baseline from this scan
 *   node scripts/clawhub-scan-gate.mjs --report-dir ./some-report    # evaluate an already-extracted report
 *
 * Auth: the ClawHub CLI must be authenticated (the workflow writes a 0600
 * config and exports CLAWHUB_CONFIG_PATH). Requires `clawhub` + `unzip` on PATH
 * unless --report-dir is given.
 *
 * Exit codes: 0 = no regression, 1 = regression (new findings), 2 = usage/error.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "openclaw-hawkins";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BASELINE = join(REPO_ROOT, "clawhub-baseline.json");

/** Strip a leading "suspicious."/"warning." severity prefix from a reason code. */
function shortReason(code) {
  return String(code).replace(/^[a-z]+\./, "");
}

/**
 * Normalize the three machine-readable report files into a stable set of
 * finding keys plus the clawscan "unexpected" count. Pure — unit-tested.
 *
 * @param {{skillspector?:object, staticAnalysis?:object, clawscan?:object}} report
 * @returns {{keys: string[], clawscanUnexpected: number}}
 */
export function normalizeFindings(report) {
  const keys = new Set();

  for (const issue of report.skillspector?.issues ?? []) {
    if (issue?.issueId && issue?.file) {
      keys.add(`skillspector/${issue.issueId}/${issue.file}`);
    }
  }

  const reasons = report.staticAnalysis?.reasonCodes ?? [];
  const primaryReason = reasons.length ? shortReason(reasons[0]) : "finding";
  for (const f of report.staticAnalysis?.findings ?? []) {
    if (f?.file) keys.add(`static/${primaryReason}/${f.file}`);
  }

  // clawscan "findings" may be a list of objects/strings or a single string
  // blob; count the entries marked "unexpected".
  let clawscanUnexpected = 0;
  const cf = report.clawscan?.findings;
  if (Array.isArray(cf)) {
    for (const item of cf) {
      const text = typeof item === "string" ? item : (item?.status ?? "") + " " + (item?.text ?? "");
      if (/\bunexpected\b/i.test(text)) clawscanUnexpected += 1;
    }
  } else if (typeof cf === "string") {
    clawscanUnexpected = (cf.match(/\bunexpected\b/gi) ?? []).length;
  }

  return { keys: [...keys].sort(), clawscanUnexpected };
}

/**
 * Compare normalized findings against a baseline.
 * @returns {{regressed: boolean, newFindings: string[], clawscanUnexpected: number, clawscanMax: number}}
 */
export function evaluate(report, baseline) {
  const { keys, clawscanUnexpected } = normalizeFindings(report);
  const accepted = new Set(baseline.acceptedFindings ?? []);
  const newFindings = keys.filter((k) => !accepted.has(k));
  const clawscanMax = baseline.clawscanUnexpectedMax ?? 0;
  const regressed = newFindings.length > 0 || clawscanUnexpected > clawscanMax;
  return { regressed, newFindings, clawscanUnexpected, clawscanMax, currentKeys: keys };
}

function readJsonIfExists(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
}

/** Load the three report JSON files from an extracted report directory. */
export function loadReportFromDir(dir) {
  return {
    skillspector: readJsonIfExists(join(dir, "skillspector.json")),
    staticAnalysis: readJsonIfExists(join(dir, "static-analysis.json")),
    clawscan: readJsonIfExists(join(dir, "clawscan.json")),
  };
}

/** Download + extract the stored scan report for a published version. */
function downloadReport(version) {
  const work = mkdtempSync(join(tmpdir(), "clawhub-scan-"));
  const zip = join(work, "report.zip");
  execFileSync(
    "clawhub",
    ["scan", "download", PACKAGE_NAME, "--version", version, "--kind", "plugin", "-o", zip],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  execFileSync("unzip", ["-o", "-q", zip, "-d", work], { stdio: "inherit" });
  return work;
}

function parseArgs(argv) {
  const args = { baseline: DEFAULT_BASELINE };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--version") args.version = argv[++i];
    else if (a === "--baseline") args.baseline = argv[++i];
    else if (a === "--report-dir") args.reportDir = argv[++i];
    else if (a === "--update") args.update = true;
    else {
      process.stderr.write(`Unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.reportDir && !args.version) {
    process.stderr.write("error: --version <v> (or --report-dir <dir>) is required\n");
    process.exit(2);
  }

  let dir = args.reportDir;
  let cleanup;
  if (!dir) {
    dir = downloadReport(args.version);
    cleanup = dir;
  }

  const report = loadReportFromDir(dir);
  const baseline = JSON.parse(readFileSync(args.baseline, "utf8"));
  const result = evaluate(report, baseline);

  if (args.update) {
    const updated = {
      ...baseline,
      clawscanUnexpectedMax: result.clawscanUnexpected,
      acceptedFindings: result.currentKeys,
    };
    writeFileSync(args.baseline, JSON.stringify(updated, null, 2) + "\n");
    process.stdout.write(
      `Baseline updated: ${result.currentKeys.length} accepted findings, ` +
        `clawscanUnexpectedMax=${result.clawscanUnexpected}\n`,
    );
    if (cleanup) rmSync(cleanup, { recursive: true, force: true });
    return;
  }

  process.stdout.write(
    `ClawHub scan gate — ${result.currentKeys.length} findings, ` +
      `clawscan unexpected ${result.clawscanUnexpected}/${result.clawscanMax} allowed\n`,
  );
  if (result.regressed) {
    process.stdout.write("\n✗ REGRESSION — findings not in the accepted baseline:\n");
    for (const k of result.newFindings) process.stdout.write(`    + ${k}\n`);
    if (result.clawscanUnexpected > result.clawscanMax) {
      process.stdout.write(
        `    + clawscan 'unexpected' count ${result.clawscanUnexpected} > ${result.clawscanMax}\n`,
      );
    }
    process.stdout.write(
      "\nReview the new finding(s). If accepted, add to clawhub-baseline.json " +
        "(or run with --update).\n",
    );
    if (cleanup) rmSync(cleanup, { recursive: true, force: true });
    process.exit(1);
  }

  process.stdout.write("✓ No regression — all findings are within the accepted baseline.\n");
  if (cleanup) rmSync(cleanup, { recursive: true, force: true });
}

// Run main() only when invoked directly (not when imported by tests).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
