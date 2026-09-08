import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const source = readFileSync("scripts/analyze-roi-improvement-validation.ts", "utf8");

test("ROI improvement validation verifies canonical read-only DB identity before analysis", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);

  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile");
  const returnIntegrity = source.indexOf("const invalidReturnedBuy = db.prepare");
  const integrity = source.indexOf("const settlementIntegrity = db.prepare");
  const analysis = source.indexOf("const rows = db.prepare");
  assert.ok(identity >= 0 && returnIntegrity > identity && integrity > returnIntegrity && analysis > integrity);
});

test("ROI improvement validation fails closed on incomplete, malformed, invalid-return-state, or duplicate settlement truth", () => {
  assert.match(source, /SELECT DISTINCT dh\.race_id/);
  assert.match(source, /ts\.returned=0 AND ts\.payout_yen>0/);
  assert.match(source, /ts\.combination IS NULL OR ts\.combination=''/);
  assert.match(source, /ts\.payout_yen IS NULL OR ts\.payout_yen<=0/);
  assert.match(source, /ts\.returned IS NULL OR ts\.returned != 0/);
  assert.match(source, /GROUP BY race_id, combination/);
  assert.match(source, /HAVING COUNT\(\*\) > 1/);
  assert.match(source, /settlementIntegrity\.covered !== settlementIntegrity\.total/);
  assert.match(source, /settlementIntegrity\.invalidNonRefundRows/);
  assert.match(source, /settlementIntegrity\.invalidReturnStateRows/);
  assert.match(source, /settlementIntegrity\.duplicateKeys/);
  assert.match(source, /target-cohort trifecta settlement rows require returned=0/);
  assert.match(source, /duplicate race×trifecta×combination settlement keys/);
  assert.match(source, /FAIL CLOSED/);
});

test("ROI improvement validation fails closed on unknown or returned historical BUY rows before settlement truth and ROI analysis", () => {
  assert.match(source, /dh\.returned IS NULL OR dh\.returned != 0/);
  assert.match(source, /unknown or returned historical BUY rows exist in the target cohort/);
  assert.ok((source.match(/dh\.returned=0/g) ?? []).length >= 2, "settlement-integrity and analyzed ROI cohorts must require explicit non-returned truth");
  assert.doesNotMatch(source, /COALESCE\(dh\.returned,0\)=0/);

  const returnIntegrity = source.indexOf("const invalidReturnedBuy = db.prepare");
  const failClosed = source.indexOf("unknown or returned historical BUY rows exist in the target cohort");
  const integrity = source.indexOf("const settlementIntegrity = db.prepare");
  const rows = source.indexOf("const rows = db.prepare");
  assert.ok(returnIntegrity >= 0 && failClosed > returnIntegrity && integrity > failClosed && rows > integrity);
});

test("ROI improvement validation permits legitimate multi-line trifecta settlements across distinct combinations", () => {
  assert.match(source, /GROUP BY race_id, combination/);
  assert.doesNotMatch(source, /GROUP BY race_id\s*\n\s*HAVING COUNT\(\*\) > 1/);
});

test("ROI improvement validation reports do not expose configured DB paths", () => {
  assert.match(source, /const REPORT_DB_LABEL = "canonical research database"/);
  assert.match(source, /db: REPORT_DB_LABEL/);
  assert.match(source, /DB: \$\{REPORT_DB_LABEL\}/);
  assert.doesNotMatch(source, /db: DB_PATH/);
  assert.doesNotMatch(source, /DB: \$\{DB_PATH\}/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});

test("ROI improvement report describes current_odds as a condition, not realized return", () => {
  assert.match(source, /ROIの回収額は公式実払戻し/);
  assert.match(source, /current_oddsは回収額の代用にせず/);
});
