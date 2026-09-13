import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-local-market-anomalies.ts", "utf8");
const raw = readFileSync("scripts/analyze-local-market-anomalies-raw.ts", "utf8");

test("local market entrypoint revalidates DB identity after settlement preflight before isolated internal analysis", () => {
  const close = entrypoint.indexOf("db.close()");
  const handoff = entrypoint.indexOf("LOCAL_MARKET_DB_HANDOFF_IDENTITY_INVALID");
  const launchIdentity = entrypoint.indexOf("LOCAL_MARKET_DB_CHILD_LAUNCH_IDENTITY_INVALID");
  const internalLaunch = entrypoint.indexOf("const analysis = spawnSync");

  assert.ok(close >= 0);
  assert.ok(handoff > close, "DB identity must be revalidated after exacta settlement preflight closes the DB");
  assert.ok(launchIdentity > handoff, "DB identity must be revalidated at child-launch boundary");
  assert.ok(internalLaunch > launchIdentity, "internal analyzer must launch only after DB launch revalidation");
  assert.match(entrypoint, /env: \{ \.\.\.process\.env, BOAT_PON_DB_PATH: launchDbPath \}/);
  assert.doesNotMatch(entrypoint, /analyze-local-market-anomalies-raw/);
});

test("local market validates the complete destination set before paired publication", () => {
  const launch = entrypoint.indexOf("const analysis = spawnSync");
  const jsonOutput = entrypoint.indexOf("LOCAL_MARKET_JSON_OUTPUT_IDENTITY_INVALID");
  const mdOutput = entrypoint.indexOf("LOCAL_MARKET_MD_OUTPUT_IDENTITY_INVALID");
  const reportsIdentity = entrypoint.indexOf("LOCAL_MARKET_REPORTS_DIRECTORY_IDENTITY_INVALID", mdOutput);
  const jsonPrepublish = entrypoint.indexOf("LOCAL_MARKET_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID", reportsIdentity);
  const mdPrepublish = entrypoint.indexOf("LOCAL_MARKET_MD_PREPUBLISH_DESTINATION_IDENTITY_INVALID", jsonPrepublish);
  const firstPublish = entrypoint.indexOf("atomicPublish(", mdPrepublish);

  assert.match(entrypoint, /mkdtempSync\(join\(tmpdir\(\), "boat-pon-local-market-"\)\)/);
  assert.ok(jsonOutput > launch);
  assert.ok(mdOutput > launch);
  assert.ok(reportsIdentity > mdOutput);
  assert.ok(jsonPrepublish > reportsIdentity && mdPrepublish > jsonPrepublish);
  assert.ok(firstPublish > mdPrepublish, "both canonical destinations must be preflighted before the first replacement");
  assert.match(entrypoint, /LOCAL_MARKET_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(entrypoint, /LOCAL_MARKET_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(entrypoint, /rmSync\(workspace, \{ recursive: true, force: true \}\)/);
});

test("local market atomic publication reverifies parent and destination identities at handoff", () => {
  const atomic = entrypoint.indexOf("function atomicPublish");
  const parentIdentity = entrypoint.indexOf("LOCAL_MARKET_PUBLISH_PARENT_IDENTITY_INVALID", atomic);
  const exclusiveOpen = entrypoint.indexOf('openSync(tempPath, "wx", 0o600)', parentIdentity);
  const fsync = entrypoint.indexOf("fsyncSync(fd)", exclusiveOpen);
  const tempIdentity = entrypoint.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)", fsync);
  const destinationExistence = entrypoint.indexOf("if (existsSync(path))", tempIdentity);
  const destinationIdentity = entrypoint.indexOf("assertCanonicalSingleLinkRegularFile(path, destinationErrorCode)", destinationExistence);
  const parentHandoff = entrypoint.indexOf("LOCAL_MARKET_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
  const rename = entrypoint.indexOf("renameSync(verifiedTempPath, path)", parentHandoff);

  assert.ok(parentIdentity > atomic);
  assert.ok(exclusiveOpen > parentIdentity && fsync > exclusiveOpen);
  assert.ok(tempIdentity > fsync);
  assert.ok(destinationExistence > tempIdentity && destinationIdentity > destinationExistence);
  assert.ok(parentHandoff > destinationIdentity);
  assert.ok(rename > parentHandoff, "atomic rename must occur only after parent and destination identity revalidation");
});

test("local market guarded raw module cannot bypass canonical settlement preflight", () => {
  assert.match(raw, /LOCAL_MARKET_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/analyze-local-market-anomalies"\)/);
  assert.doesNotMatch(raw, /analyze-local-market-anomalies-internal/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(raw, /DatabaseSync/);
});
