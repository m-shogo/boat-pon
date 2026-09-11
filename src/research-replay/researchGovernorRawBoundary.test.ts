import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entry = readFileSync("scripts/report-research-governor.ts", "utf8");
const raw = readFileSync("scripts/report-research-governor-raw.ts", "utf8");
const internal = readFileSync("scripts/report-research-governor-internal.ts", "utf8");

function reportPathsFromBlock(source: string, startMarker: string, endMarker: string): string[] {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing block start: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `missing block end: ${endMarker}`);
  return [...source.slice(start, end).matchAll(/"(reports\/[^"\n]+\.json)"/g)]
    .map((match) => match[1])
    .sort();
}

test("research governor enters the internal report only after canonical readiness, DB handoff, registry, and report-input checks", () => {
  const preflight = entry.indexOf('run("scripts/audit-research-governor-readiness.ts")');
  const handoff = entry.indexOf("RESEARCH_GOVERNOR_DB_HANDOFF_IDENTITY_INVALID");
  const envHandoff = entry.indexOf("process.env.BOAT_PON_DB_PATH = handoffDbPath");
  const hypothesisMissing = entry.indexOf("RESEARCH_GOVERNOR_HYPOTHESIS_REGISTRY_MISSING");
  const hypothesisIdentity = entry.indexOf("RESEARCH_GOVERNOR_HYPOTHESIS_REGISTRY_IDENTITY_INVALID");
  const reportInputs = entry.indexOf("REPORT_INPUT_PATHS");
  const reportInputIdentity = entry.indexOf("RESEARCH_GOVERNOR_REPORT_INPUT_IDENTITY_INVALID");
  const internalImport = entry.indexOf('await import("./report-research-governor-internal")');

  assert.ok(preflight >= 0);
  assert.ok(handoff > preflight);
  assert.ok(envHandoff > handoff);
  assert.ok(hypothesisMissing > envHandoff);
  assert.ok(hypothesisIdentity > hypothesisMissing);
  assert.ok(reportInputs >= 0);
  assert.ok(reportInputIdentity > hypothesisIdentity);
  assert.ok(internalImport > reportInputIdentity);
  assert.match(entry, /HYPOTHESIS_PATH = "data\/research-hypotheses\.json"/);
  assert.match(entry, /for \(const reportPath of REPORT_INPUT_PATHS\)/);
  assert.match(entry, /if \(!existsSync\(reportPath\)\) continue/);
  assert.match(entry, /assertCanonicalSingleLinkRegularFile/);
  assert.equal(entry.includes("report-research-governor-raw"), false);
  assert.equal(entry.includes('run("scripts/report-research-governor-internal.ts"'), false);
});

test("research governor identity gate mirrors every internal report-file input", () => {
  const guardedPaths = reportPathsFromBlock(entry, "const REPORT_INPUT_PATHS = [", "] as const;");
  const internalPaths = reportPathsFromBlock(internal, "const REPORT_FILES = {", "};");
  assert.deepEqual(guardedPaths, internalPaths);
});

test("research governor raw compatibility module forbids direct CLI execution and cannot bypass canonical preflight", () => {
  assert.match(raw, /RESEARCH_GOVERNOR_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/report-research-governor"\)/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(raw, /assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(raw, /report-research-governor-internal/);
  assert.doesNotMatch(raw, /DatabaseSync/);
});
