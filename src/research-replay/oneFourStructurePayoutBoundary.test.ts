import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("one-four structure direct entrypoint cannot bypass official payout audit", () => {
  const source = readFileSync("scripts/analyze-one-four-structure.ts", "utf8");
  const auditIndex = source.indexOf("audit-all-bet-types-payout-completeness.ts");
  const gateIndex = source.indexOf("audit !== 0");
  const rawIndex = source.indexOf("analyze-one-four-structure-raw.ts");

  assert.ok(auditIndex >= 0);
  assert.ok(gateIndex > auditIndex);
  assert.ok(rawIndex > gateIndex);
  assert.doesNotMatch(source, /DatabaseSync/);
});

test("one-four structure uses the same forward BUY population covered by the shared payout audit", () => {
  const raw = readFileSync("scripts/analyze-one-four-structure-raw.ts", "utf8");
  const audit = readFileSync("scripts/audit-all-bet-types-payout-completeness.ts", "utf8");

  for (const fragment of [
    "dh.decision='BUY' AND dh.run_kind='historical-backfill'",
    "dh.result IS NOT NULL AND dh.result != ''",
    "dh.current_odds IS NOT NULL",
    "dh.selection='1-2-3'",
    "dh.date >= '${FORWARD_START}'",
  ]) {
    assert.ok(raw.includes(fragment), `raw analyzer missing shared population fragment: ${fragment}`);
    assert.ok(audit.includes(fragment), `audit missing shared population fragment: ${fragment}`);
  }
  assert.match(audit, /rp\.payout_yen IS NOT NULL/);
  assert.match(audit, /rp\.payout_yen > 0/);
});

test("one-four payout audit fails closed on decision bet-type or return-state drift", () => {
  const audit = readFileSync("scripts/audit-all-bet-types-payout-completeness.ts", "utf8");
  const invalidCohort = audit.indexOf("dh.bet_type IS NULL OR dh.bet_type != '3連単' OR dh.returned IS NULL OR dh.returned != 0");
  const failure = audit.indexOf("ALL_BET_TYPES_BUY_COHORT_UNSUPPORTED");
  const population = audit.indexOf("AND dh.bet_type='3連単'");

  assert.ok(invalidCohort >= 0, "audit must detect unsupported decision bet-type/return-state rows");
  assert.ok(failure > invalidCohort, "cohort drift must fail closed before payout coverage is used");
  assert.ok(population > failure, "validated payout population must explicitly remain trifecta after the guard");
  assert.doesNotMatch(audit, /ALL_BET_TYPES_RETURNED_BUY_UNSUPPORTED/);
});

test("npm one-four structure alias points at the guarded normal entrypoint", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
  assert.equal(pkg.scripts?.["analyze:one-four-structure"], "tsx scripts/analyze-one-four-structure.ts");
});
