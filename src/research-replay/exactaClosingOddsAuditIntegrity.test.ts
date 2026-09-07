import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/audit-exacta-closing-odds-availability.ts", "utf8");

test("exacta closing odds audit uses canonical read-only database identity", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile/u);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/u);
  assert.match(source, /PRAGMA query_only\s*=\s*ON/u);
});

test("exacta closing odds audit excludes returned historical BUY rows", () => {
  const returnedGuards = source.match(/dh\.returned=0/g) ?? [];
  assert.ok(returnedGuards.length >= 3, "candidate and settlement cohorts must all exclude returned rows");
});

test("exacta closing odds audit fails closed on ambiguous official exacta settlements", () => {
  assert.match(source, /GROUP BY rp\.race_id, rp\.combination/u);
  assert.match(source, /HAVING COUNT\(\*\) != 1 OR valid_count != 1/u);
  assert.match(source, /EXACTA_CLOSING_ODDS_AUDIT_SETTLEMENT_INTEGRITY_INVALID/u);
  assert.match(source, /EXACTA_CLOSING_ODDS_AUDIT_SETTLEMENT_MISSING/u);
});

test("exacta closing odds audit only validates positive non-refund payouts", () => {
  assert.match(source, /returned=0 AND payout_yen>0/u);
  assert.match(source, /ORDER BY combination[\s\S]*LIMIT 1/u);
  assert.doesNotMatch(
    source,
    /WHERE race_id=\? AND bet_type='exacta' LIMIT 1/u,
    "legacy arbitrary payout lookup must not return",
  );
});
