import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("wind direction venue screen fails closed on DB identity and exacta settlement coverage", () => {
  const source = readFileSync("scripts/analyze-wind-direction-by-venue.ts", "utf8");
  const coverageIndex = source.indexOf("assertSettlementCompleteness();");
  const analysisIndex = source.indexOf("const raws = db.prepare");

  assert.match(source, /assertCanonicalSingleLinkRegularFile\(/);
  assert.match(source, /WIND_DIRECTION_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /WIND_DIRECTION_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /settled !== total/);
  assert.ok(coverageIndex >= 0, "settlement coverage gate must exist");
  assert.ok(analysisIndex > coverageIndex, "ROI analysis must not start before settlement coverage passes");
});

test("wind direction venue screen validates existing outputs and publishes atomically", () => {
  const source = readFileSync("scripts/analyze-wind-direction-by-venue.ts", "utf8");
  const preflightMd = source.indexOf("verifyExistingOutput(OUT_MD");
  const preflightJson = source.indexOf("verifyExistingOutput(OUT_JSON");
  const mdPublish = source.indexOf("atomicPublish(OUT_MD");
  const jsonPublish = source.indexOf("atomicPublish(OUT_JSON");
  assert.ok(preflightMd >= 0 && preflightJson > preflightMd && mdPublish > preflightJson && jsonPublish > mdPublish);

  const create = source.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, identityErrorCode)", fsync);
  const destinationExists = source.indexOf("if (existsSync(path))", tempIdentity);
  const destinationIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(path, destinationIdentityErrorCode)", destinationExists);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", destinationIdentity);
  assert.ok(create >= 0 && fsync > create && tempIdentity > fsync && destinationExists > tempIdentity && destinationIdentity > destinationExists && rename > destinationIdentity);

  assert.match(source, /WIND_DIRECTION_PREEXISTING_MD_IDENTITY_INVALID/);
  assert.match(source, /WIND_DIRECTION_PREEXISTING_JSON_IDENTITY_INVALID/);
  assert.match(source, /WIND_DIRECTION_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /WIND_DIRECTION_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /WIND_DIRECTION_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(source, /WIND_DIRECTION_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/);
});
