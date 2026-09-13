import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/check-exacta-backfill-quality.ts", "utf8");

test("exacta backfill quality keeps canonical read-only DB isolation", () => {
  assert.match(source, /EXACTA_BACKFILL_QUALITY_DB_IDENTITY_INVALID/u);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/u);
  assert.match(source, /PRAGMA query_only = ON/u);
  assert.match(source, /EXACTA_BACKFILL_QUALITY_DB_CHILD_LAUNCH_IDENTITY_INVALID/u);
  assert.match(source, /cwd: workspace/u);
});

test("exacta backfill quality preflights both canonical destinations before the first replacement", () => {
  const redaction = source.indexOf('.split(launchDbPath).join("verified read-only research DB")');
  const reportsIdentity = source.indexOf("EXACTA_BACKFILL_QUALITY_REPORTS_DIRECTORY_IDENTITY_INVALID", redaction);
  const completePreflight = source.indexOf("verifyExistingOutputs();", reportsIdentity);
  const mdPublish = source.indexOf("  atomicPublish(\n    OUT_MD,", completePreflight);
  const jsonPublish = source.indexOf("  atomicPublish(\n    OUT_JSON,", mdPublish + 1);

  assert.ok(reportsIdentity > redaction);
  assert.ok(completePreflight > reportsIdentity);
  assert.ok(mdPublish > completePreflight);
  assert.ok(jsonPublish > mdPublish);
  assert.match(source, /EXACTA_BACKFILL_QUALITY_MD_PREPUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /EXACTA_BACKFILL_QUALITY_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID/u);
});

test("exacta backfill quality reverifies parent and destination immediately before atomic replacement", () => {
  assert.match(source, /EXACTA_BACKFILL_QUALITY_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /EXACTA_BACKFILL_QUALITY_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  const parentIdentity = source.indexOf("EXACTA_BACKFILL_QUALITY_PUBLISH_PARENT_IDENTITY_INVALID");
  const create = source.indexOf('openSync(tempPath, "wx", 0o600)', parentIdentity);
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)", fsync);
  const destinationGuard = source.indexOf("if (existsSync(path))", tempIdentity);
  const destinationIdentity = source.indexOf(
    "assertCanonicalSingleLinkRegularFile(path, destinationErrorCode)",
    destinationGuard,
  );
  const parentHandoff = source.indexOf(
    "EXACTA_BACKFILL_QUALITY_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID",
    destinationIdentity,
  );
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", parentHandoff);
  assert.ok(
    parentIdentity >= 0 &&
      create > parentIdentity &&
      fsync > create &&
      tempIdentity > fsync &&
      destinationGuard > tempIdentity &&
      destinationIdentity > destinationGuard &&
      parentHandoff > destinationIdentity &&
      rename > parentHandoff,
  );
  assert.match(source, /!stat\.isDirectory\(\) \|\| stat\.isSymbolicLink\(\)/u);
  assert.match(source, /realpathSync\(path\) !== resolvedPath/u);
});
