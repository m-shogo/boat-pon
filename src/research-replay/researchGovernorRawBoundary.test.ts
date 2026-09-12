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

test("research governor enters the internal report only after canonical readiness, staged inputs, and child-launch DB revalidation", () => {
  const preflight = entry.indexOf('run("scripts/audit-research-governor-readiness.ts")');
  const handoff = entry.indexOf("RESEARCH_GOVERNOR_DB_HANDOFF_IDENTITY_INVALID");
  const hypothesisMissing = entry.indexOf("RESEARCH_GOVERNOR_HYPOTHESIS_REGISTRY_MISSING");
  const hypothesisIdentity = entry.indexOf("RESEARCH_GOVERNOR_HYPOTHESIS_REGISTRY_IDENTITY_INVALID");
  const reportInputIdentity = entry.indexOf("RESEARCH_GOVERNOR_REPORT_INPUT_IDENTITY_INVALID");
  const workspace = entry.indexOf("boat-pon-research-governor-");
  const stagedHypothesis = entry.indexOf("RESEARCH_GOVERNOR_HYPOTHESIS_REGISTRY_STAGE_IDENTITY_INVALID");
  const stagedReports = entry.indexOf("RESEARCH_GOVERNOR_REPORT_INPUT_STAGE_IDENTITY_INVALID");
  const childLaunchDb = entry.indexOf("RESEARCH_GOVERNOR_DB_CHILD_LAUNCH_IDENTITY_INVALID");
  const childSpawn = entry.indexOf('spawnSync(process.execPath, ["--import", tsxLoader, internalPath]');
  const outputMdIdentity = entry.indexOf("RESEARCH_GOVERNOR_MD_OUTPUT_IDENTITY_INVALID");
  const outputJsonIdentity = entry.indexOf("RESEARCH_GOVERNOR_JSON_OUTPUT_IDENTITY_INVALID");
  const publishMdDestination = entry.indexOf("RESEARCH_GOVERNOR_MD_PUBLISH_DESTINATION_IDENTITY_INVALID");
  const publishJsonDestination = entry.indexOf("RESEARCH_GOVERNOR_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID");

  assert.ok(preflight >= 0);
  assert.ok(handoff > preflight);
  assert.ok(hypothesisMissing > handoff);
  assert.ok(hypothesisIdentity > hypothesisMissing);
  assert.ok(reportInputIdentity > hypothesisIdentity);
  assert.ok(workspace > reportInputIdentity);
  assert.ok(stagedHypothesis > workspace);
  assert.ok(stagedReports > stagedHypothesis);
  assert.ok(childLaunchDb > stagedReports);
  assert.ok(childSpawn > childLaunchDb);
  assert.ok(outputMdIdentity > childSpawn);
  assert.ok(outputJsonIdentity > outputMdIdentity);
  assert.ok(publishMdDestination > outputJsonIdentity);
  assert.ok(publishJsonDestination > publishMdDestination);

  assert.match(entry, /HYPOTHESIS_PATH = "data\/research-hypotheses\.json"/);
  assert.match(entry, /for \(const reportPath of REPORT_INPUT_PATHS\)/);
  assert.match(entry, /if \(!existsSync\(reportPath\)\) continue/);
  assert.match(entry, /assertCanonicalSingleLinkRegularFile/);
  assert.match(entry, /cwd: workspace/);
  assert.match(entry, /BOAT_PON_DB_PATH: launchDbPath/);
  assert.doesNotMatch(entry, /await import\("\.\/report-research-governor-internal"\)/);
  assert.equal(entry.includes("report-research-governor-raw"), false);
});

test("research governor stages canonical inputs and publishes isolated outputs atomically", () => {
  assert.match(entry, /stageVerifiedInput\(\s*HYPOTHESIS_PATH,\s*workspace,/s);
  assert.match(entry, /stageVerifiedInput\(\s*reportPath,\s*workspace,/s);
  assert.match(entry, /openSync\(tempPath, "wx", 0o600\)/);
  assert.match(entry, /fsyncSync\(fd\)/);
  assert.match(entry, /if \(existsSync\(path\)\) \{\s*assertCanonicalSingleLinkRegularFile\(path, destinationErrorCode\);\s*\}/s);
  assert.match(entry, /renameSync\(verifiedTempPath, path\)/);
  assert.match(entry, /split\(launchDbPath\)\s*\.join\("verified read-only research DB"\)/);
  assert.match(entry, /rmSync\(workspace, \{ recursive: true, force: true \}\)/);
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
