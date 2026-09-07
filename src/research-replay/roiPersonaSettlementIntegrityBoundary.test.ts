import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/roi-pro-persona-review.ts", "utf8");

test("ROI persona review fails closed on ambiguous all-feature settlements before consuming or generating the report", () => {
  assert.match(source, /const SETTLEMENT_GATE = "scripts\/assert-roi-all-feature-settlement-integrity\.ts";/);
  assert.match(source, /function assertAllFeatureSettlementIntegrity\(\)/);
  assert.match(source, /execFileSync\("pnpm", \["tsx", SETTLEMENT_GATE\], \{ stdio: "inherit" \}\)/);

  const metricGate = source.indexOf("assertRealizedPayoutMetricBasis();");
  const settlementGate = source.indexOf("assertAllFeatureSettlementIntegrity();");
  const generate = source.indexOf("if (!existsSync(ALL_FEATURE_JSON))");
  const readReport = source.indexOf("JSON.parse(readFileSync(ALL_FEATURE_JSON");

  assert.ok(metricGate >= 0, "metric-basis gate must exist");
  assert.ok(settlementGate > metricGate, "settlement gate must run after source metric-basis validation");
  assert.ok(generate > settlementGate, "settlement gate must run before all-feature report generation");
  assert.ok(readReport > settlementGate, "settlement gate must run before an existing report can drive persona verdicts");
});
