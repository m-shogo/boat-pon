import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildBuyOutcomeSettlementSource } from "./buyOutcomeSettlementSource";

const patternSource = readFileSync(new URL("../../scripts/analyze-buy-outcome-patterns.ts", import.meta.url), "utf8");
const summarySource = readFileSync(new URL("../../scripts/report-buy-learning-summary.ts", import.meta.url), "utf8");

test("BUY outcome learning uses realized settlement economics instead of decision-time odds", () => {
  for (const source of [patternSource, summarySource]) {
    assert.match(source, /outcome_payout_yen IS NOT NULL/);
    assert.match(source, /outcome_payout_yen \/ 100\.0/);
    assert.doesNotMatch(source, /THEN current_odds ELSE 0/);
  }
});

test("Current BUY paper-live settlement uses official race_results with latest-issued-BUY dedupe", () => {
  const source = buildBuyOutcomeSettlementSource({
    runKind: "paper-live",
    from: "2026-08-01",
    to: "2026-08-15",
    modelVersion: "v1",
  });
  assert.equal(source.usesOfficialRaceResults, true);
  assert.match(source.cte, /LEFT JOIN race_results rr ON rr\.race_id = dh\.race_id/);
  assert.match(source.cte, /rr\.trifecta AS outcome_result/);
  assert.match(source.cte, /rr\.payout_yen AS outcome_payout_yen/);
  assert.match(source.cte, /PARTITION BY dh\.race_id, dh\.bet_type, dh\.selection/);
  assert.match(source.cte, /dh\.bet_type IN \('trifecta', '3連単'\)/);
  assert.deepEqual(source.params, ["2026-08-01", "2026-08-15", "v1"]);
});

test("non-paper-live analysis preserves decision_history settlement instead of borrowing live results", () => {
  const source = buildBuyOutcomeSettlementSource({ runKind: "historical-backfill" });
  assert.equal(source.usesOfficialRaceResults, false);
  assert.doesNotMatch(source.cte, /JOIN race_results/);
  assert.match(source.cte, /dh\.result AS outcome_result/);
  assert.match(source.cte, /dh\.payout_yen AS outcome_payout_yen/);
  assert.deepEqual(source.params, ["historical-backfill"]);
});

test("BUY outcome learning scripts expose an explicit run-kind boundary and fail closed on live result conflict", () => {
  assert.match(patternSource, /--run-kind/);
  assert.match(summarySource, /--run-kind/);
  for (const source of [patternSource, summarySource]) {
    assert.match(source, /decision_result != outcome_result/);
    assert.match(source, /paper-live settlement result conflicts with official race_results/);
  }
});
