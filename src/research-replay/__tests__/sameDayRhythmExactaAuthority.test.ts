import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("same-day rhythm screen binds both base and selection odds to canonical exacta authority", () => {
  const source = readFileSync("scripts/analyze-same-day-rhythm-market.ts", "utf8");

  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.ok((source.match(/historicalExactaCanonicalSourcePredicate\("h"\)/g) ?? []).length >= 2);
  assert.doesNotMatch(source, /HAVING COUNT\(\*\)=30/);
});

test("same-day rhythm ROI fails closed on incomplete official payouts", () => {
  const source = readFileSync("scripts/analyze-same-day-rhythm-market.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(dbPath,\{readOnly:true\}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertPayoutCompleteness\(market\)/);
  assert.match(source, /SAME_DAY_RHYTHM_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /map\(requiredPayout\)/);
  assert.doesNotMatch(source, /payout_yen\?\?0/);
});

test("same-day rhythm exacta settlement is unambiguous before market aggregation", () => {
  const source = readFileSync("scripts/analyze-same-day-rhythm-market.ts", "utf8");
  const preflight = source.indexOf("assertSettlementCoverage(coverage)");
  const analysis = source.indexOf("const market=db.prepare");

  assert.ok(preflight >= 0 && analysis > preflight, "settlement integrity must pass before market aggregation");
  assert.match(source, /CASE WHEN COUNT\(\*\)=1/);
  assert.match(source, /SAME_DAY_RHYTHM_EXACTA_SETTLEMENT_INTEGRITY_INVALID/);
  assert.match(source, /JOIN race_payouts p ON p\.race_id=h\.race_id AND p\.bet_type='exacta'/);
  assert.match(source, /SELECT COUNT\(\*\) FROM race_payouts rp WHERE rp\.race_id=h\.race_id AND rp\.bet_type='exacta'\)=1/);
  assert.match(source, /p\.returned=0/);
  assert.match(source, /p\.combination IS NOT NULL AND p\.combination!=''/);
  assert.match(source, /p\.payout_yen IS NOT NULL AND p\.payout_yen>0/);
  assert.match(source, /historicalExactaCanonicalSourcePredicate\("winner_h"\)/);
  assert.match(source, /winner_h\.combination=p\.combination/);
  assert.doesNotMatch(source, /LEFT JOIN race_payouts p/);
});

test("same-day rhythm title HTML is identity-verified before parsing", () => {
  const source = readFileSync("scripts/analyze-same-day-rhythm-market.ts", "utf8");
  const identity = source.indexOf('assertCanonicalSingleLinkRegularFile(path,"SAME_DAY_RHYTHM_TITLE_IDENTITY_INVALID")');
  const read = source.indexOf('readFileSync(verifiedPath,"utf8")');

  assert.ok(identity >= 0 && read > identity, "title HTML identity must be verified before read/parse");
  assert.match(source, /if\(!existsSync\(path\)\)return""/);
  assert.doesNotMatch(source, /load\(readFileSync\(path,/);
});

test("same-day rhythm reports publish through exclusive fsynced identity-verified temp files", () => {
  const source = readFileSync("scripts/analyze-same-day-rhythm-market.ts", "utf8");

  assert.match(source, /openSync\(tempPath,"wx",0o600\)/);
  assert.match(source, /fsyncSync\(fd\)/);
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(tempPath,errorCode\)/);
  assert.match(source, /renameSync\(verifiedTempPath,path\)/);
  assert.match(source, /atomicPublish\(JSON_REPORT_PATH/);
  assert.match(source, /atomicPublish\(MARKDOWN_REPORT_PATH/);
  assert.doesNotMatch(source, /writeFileSync\("reports\/same-day-rhythm-market-screen\.(?:json|md)"/);
});