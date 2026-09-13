import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-bet-type-course-edge.ts", "utf8");
const raw = readFileSync("scripts/analyze-bet-type-course-edge-raw.ts", "utf8");

test("bet-type course entrypoint revalidates DB identity after settlement preflight before isolated internal analysis", () => {
  const close = entrypoint.indexOf("db.close()");
  const handoff = entrypoint.indexOf("BET_TYPE_COURSE_DB_HANDOFF_IDENTITY_INVALID");
  const launchIdentity = entrypoint.indexOf("BET_TYPE_COURSE_DB_CHILD_LAUNCH_IDENTITY_INVALID");
  const internalLaunch = entrypoint.indexOf("const analysis = spawnSync");

  assert.ok(close >= 0);
  assert.ok(handoff > close, "DB identity must be revalidated after payout preflight DB closes");
  assert.ok(launchIdentity > handoff, "DB identity must be revalidated again at child-launch boundary");
  assert.ok(internalLaunch > launchIdentity, "internal analyzer must launch only after DB launch revalidation");
  assert.match(entrypoint, /env: \{ \.\.\.process\.env, BOAT_PON_DB_PATH: launchDbPath \}/);
  assert.doesNotMatch(entrypoint, /analyze-bet-type-course-edge-raw/);
});

test("bet-type course verifies, sanitizes, and revalidates isolated outputs before atomic publication", () => {
  const launch = entrypoint.indexOf("const analysis = spawnSync");
  const mdOutput = entrypoint.indexOf("BET_TYPE_COURSE_MD_OUTPUT_IDENTITY_INVALID");
  const jsonOutput = entrypoint.indexOf("BET_TYPE_COURSE_JSON_OUTPUT_IDENTITY_INVALID");
  const mdRead = entrypoint.indexOf("BET_TYPE_COURSE_MD_READ_IDENTITY_INVALID");
  const jsonRead = entrypoint.indexOf("BET_TYPE_COURSE_JSON_READ_IDENTITY_INVALID");
  const provenance = entrypoint.indexOf("BET_TYPE_COURSE_PRIVATE_DB_PROVENANCE_REMAINED");
  const mdHandoff = entrypoint.indexOf("BET_TYPE_COURSE_MD_HANDOFF_IDENTITY_INVALID");
  const jsonHandoff = entrypoint.indexOf("BET_TYPE_COURSE_JSON_HANDOFF_IDENTITY_INVALID");
  const reportsDirectory = entrypoint.indexOf("BET_TYPE_COURSE_REPORTS_DIRECTORY_IDENTITY_INVALID");
  const mdDestinationPreflight = entrypoint.indexOf("BET_TYPE_COURSE_MD_PREPUBLISH_DESTINATION_IDENTITY_INVALID");
  const jsonDestinationPreflight = entrypoint.indexOf("BET_TYPE_COURSE_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID");
  const mdPublish = entrypoint.indexOf("BET_TYPE_COURSE_MD_PUBLISH_TEMP_IDENTITY_INVALID");
  const jsonPublish = entrypoint.indexOf("BET_TYPE_COURSE_JSON_PUBLISH_TEMP_IDENTITY_INVALID");

  assert.match(entrypoint, /mkdtempSync\(join\(tmpdir\(\), "boat-pon-bet-type-course-"\)\)/);
  assert.ok(mdOutput > launch);
  assert.ok(jsonOutput > mdOutput, "both staged output identities must validate before staged content is read");
  assert.ok(mdRead > jsonOutput);
  assert.ok(jsonRead > mdRead);
  assert.ok(provenance > jsonRead);
  assert.ok(mdHandoff > provenance);
  assert.ok(jsonHandoff > mdHandoff);
  assert.ok(reportsDirectory > jsonHandoff, "canonical report directory must be checked after staged output preparation");
  assert.ok(mdDestinationPreflight > reportsDirectory);
  assert.ok(jsonDestinationPreflight > mdDestinationPreflight, "both canonical destinations must preflight before the first replacement");
  assert.ok(mdPublish > jsonDestinationPreflight, "canonical publication must wait for the complete destination-set preflight");
  assert.ok(jsonPublish > mdPublish);
  assert.match(entrypoint, /markdown\.includes\(launchDbPath\) \|\| json\.includes\(launchDbPath\)/);
  assert.match(entrypoint, /openSync\(tempPath, "wx", 0o600\)/);
  assert.match(entrypoint, /fsyncSync\(fd\)/);
  assert.match(entrypoint, /BET_TYPE_COURSE_PUBLISH_PARENT_IDENTITY_INVALID/);
  assert.match(entrypoint, /BET_TYPE_COURSE_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID/);
  assert.match(entrypoint, /BET_TYPE_COURSE_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(entrypoint, /BET_TYPE_COURSE_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(entrypoint, /renameSync\(verifiedTempPath, path\)/);
  assert.match(entrypoint, /rmSync\(workspace, \{ recursive: true, force: true \}\)/);
});

test("bet-type course guarded raw compatibility module routes through canonical DB and settlement preflight", () => {
  const canonical = raw.indexOf('await import("./analyze-bet-type-course-edge")');

  assert.ok(canonical >= 0);
  assert.match(raw, /BET_TYPE_COURSE_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.doesNotMatch(raw, /BET_TYPE_COURSE_DB_IDENTITY_INVALID/);
  assert.doesNotMatch(raw, /BET_TYPE_COURSE_DB_MISSING/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(raw, /assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(raw, /analyze-bet-type-course-edge-internal/);
});
