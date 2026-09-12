import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("root methodology internal verifies primary database identity before opening read-only", () => {
  const source = readFileSync("scripts/audit-root-methodology-internal.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /ROOT_METHODOLOGY_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /const db = new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.doesNotMatch(source, /new DatabaseSync\(DB_PATH/);
});

test("root methodology guarded entrypoint reverifies DB identity after cohort preflight and before isolated child launch", () => {
  const source = readFileSync("scripts/audit-root-methodology.ts", "utf8");
  const primaryIdentity = source.indexOf("ROOT_METHODOLOGY_PRIMARY_DB_IDENTITY_INVALID");
  const cohortGate = source.indexOf("ROOT_METHODOLOGY_FORWARD_COHORT_INVALID");
  const close = source.lastIndexOf("db.close()");
  const handoffIdentity = source.indexOf("ROOT_METHODOLOGY_DB_HANDOFF_IDENTITY_INVALID");
  const childIdentity = source.indexOf("ROOT_METHODOLOGY_DB_CHILD_LAUNCH_IDENTITY_INVALID");
  const childLaunch = source.indexOf("const audit = spawnSync");

  assert.ok(primaryIdentity >= 0);
  assert.ok(cohortGate > primaryIdentity);
  assert.ok(close > cohortGate);
  assert.ok(handoffIdentity > close, "handoff identity must be checked after the preflight DB closes");
  assert.ok(childIdentity > handoffIdentity, "child-launch identity must revalidate the preflight handoff");
  assert.ok(childLaunch > childIdentity, "internal audit must start only after launch identity revalidation");
  assert.match(source, /env: \{ \.\.\.process\.env, BOAT_PON_DB_PATH: launchDbPath \}/u);
  assert.doesNotMatch(source, /await import\("\.\/audit-root-methodology-internal"\)/u);
});

test("root methodology publishes only verified isolated outputs atomically", () => {
  const source = readFileSync("scripts/audit-root-methodology.ts", "utf8");

  assert.match(source, /mkdtempSync\(join\(tmpdir\(\), "boat-pon-root-methodology-"\)\)/u);
  assert.match(source, /ROOT_METHODOLOGY_JSON_OUTPUT_IDENTITY_INVALID/u);
  assert.match(source, /ROOT_METHODOLOGY_MARKDOWN_OUTPUT_IDENTITY_INVALID/u);
  assert.match(source, /openSync\(tempPath, "wx", 0o600\)/u);
  assert.match(source, /writeFileSync\(fd, contents, "utf8"\);\s*fsyncSync\(fd\);/u);
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(tempPath, errorCode\);\s*renameSync\(verifiedTempPath, path\);/u);
  assert.match(source, /atomicPublish\(\s*OUT_JSON,\s*json,/u);
  assert.match(source, /atomicPublish\(\s*OUT_MD,\s*markdown,/u);
  assert.match(source, /rmSync\(workspace, \{ recursive: true, force: true \}\)/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_(?:JSON|MD)/u);
});
