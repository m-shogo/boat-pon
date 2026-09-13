import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/report-paper-forward-monitor.ts", "utf8");

test("paper-forward monitor preflights both canonical destinations before isolated analysis and publication", () => {
  const dbVerify = entrypoint.indexOf('"PAPER_FORWARD_MONITOR_DB_HANDOFF_IDENTITY_INVALID"');
  const outputPreflight = entrypoint.indexOf("verifyExistingOutputs();", dbVerify);
  const isolated = entrypoint.indexOf("runIsolated(workspace, handoffDbPath)");
  const reportsIdentity = entrypoint.indexOf('"PAPER_FORWARD_MONITOR_REPORTS_DIRECTORY_IDENTITY_INVALID"', isolated);
  const publishPreflight = entrypoint.indexOf("verifyExistingOutputs();", reportsIdentity);
  const firstPublish = entrypoint.indexOf("atomicPublish(", publishPreflight);

  assert.ok(outputPreflight > dbVerify, "canonical output identity preflight must follow verified DB handoff");
  assert.ok(isolated > outputPreflight, "isolated analysis must not start before existing canonical outputs are verified");
  assert.ok(reportsIdentity > isolated, "canonical reports directory must be verified after staged analysis");
  assert.ok(publishPreflight > reportsIdentity, "both destinations must be revalidated immediately before publication");
  assert.ok(firstPublish > publishPreflight, "canonical publication must not begin before complete destination-set preflight");
  assert.match(entrypoint, /if \(existsSync\(OUT_MD\)\)/u);
  assert.match(entrypoint, /if \(existsSync\(OUT_JSON\)\)/u);
  assert.doesNotMatch(entrypoint, /run\("scripts\/report-paper-forward-monitor-internal\.ts"/u);
});
