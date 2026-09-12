import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("unconventional feature analysis verifies primary database identity before opening read-only", () => {
  const source = readFileSync("scripts/analyze-unconventional-features.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /UNCONVENTIONAL_FEATURE_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /const db = new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /new DatabaseSync\("data\/boat\.sqlite"/);
});

test("unconventional feature analysis publishes reports via exclusive fsynced verified temp files and atomic rename", () => {
  const source = readFileSync("scripts/analyze-unconventional-features.ts", "utf8");

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
  assert.match(source, /UNCONVENTIONAL_FEATURE_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /UNCONVENTIONAL_FEATURE_MARKDOWN_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /UNCONVENTIONAL_FEATURE_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /UNCONVENTIONAL_FEATURE_MARKDOWN_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /atomicPublish\(\s*JSON_REPORT_PATH,/u);
  assert.match(source, /atomicPublish\(\s*MARKDOWN_REPORT_PATH,/u);
  assert.doesNotMatch(source, /writeFileSync\("reports\/unconventional-feature-screen\.(?:json|md)"/u);
});
