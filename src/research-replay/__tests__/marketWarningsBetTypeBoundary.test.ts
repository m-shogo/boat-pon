import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("market warnings fail close unsupported bet types and scope checkpoints by canonical bet type", () => {
  const source = readFileSync("scripts/report-market-warnings.ts", "utf8");

  assert.match(source, /assertSupportedBetTypeMapping\(\)/);
  assert.match(source, /MARKET_WARNINGS_BET_TYPE_MAPPING_FAILED/);
  assert.match(source, /PARTITION BY race_id, bet_type, selection, checkpoint_label/);
  assert.match(source, /GROUP BY race_id, bet_type, selection/);
  assert.match(source, /p\.bet_type = \$\{canonicalBetTypeSql\("dh\.bet_type"\)\}/);
});
