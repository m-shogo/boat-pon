import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-all-bet-types-roi.ts", "utf8");

test("all-bet-types ROI revalidates DB identity after payout preflight before raw analysis", () => {
  const preflight = source.indexOf('run("scripts/audit-all-bet-types-payout-completeness.ts")');
  const handoff = source.indexOf("ALL_BET_TYPES_ROI_DB_HANDOFF_IDENTITY_INVALID");
  const raw = source.indexOf('await import("./analyze-all-bet-types-roi-raw")');

  assert.ok(preflight >= 0);
  assert.ok(handoff > preflight, "DB identity must be revalidated after payout completeness preflight");
  assert.ok(raw > handoff, "raw analysis must load only after the verified DB handoff");
  assert.match(source, /process\.env\.BOAT_PON_DB_PATH = handoffDbPath/);
});
