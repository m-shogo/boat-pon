import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("CLV checkpoint aggregation is scoped by canonical bet type as well as selection", () => {
  const source = readFileSync("scripts/report-clv.ts", "utf8");

  assert.match(source, /SELECT\s+race_id,\s+bet_type,\s+selection,\s+checkpoint_label/s);
  assert.match(source, /PARTITION BY race_id, bet_type, selection, checkpoint_label/);
  assert.match(source, /GROUP BY race_id, bet_type, selection/);
  assert.match(source, /p\.bet_type = \$\{payoutBetTypeSql\("dh\.bet_type"\)\}/);
});
