import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("ability market validation uses canonical exacta authority for race and odds queries", () => {
  const source = readFileSync("scripts/analyze-ability-market-validation.ts", "utf8");

  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.equal((source.match(/historicalExactaCanonicalSourcePredicate\("h"\)/g) ?? []).length, 2);
  assert.doesNotMatch(source, /HAVING COUNT\(\*\) = 30/);
});

test("ability market validation fails closed on incomplete official payouts", () => {
  const source = readFileSync("scripts/analyze-ability-market-validation.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertPayoutCompleteness\(races\)/);
  assert.match(source, /ABILITY_MARKET_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /requiredPayout\(race\)/);
  assert.doesNotMatch(source, /race\.payout_yen \?\? 0/);
});

test("ability market validation publishes reports via exclusive fsynced verified temp files and atomic rename", () => {
  const source = readFileSync("scripts/analyze-ability-market-validation.ts", "utf8");

  assert.match(source, /openSync\(tempPath, "wx", 0o600\)/u);
  assert.match(source, /writeFileSync\(fd, contents, "utf8"\);\s*fsyncSync\(fd\);/u);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)");
  const destinationGuard = source.indexOf("if (existsSync(path))", tempIdentity);
  const destinationIdentity = source.indexOf(
    "assertCanonicalSingleLinkRegularFile(path, destinationErrorCode)",
    destinationGuard,
  );
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", destinationIdentity);
  assert.ok(
    tempIdentity >= 0 &&
      destinationGuard > tempIdentity &&
      destinationIdentity > destinationGuard &&
      rename > destinationIdentity,
    "verified temp and any existing destination must be identity-checked before atomic replacement",
  );
  assert.match(source, /ABILITY_MARKET_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /ABILITY_MARKET_MARKDOWN_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /ABILITY_MARKET_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /ABILITY_MARKET_MARKDOWN_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /atomicPublish\(\s*JSON_REPORT_PATH,/u);
  assert.match(source, /atomicPublish\(\s*MARKDOWN_REPORT_PATH,/u);
  assert.doesNotMatch(source, /writeFileSync\("reports\/ability-market-validation\.(?:json|md)"/u);
});
