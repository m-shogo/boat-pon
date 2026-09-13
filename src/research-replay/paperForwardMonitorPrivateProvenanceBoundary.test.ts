import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypointSource = readFileSync("scripts/report-paper-forward-monitor.ts", "utf-8");

test("paper-forward monitor keeps internal outputs isolated and rejects private DB provenance before publication", () => {
  const preflight = entrypointSource.indexOf('run("scripts/audit-paper-forward-monitor-payout-completeness.ts")');
  const handoffIdentity = entrypointSource.indexOf("PAPER_FORWARD_MONITOR_DB_HANDOFF_IDENTITY_INVALID");
  const isolated = entrypointSource.indexOf("runIsolated(workspace, handoffDbPath)");
  const readStaged = entrypointSource.indexOf("readStagedOutputs(workspace, handoffDbPath)", isolated);
  const firstPublish = entrypointSource.indexOf("atomicPublish(", readStaged);

  assert.ok(preflight >= 0);
  assert.ok(handoffIdentity > preflight, "DB identity must be verified after payout completeness preflight");
  assert.ok(isolated > handoffIdentity, "internal report must run only after verified DB handoff");
  assert.ok(readStaged > isolated, "staged outputs must be validated after isolated analysis");
  assert.ok(firstPublish > readStaged, "canonical publication must follow staged output validation");
  assert.match(entrypointSource, /mkdtempSync\(join\(tmpdir\(\), "boat-pon-paper-forward-monitor-"\)\)/u);
  assert.match(entrypointSource, /cwd: workspace/u);
  assert.match(entrypointSource, /PAPER_FORWARD_MONITOR_DB_CHILD_LAUNCH_IDENTITY_INVALID/u);
  assert.match(entrypointSource, /PAPER_FORWARD_MONITOR_PRIVATE_DB_PATH_REMAINS/u);
  assert.match(entrypointSource, /PAPER_FORWARD_MONITOR_DB_PROVENANCE_UNEXPECTED/u);
  assert.doesNotMatch(entrypointSource, /sanitizeDbProvenance/u);
});

test("paper-forward monitor validates staged Markdown and JSON identity and shape before canonical writes", () => {
  const mdIdentity = entrypointSource.indexOf('"PAPER_FORWARD_MONITOR_REPORT_IDENTITY_INVALID"');
  const jsonIdentity = entrypointSource.indexOf('"PAPER_FORWARD_MONITOR_JSON_IDENTITY_INVALID"');
  const mdRead = entrypointSource.indexOf('readFileSync(verifiedMdPath, "utf-8")');
  const jsonRead = entrypointSource.indexOf('readFileSync(verifiedJsonPath, "utf-8")');
  const jsonParse = entrypointSource.indexOf("JSON.parse(json)");
  const mdHandoff = entrypointSource.indexOf('"PAPER_FORWARD_MONITOR_REPORT_HANDOFF_IDENTITY_INVALID"');
  const jsonHandoff = entrypointSource.indexOf('"PAPER_FORWARD_MONITOR_JSON_HANDOFF_IDENTITY_INVALID"');

  assert.ok(mdIdentity >= 0 && jsonIdentity > mdIdentity);
  assert.ok(mdRead > jsonIdentity && jsonRead > mdRead && jsonParse > jsonRead);
  assert.ok(mdHandoff > jsonParse && jsonHandoff > mdHandoff);
  assert.match(entrypointSource, /PAPER_FORWARD_MONITOR_JSON_MISSING_AFTER_INTERNAL_SUCCESS/u);
  assert.match(entrypointSource, /PAPER_FORWARD_MONITOR_JSON_INVALID/u);
});

test("paper-forward monitor preflights both canonical destinations before the first replacement", () => {
  const isolated = entrypointSource.indexOf("runIsolated(workspace, handoffDbPath)");
  const reportsIdentity = entrypointSource.indexOf(
    'assertCanonicalDirectory("reports", "PAPER_FORWARD_MONITOR_REPORTS_DIRECTORY_IDENTITY_INVALID")',
    isolated,
  );
  const completePreflight = entrypointSource.indexOf("verifyExistingOutputs();", reportsIdentity);
  const firstPublish = entrypointSource.indexOf("atomicPublish(", completePreflight);

  assert.ok(reportsIdentity > isolated);
  assert.ok(completePreflight > reportsIdentity);
  assert.ok(firstPublish > completePreflight);
  assert.match(entrypointSource, /if \(existsSync\(OUT_MD\)\)/u);
  assert.match(entrypointSource, /if \(existsSync\(OUT_JSON\)\)/u);
  assert.match(entrypointSource, /PAPER_FORWARD_MONITOR_PREEXISTING_JSON_IDENTITY_INVALID/u);
});

test("paper-forward monitor atomically publishes each verified artifact with parent handoff validation", () => {
  const helper = entrypointSource.indexOf("function atomicPublish(");
  const parentInitial = entrypointSource.indexOf("PAPER_FORWARD_MONITOR_PUBLISH_PARENT_IDENTITY_INVALID", helper);
  const exclusiveOpen = entrypointSource.indexOf('openSync(tempPath, "wx", 0o600)', helper);
  const fsync = entrypointSource.indexOf("fsyncSync(fd)", helper);
  const destinationIdentity = entrypointSource.indexOf("destinationCode", exclusiveOpen);
  const parentHandoff = entrypointSource.indexOf("PAPER_FORWARD_MONITOR_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", helper);
  const rename = entrypointSource.indexOf("renameSync(verifiedTempPath, path)", helper);

  assert.ok(helper >= 0);
  assert.ok(parentInitial > helper && exclusiveOpen > parentInitial && fsync > exclusiveOpen);
  assert.ok(destinationIdentity > fsync && parentHandoff > destinationIdentity && rename > parentHandoff);
  assert.match(entrypointSource, /PAPER_FORWARD_MONITOR_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(entrypointSource, /PAPER_FORWARD_MONITOR_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
});
