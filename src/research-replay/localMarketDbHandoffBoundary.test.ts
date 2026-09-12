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

test("local market isolated publication verifies outputs and atomic destinations", () => {
  const launch = entrypoint.indexOf("const analysis = spawnSync");
  const jsonOutput = entrypoint.indexOf("LOCAL_MARKET_JSON_OUTPUT_IDENTITY_INVALID");
  const mdOutput = entrypoint.indexOf("LOCAL_MARKET_MD_OUTPUT_IDENTITY_INVALID");
  const jsonPublish = entrypoint.indexOf("LOCAL_MARKET_JSON_PUBLISH_TEMP_IDENTITY_INVALID");
  const mdPublish = entrypoint.indexOf("LOCAL_MARKET_MD_PUBLISH_TEMP_IDENTITY_INVALID");

  assert.match(entrypoint, /mkdtempSync\(join\(tmpdir\(\), "boat-pon-local-market-"\)\)/);
  assert.ok(jsonOutput > launch);
  assert.ok(mdOutput > launch);
  assert.ok(jsonPublish > jsonOutput);
  assert.ok(mdPublish > mdOutput);
  assert.match(entrypoint, /openSync\(tempPath, "wx", 0o600\)/);
  assert.match(entrypoint, /fsyncSync\(fd\)/);
  assert.match(entrypoint, /LOCAL_MARKET_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(entrypoint, /LOCAL_MARKET_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(entrypoint, /renameSync\(verifiedTempPath, path\)/);
  assert.match(entrypoint, /rmSync\(workspace, \{ recursive: true, force: true \}\)/);
});

test("local market guarded raw module cannot bypass canonical settlement preflight", () => {
  assert.match(raw, /LOCAL_MARKET_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/analyze-local-market-anomalies"\)/);
  assert.doesNotMatch(raw, /analyze-local-market-anomalies-internal/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(raw, /DatabaseSync/);
});
