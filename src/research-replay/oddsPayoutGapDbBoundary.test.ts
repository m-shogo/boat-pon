import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entry = readFileSync("scripts/analyze-odds-payout-gap.ts", "utf8");
const raw = readFileSync("scripts/analyze-odds-payout-gap-raw.ts", "utf8");

test("odds-payout-gap canonical entrypoint verifies DB identity after preflight and again before isolated child launch", () => {
  const gate = entry.indexOf("if (preflight !== 0)");
  const identity = entry.indexOf("ODDS_PAYOUT_GAP_DB_IDENTITY_INVALID");
  const workspace = entry.indexOf("mkdtempSync(", identity);
  const launchIdentity = entry.indexOf("ODDS_PAYOUT_GAP_DB_CHILD_LAUNCH_IDENTITY_INVALID", workspace);
  const internal = entry.indexOf("const analysis = spawnSync", launchIdentity);

  assert.ok(gate >= 0);
  assert.ok(identity > gate);
  assert.ok(workspace > identity);
  assert.ok(launchIdentity > workspace);
  assert.ok(internal > launchIdentity, "internal analyzer must launch only after payout preflight and launch-time canonical DB identity verification");
  assert.match(entry, /ODDS_PAYOUT_GAP_DB_MISSING/);
  assert.match(entry, /BOAT_PON_DB_PATH: launchDbPath/);
  assert.match(entry, /cwd: workspace/);
  assert.doesNotMatch(entry, /process\.env\.BOAT_PON_DB_PATH =/);
  assert.doesNotMatch(entry, /await import\("\.\/analyze-odds-payout-gap-internal"\)/);
  assert.doesNotMatch(entry, /analyze-odds-payout-gap-raw/);
});

test("odds-payout-gap canonical entrypoint verifies generated artifacts before read and publishes atomically", () => {
  const analysis = entry.indexOf("const analysis = spawnSync");
  const mdIdentity = entry.indexOf("ODDS_PAYOUT_GAP_MD_WORKSPACE_OUTPUT_IDENTITY_INVALID", analysis);
  const jsonIdentity = entry.indexOf("ODDS_PAYOUT_GAP_JSON_WORKSPACE_OUTPUT_IDENTITY_INVALID", analysis);
  const mdRead = entry.indexOf('readFileSync(workspaceMd, "utf8")', mdIdentity);
  const jsonRead = entry.indexOf('readFileSync(workspaceJson, "utf8")', jsonIdentity);
  const tempCreate = entry.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = entry.indexOf("fsyncSync(fd)", tempCreate);
  const tempIdentity = entry.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, errorCode)", fsync);
  const rename = entry.indexOf("renameSync(verifiedTempPath, path)", tempIdentity);
  const postflight = entry.indexOf("ODDS_PAYOUT_GAP_MD_OUTPUT_IDENTITY_INVALID", analysis);

  assert.ok(mdIdentity > analysis && jsonIdentity > analysis);
  assert.ok(mdRead > mdIdentity && jsonRead > jsonIdentity);
  assert.ok(tempCreate >= 0 && fsync > tempCreate);
  assert.ok(tempIdentity > fsync && rename > tempIdentity);
  assert.ok(postflight > rename);
  assert.match(entry, /ODDS_PAYOUT_GAP_MD_PREEXISTING_IDENTITY_INVALID/);
  assert.match(entry, /ODDS_PAYOUT_GAP_JSON_PREEXISTING_IDENTITY_INVALID/);
  assert.match(entry, /ODDS_PAYOUT_GAP_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(entry, /ODDS_PAYOUT_GAP_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
});

test("odds-payout-gap raw compatibility module cannot bypass canonical preflight", () => {
  assert.match(raw, /ODDS_PAYOUT_GAP_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/analyze-odds-payout-gap"\)/);
  assert.doesNotMatch(raw, /analyze-odds-payout-gap-internal/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
});
