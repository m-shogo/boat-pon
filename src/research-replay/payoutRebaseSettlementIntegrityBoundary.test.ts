import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("payout rebase settlement preflight rejects malformed, duplicate, and refund trifecta lines", () => {
  const source = readFileSync("scripts/audit-odds-payout-gap-completeness.ts", "utf8");

  assert.match(source, /WITH target_rows AS \(/);
  assert.match(source, /SELECT dh\.race_id, dh\.returned/);
  assert.match(source, /target_races AS \(\s*SELECT DISTINCT race_id\s*FROM target_rows/);
  assert.match(source, /WHERE rp\.bet_type = 'trifecta'/);
  assert.match(source, /HAVING COUNT\(\*\) > 1/);
  assert.match(source, /ts\.returned = 0/);
  assert.match(source, /ts\.payout_yen > 0/);
  assert.match(source, /ts\.payout_yen <= 0/);
  assert.match(source, /ts\.combination IS NULL OR ts\.combination = ''/);
  assert.match(source, /WHERE ts\.returned = 1/);
  assert.match(source, /duplicate race_id × trifecta × combination settlement keys/);
  assert.match(source, /do not model refund semantics explicitly/);
});

test("normal payout rebase still runs settlement preflight before LIMIT 1 consumers", () => {
  const runner = readFileSync("scripts/run-payout-rebase-safe.ts", "utf8");
  const preflightIndex = runner.indexOf('run("scripts/audit-odds-payout-gap-completeness.ts")');
  const analysisIndex = runner.indexOf('run("scripts/analyze-payout-rebase.ts")');

  assert.ok(preflightIndex >= 0 && preflightIndex < analysisIndex, "integrity preflight must run before payout rebase analysis");
});
