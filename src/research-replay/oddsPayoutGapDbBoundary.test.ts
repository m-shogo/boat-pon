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

test("odds-payout-gap canonical entrypoint verifies generated artifacts and the complete destination set before atomic publication", () => {
  const analysis = entry.indexOf("const analysis = spawnSync");
  const mdIdentity = entry.indexOf("ODDS_PAYOUT_GAP_MD_WORKSPACE_OUTPUT_IDENTITY_INVALID", analysis);
  const jsonIdentity = entry.indexOf("ODDS_PAYOUT_GAP_JSON_WORKSPACE_OUTPUT_IDENTITY_INVALID", analysis);
  const mdRead = entry.indexOf('readFileSync(workspaceMd, "utf8")', mdIdentity);
  const jsonRead = entry.indexOf('readFileSync(workspaceJson, "utf8")', jsonIdentity);
  const publishMkdir = entry.indexOf('mkdirSync("reports", { recursive: true })', jsonRead);
  const reportsIdentity = entry.indexOf("ODDS_PAYOUT_GAP_REPORTS_DIRECTORY_IDENTITY_INVALID", publishMkdir);
  const mdPrepublish = entry.indexOf("ODDS_PAYOUT_GAP_MD_PREPUBLISH_DESTINATION_IDENTITY_INVALID", reportsIdentity);
  const jsonPrepublish = entry.indexOf("ODDS_PAYOUT_GAP_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID", mdPrepublish);
  const firstPublish = entry.indexOf("atomicPublish(", jsonPrepublish);
  const postflight = entry.indexOf("ODDS_PAYOUT_GAP_MD_OUTPUT_IDENTITY_INVALID", firstPublish);

  assert.ok(mdIdentity > analysis && jsonIdentity > analysis);
  assert.ok(mdRead > mdIdentity && jsonRead > jsonIdentity);
  assert.ok(publishMkdir > jsonRead);
  assert.ok(reportsIdentity > publishMkdir);
  assert.ok(mdPrepublish > reportsIdentity && jsonPrepublish > mdPrepublish);
  assert.ok(firstPublish > jsonPrepublish, "both canonical destinations must be preflighted before the first replacement");
  assert.ok(postflight > firstPublish);
  assert.match(entry, /ODDS_PAYOUT_GAP_MD_PREEXISTING_IDENTITY_INVALID/);
  assert.match(entry, /ODDS_PAYOUT_GAP_JSON_PREEXISTING_IDENTITY_INVALID/);
});

test("odds-payout-gap atomic publication reverifies parent and destination identities at handoff", () => {
  const atomic = entry.indexOf("function atomicPublish");
  const parentIdentity = entry.indexOf("ODDS_PAYOUT_GAP_PUBLISH_PARENT_IDENTITY_INVALID", atomic);
  const tempCreate = entry.indexOf('openSync(tempPath, "wx", 0o600)', parentIdentity);
  const fsync = entry.indexOf("fsyncSync(fd)", tempCreate);
  const tempIdentity = entry.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)", fsync);
  const destinationGuard = entry.indexOf("if (existsSync(path))", tempIdentity);
  const destinationIdentity = entry.indexOf("assertCanonicalSingleLinkRegularFile(path, destinationErrorCode)", destinationGuard);
  const parentHandoff = entry.indexOf("ODDS_PAYOUT_GAP_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
  const rename = entry.indexOf("renameSync(verifiedTempPath, path)", parentHandoff);

  assert.ok(parentIdentity > atomic);
  assert.ok(tempCreate > parentIdentity && fsync > tempCreate);
  assert.ok(tempIdentity > fsync);
  assert.ok(destinationGuard > tempIdentity && destinationIdentity > destinationGuard);
  assert.ok(parentHandoff > destinationIdentity);
  assert.ok(rename > parentHandoff, "atomic rename must occur only after parent and destination identity revalidation");
  assert.match(entry, /ODDS_PAYOUT_GAP_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(entry, /ODDS_PAYOUT_GAP_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(entry, /ODDS_PAYOUT_GAP_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(entry, /ODDS_PAYOUT_GAP_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/);
});

test("odds-payout-gap raw compatibility module cannot bypass canonical preflight", () => {
  assert.match(raw, /ODDS_PAYOUT_GAP_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/analyze-odds-payout-gap"\)/);
  assert.doesNotMatch(raw, /analyze-odds-payout-gap-internal/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
});
