import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-roi-strategy-after-filters.ts", "utf8");

test("ROI strategy analysis verifies canonical DB identity and never emits the private DB path", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "ROI_STRATEGY_DB_IDENTITY_INVALID"\)/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /dbPath: DB_PATH/);
  assert.match(source, /dbIdentity: "verified-canonical-research-db"/);
});

test("ROI strategy report publication is exclusive, durable, identity-checked, and atomic", () => {
  assert.match(source, /openSync\(tempPath, "wx", 0o600\)/);
  assert.match(source, /fsyncSync\(fd\)/);
  assert.match(source, /const verifiedTempPath = assertCanonicalSingleLinkRegularFile\(tempPath, tempErrorCode\)/);
  assert.match(source, /if \(existsSync\(path\)\) \{\s*assertCanonicalSingleLinkRegularFile\(path, destinationErrorCode\);\s*\}/);
  assert.match(source, /renameSync\(verifiedTempPath, path\)/);
  const tempIdentity = source.indexOf("const verifiedTempPath = assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)");
  const destinationIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(path, destinationErrorCode)");
  const rename = source.indexOf("renameSync(verifiedTempPath, path)");
  assert.ok(tempIdentity >= 0 && destinationIdentity > tempIdentity && rename > destinationIdentity);
  assert.match(source, /atomicPublish\(\s*OUT_JSON,/);
  assert.match(source, /atomicPublish\(\s*OUT_MD,/);
  assert.doesNotMatch(source, /writeFileSync\(OUT_JSON/);
  assert.doesNotMatch(source, /writeFileSync\(OUT_MD/);
});

test("motor and boat enrichment joins by race_id plus selected head course", () => {
  assert.match(source, /dh\.race_id AS raceId/);
  assert.match(source, /const raceId = String\(row\.raceId\)/);
  assert.match(source, /mb\.get\(`\$\{raceId\}:\$\{head\}`\)/);
  assert.doesNotMatch(source, /byRaceKey/);
  assert.doesNotMatch(source, /const key = `\$\{String\(row\.id\)\}:\$\{head\}`/);
});

test("strategy ROI maps decision 3連単 rows to canonical trifecta settlements", () => {
  assert.match(source, /const DECISION_BET_TYPE = "3連単"/);
  assert.match(source, /const PAYOUT_BET_TYPE = "trifecta"/);
  assert.match(source, /dh\.bet_type = \?/);
  assert.match(source, /rp\.bet_type = \?/);
  assert.match(source, /settled\.bet_type = \?/);
  assert.match(source, /\.get\(PAYOUT_BET_TYPE, DECISION_BET_TYPE\)/);
  assert.match(source, /\.all\(PAYOUT_BET_TYPE, PAYOUT_BET_TYPE, DECISION_BET_TYPE\)/);
  assert.doesNotMatch(source, /dh\.bet_type = rp\.bet_type/);
  assert.doesNotMatch(source, /settled\.bet_type = dh\.bet_type/);
  assert.doesNotMatch(source, /rp\.bet_type = dh\.bet_type/);
});

test("strategy ROI fails closed on unknown or returned BUY rows and duplicate exact settlement keys", () => {
  assert.match(source, /assertResearchSettlementIntegrity\(\)/);
  assert.match(source, /ROI_STRATEGY_RETURNED_BUY_PRESENT/);
  assert.match(source, /dh\.returned IS NULL OR dh\.returned != 0/);
  assert.match(source, /ROI_STRATEGY_PAYOUT_DUPLICATE_KEY/);
  assert.match(source, /GROUP BY rp\.race_id, rp\.bet_type, rp\.combination/);
  assert.match(source, /HAVING COUNT\(\*\) > 1/);
  assert.ok((source.match(/dh\.returned = 0/g) ?? []).length >= 2);
  assert.doesNotMatch(source, /COALESCE\(dh\.returned, 0\)/);
  const integrityCheck = source.indexOf("assertResearchSettlementIntegrity();");
  const loadRows = source.indexOf("const rows = loadRows();");
  assert.ok(integrityCheck >= 0 && loadRows > integrityCheck);
});

test("strategy ROI uses positive official settlement for the actual winning combination", () => {
  assert.match(source, /settled\.payout_yen > 0/);
  assert.match(source, /rp\.combination = dh\.result/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.match(source, /ROI_STRATEGY_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /roiBasis: "official-race-payouts"/);
  assert.match(source, /hit: row\.result === ticket, payoutYen: row\.payoutYen/);
  assert.match(source, /hitReturns\.reduce\(\(sum, payoutYen\) => sum \+ payoutYen, 0\)/);
  assert.doesNotMatch(source, /ticketOutcomes\.push\(\{ odds: row\.currentOdds/);
  assert.doesNotMatch(source, /sum \+ odds \* STAKE_YEN/);
});
