import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-odds-payout-gap-raw.ts", "utf-8");

test("odds-payout gap raw analyzer verifies the primary DB before opening SQLite", () => {
  const verify = source.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(verify >= 0, "primary DB identity guard must exist");
  assert.ok(open > verify, "SQLite must open only after canonical identity verification");
  assert.match(source, /PRAGMA query_only = ON/);
});

test("odds-payout gap raw analyzer fails closed before ROI or verdict generation when settlement coverage is incomplete", () => {
  const coverage = source.indexOf("const coverageRow = db.prepare");
  const evaluate = source.indexOf("evaluatePaperForwardPayoutCompleteness(");
  const failClosed = source.indexOf("FAIL CLOSED: official trifecta settlement coverage is incomplete");
  const analysisStart = source.indexOf('console.log("[odds-payout-gap] 分析開始...")');
  const firstVerdict = source.indexOf('if (pr >= 100) verdict = "実払戻でも有望"');

  assert.ok(coverage >= 0, "settlement coverage query must exist");
  assert.ok(evaluate > coverage, "coverage must be evaluated after it is queried");
  assert.ok(failClosed > evaluate, "incomplete coverage must have an explicit fail-closed path");
  assert.ok(analysisStart > failClosed, "analysis must not start before completeness is accepted");
  assert.ok(firstVerdict > failClosed, "verdict logic must remain downstream of completeness gating");
  assert.match(source, /process\.exit\(2\)/);
});

test("odds-payout gap raw completeness population remains aligned with the analyzer base population", () => {
  const baseWhere = source.indexOf("const BASE_WHERE = `");
  const coverageWhere = source.indexOf("WHERE ${BASE_WHERE}");
  assert.ok(baseWhere >= 0);
  assert.ok(coverageWhere > baseWhere, "preflight must reuse BASE_WHERE rather than a divergent population");
});
