import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-roi-hypothesis-sets.ts", "utf8");

test("ROI hypothesis preflights the complete paired destination set before publication", () => {
  const reportsIdentity = source.indexOf('"ROI_HYPOTHESIS_REPORTS_DIRECTORY_IDENTITY_INVALID"');
  const jsonPreflight = source.indexOf('verifyExistingOutput(OUT_JSON, "ROI_HYPOTHESIS_PREEXISTING_JSON_IDENTITY_INVALID")');
  const markdownPreflight = source.indexOf('verifyExistingOutput(OUT_MD, "ROI_HYPOTHESIS_PREEXISTING_MARKDOWN_IDENTITY_INVALID")');
  const firstPublish = source.indexOf("atomicPublish(\n    OUT_JSON,");

  assert.ok(reportsIdentity >= 0, "canonical reports directory identity must be checked");
  assert.ok(jsonPreflight > reportsIdentity, "JSON destination preflight must follow reports identity");
  assert.ok(markdownPreflight > jsonPreflight, "Markdown destination must also be preflighted before publication");
  assert.ok(firstPublish > markdownPreflight, "neither paired output may publish until both destinations pass preflight");
});

test("ROI hypothesis publication verifies staged outputs and atomically revalidates destination and parent handoff", () => {
  assert.match(source, /ROI_HYPOTHESIS_JSON_OUTPUT_IDENTITY_INVALID/u);
  assert.match(source, /ROI_HYPOTHESIS_MARKDOWN_OUTPUT_IDENTITY_INVALID/u);
  assert.match(source, /ROI_HYPOTHESIS_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /ROI_HYPOTHESIS_MARKDOWN_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /ROI_HYPOTHESIS_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /ROI_HYPOTHESIS_MARKDOWN_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  const helper = source.indexOf("function atomicPublish(");
  const parentIdentity = source.indexOf("ROI_HYPOTHESIS_PUBLISH_PARENT_IDENTITY_INVALID", helper);
  const create = source.indexOf('openSync(tempPath, "wx", 0o600)', parentIdentity);
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)", fsync);
  const destinationIdentity = source.indexOf("verifyExistingOutput(path, destinationErrorCode)", tempIdentity);
  const parentHandoff = source.indexOf("ROI_HYPOTHESIS_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", parentHandoff);

  assert.ok(parentIdentity >= 0 && create > parentIdentity, "temp creation must follow canonical parent verification");
  assert.ok(fsync > create && tempIdentity > fsync, "temp publication must remain exclusive, durable, and identity-checked");
  assert.ok(destinationIdentity > tempIdentity, "destination must be revalidated after staged temp identity");
  assert.ok(parentHandoff > destinationIdentity && rename > parentHandoff, "rename must follow parent handoff revalidation");
});

test("ROI hypothesis destination hardening preserves fail-closed read-only analysis boundaries", () => {
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/u);
  assert.match(source, /PRAGMA query_only = ON/u);
  assert.match(source, /ROI_HYPOTHESIS_DB_HANDOFF_IDENTITY_INVALID/u);
  assert.match(source, /ROI_HYPOTHESIS_DB_CHILD_LAUNCH_IDENTITY_INVALID/u);
  assert.match(source, /mkdtempSync\(join\(tmpdir\(\), "boat-pon-roi-hypothesis-"\)\)/u);
  assert.match(source, /cwd: workspace/u);
  assert.match(source, /dh\.run_kind = 'historical-backfill'/u);
  assert.match(source, /dh\.decision = 'BUY'/u);
  assert.match(source, /rp\.bet_type = \?/u);
  assert.match(source, /rp\.returned = 0/u);
  assert.match(source, /rp\.payout_yen > 0/u);
});
