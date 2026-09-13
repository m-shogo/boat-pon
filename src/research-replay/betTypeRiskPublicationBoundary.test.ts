import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-bet-type-risk-factors.ts", "utf8");

test("bet-type risk analysis runs the internal analyzer only inside an isolated workspace", () => {
  const workspace = source.indexOf("mkdtempSync(join(tmpdir(), \"boat-pon-bet-type-risk-\"))");
  const childLaunch = source.indexOf("cwd: workspace", workspace);
  const launchIdentity = source.indexOf("BET_TYPE_RISK_CHILD_LAUNCH_DB_IDENTITY_INVALID");

  assert.ok(workspace >= 0 && childLaunch > workspace && launchIdentity >= 0 && childLaunch > launchIdentity);
  assert.ok(!source.includes('run("scripts/analyze-bet-type-risk-factors-internal.ts"'));
});

test("bet-type risk markdown and JSON are verified, redacted, and preflighted before canonical publication", () => {
  const stagedMd = source.indexOf("BET_TYPE_RISK_MD_STAGED_OUTPUT_IDENTITY_INVALID");
  const stagedJson = source.indexOf("BET_TYPE_RISK_JSON_STAGED_OUTPUT_IDENTITY_INVALID");
  const redactMd = source.indexOf("redactDbProvenance(readFileSync(verifiedMdPath", stagedMd);
  const redactJson = source.indexOf("redactDbProvenance(readFileSync(verifiedJsonPath", stagedJson);
  const reportsIdentity = source.indexOf('assertCanonicalDirectory("reports", "BET_TYPE_RISK_REPORTS_DIRECTORY_IDENTITY_INVALID")', redactJson);
  const preflightMd = source.indexOf('verifyExistingDestination(OUT_MD, "BET_TYPE_RISK_MD_PREPUBLISH_DESTINATION_IDENTITY_INVALID")', reportsIdentity);
  const preflightJson = source.indexOf('verifyExistingDestination(OUT_JSON, "BET_TYPE_RISK_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID")', preflightMd);
  const publishMd = source.indexOf('atomicPublish(OUT_MD, markdown, "MD")', preflightJson);
  const publishJson = source.indexOf('atomicPublish(OUT_JSON, json, "JSON")', publishMd);

  assert.ok(stagedMd >= 0 && stagedJson >= 0);
  assert.ok(redactMd > stagedMd && redactJson > stagedJson);
  assert.ok(reportsIdentity > redactJson);
  assert.ok(preflightMd > reportsIdentity && preflightJson > preflightMd);
  assert.ok(publishMd > preflightJson && publishJson > publishMd);
});

test("bet-type risk atomic publication revalidates destination and parent immediately before rename", () => {
  const helperStart = source.indexOf("function atomicPublish(");
  const parentIdentity = source.indexOf("PUBLISH_PARENT_IDENTITY_INVALID", helperStart);
  const tempOpen = source.indexOf('openSync(tempPath, "wx", 0o600)', parentIdentity);
  const fsync = source.indexOf("fsyncSync(fd)", tempOpen);
  const tempIdentity = source.indexOf("PUBLISH_TEMP_IDENTITY_INVALID", fsync);
  const destinationGuard = source.indexOf("if (existsSync(path))", tempIdentity);
  const destinationIdentity = source.indexOf("PUBLISH_DESTINATION_IDENTITY_INVALID", destinationGuard);
  const parentHandoff = source.indexOf("PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", parentHandoff);

  assert.ok(
    helperStart >= 0 &&
      parentIdentity > helperStart &&
      tempOpen > parentIdentity &&
      fsync > tempOpen &&
      tempIdentity > fsync &&
      destinationGuard > tempIdentity &&
      destinationIdentity > destinationGuard &&
      parentHandoff > destinationIdentity &&
      rename > parentHandoff,
  );
});
