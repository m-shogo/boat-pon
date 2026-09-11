import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-wind24-exh1-switch-deep-dive.ts", "utf8");

test("wind24 rejects unsafe pre-existing report paths before legacy analysis writes", () => {
  const dbVerify = entrypoint.indexOf('"WIND24_SWITCH_PRIMARY_DB_IDENTITY_INVALID"');
  const reportVerify = entrypoint.indexOf('"WIND24_SWITCH_PREEXISTING_REPORT_IDENTITY_INVALID"');
  const analysis = entrypoint.indexOf('run("scripts/analyze-wind24-exh1-switch-deep-dive-internal.ts"');

  assert.ok(reportVerify > dbVerify, "report-path identity preflight must follow verified DB handoff");
  assert.ok(analysis > reportVerify, "legacy analysis must not write before an existing report path is verified");
  assert.match(entrypoint, /if \(existsSync\(OUT_MD\)\)/u);
});
