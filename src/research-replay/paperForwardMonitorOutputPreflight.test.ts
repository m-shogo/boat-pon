import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/report-paper-forward-monitor.ts", "utf8");

test("paper-forward monitor rejects unsafe pre-existing report paths before legacy report writes", () => {
  const dbVerify = entrypoint.indexOf('"PAPER_FORWARD_MONITOR_DB_HANDOFF_IDENTITY_INVALID"');
  const reportVerify = entrypoint.indexOf('"PAPER_FORWARD_MONITOR_PREEXISTING_REPORT_IDENTITY_INVALID"');
  const report = entrypoint.indexOf('run("scripts/report-paper-forward-monitor-internal.ts"');

  assert.ok(reportVerify > dbVerify, "report-path identity preflight must follow verified DB handoff");
  assert.ok(report > reportVerify, "legacy report must not write before an existing report path is verified");
  assert.match(entrypoint, /if \(existsSync\(OUT_MD\)\)/u);
});
