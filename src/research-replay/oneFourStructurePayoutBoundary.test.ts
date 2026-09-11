import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("one-four structure direct entrypoint cannot bypass official payout audit", () => {
  const source = readFileSync("scripts/analyze-one-four-structure.ts", "utf8");
  const auditIndex = source.indexOf("audit-all-bet-types-payout-completeness.ts");
  const gateIndex = source.indexOf("audit !== 0");
  const handoffIndex = source.indexOf("ONE_FOUR_STRUCTURE_DB_HANDOFF_IDENTITY_INVALID");
  const internalIndex = source.indexOf('await import("./analyze-one-four-structure-internal")');

  assert.ok(auditIndex >= 0);
  assert.ok(gateIndex > auditIndex);
  assert.ok(handoffIndex > gateIndex);
  assert.ok(internalIndex > handoffIndex);
  assert.doesNotMatch(source, /analyze-one-four-structure-raw/);
  assert.doesNotMatch(source, /DatabaseSync/);
});

test("one-four structure raw compatibility module rejects direct CLI execution and routes imports through canonical audit", () => {
  const raw = readFileSync("scripts/analyze-one-four-structure-raw.ts", "utf8");
  const directGuard = raw.indexOf("invokedPath === rawEntrypointPath");
  const failure = raw.indexOf("ONE_FOUR_STRUCTURE_RAW_DIRECT_EXECUTION_FORBIDDEN");
  const canonical = raw.indexOf('await import("./analyze-one-four-structure")');

  assert.ok(directGuard >= 0, "raw compatibility module must detect direct CLI execution");
  assert.ok(failure > directGuard, "direct execution must fail closed at the guard");
  assert.ok(canonical > failure, "canonical audit entrypoint may load only after the direct-execution guard");
  assert.doesNotMatch(raw, /analyze-one-four-structure-internal/);
});

test("one-four structure uses the same forward BUY population covered by the shared payout audit", () => {
  const internal = readFileSync("scripts/analyze-one-four-structure-internal.ts", "utf8");
  const audit = readFileSync("scripts/audit-all-bet-types-payout-completeness.ts", "utf8");

  for (const fragment of [
    "dh.decision='BUY' AND dh.run_kind='historical-backfill'",
    "dh.result IS NOT NULL AND dh.result != ''",
    "dh.current_odds IS NOT NULL",
    "dh.selection='1-2-3'",
    "dh.date >= '${FORWARD_START}'",
  ]) {
    assert.ok(internal.includes(fragment), `internal analyzer missing shared population fragment: ${fragment}`);
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
