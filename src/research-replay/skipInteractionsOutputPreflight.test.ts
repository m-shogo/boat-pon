import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-roi-skip-interactions.ts", "utf-8");

test("skip-interactions rejects unsafe pre-existing report paths before core writes", () => {
  const dbHandoff = entrypoint.indexOf("process.env.BOAT_PON_DB_PATH = verifiedDbPath");
  const reportPreflight = entrypoint.indexOf("ROI_SKIP_INTERACTIONS_PREEXISTING_REPORT_IDENTITY_INVALID");
  const analysis = entrypoint.indexOf('await import("./analyze-roi-skip-interactions-core")');

  assert.ok(dbHandoff >= 0);
  assert.ok(reportPreflight > dbHandoff, "report identity must be checked after verified DB handoff");
  assert.ok(analysis > reportPreflight, "core analyzer must not write before an existing report path is verified");
  assert.match(entrypoint, /if \(existsSync\(OUT_MD\)\)/u);
});
