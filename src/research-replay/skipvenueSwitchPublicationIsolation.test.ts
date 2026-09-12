import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-skipvenue-switch-historical-closing-odds.ts", "utf8");

test("skipVenue switch analysis runs only after payout preflight and DB launch revalidation", () => {
  const payoutAudit = source.indexOf("const audit = runAudit");
  const handoffIdentity = source.indexOf("SKIPVENUE_SWITCH_HISTORICAL_DB_HANDOFF_IDENTITY_INVALID");
  const launchIdentity = source.indexOf("SKIPVENUE_SWITCH_HISTORICAL_DB_CHILD_LAUNCH_IDENTITY_INVALID");
  const analysisLaunch = source.indexOf("const analysis = spawnSync");

  assert.ok(payoutAudit >= 0, "payout completeness preflight must exist");
  assert.ok(handoffIdentity > payoutAudit, "DB handoff identity must be checked after payout preflight");
  assert.ok(launchIdentity > handoffIdentity, "DB identity must be rechecked immediately before child launch");
  assert.ok(analysisLaunch > launchIdentity, "isolated analysis must launch only after final DB identity verification");
  assert.match(source, /cwd: workspace/);
  assert.doesNotMatch(source, /await import\("\.\/analyze-skipvenue-switch-historical-closing-odds-internal"\)/);
});

test("skipVenue switch outputs are identity checked, sanitized, and atomically published", () => {
  const jsonIdentity = source.indexOf("SKIPVENUE_SWITCH_HISTORICAL_JSON_OUTPUT_IDENTITY_INVALID");
  const mdIdentity = source.indexOf("SKIPVENUE_SWITCH_HISTORICAL_MD_OUTPUT_IDENTITY_INVALID");
  const jsonRead = source.indexOf("readFileSync(verifiedJsonPath");
  const mdRead = source.indexOf("readFileSync(verifiedMdPath");
  const sanitize = source.indexOf('.join("verified read-only research DB")');
  const tempIdentity = source.indexOf("SKIPVENUE_SWITCH_HISTORICAL_JSON_PUBLISH_TEMP_IDENTITY_INVALID");
  const destinationIdentity = source.indexOf("SKIPVENUE_SWITCH_HISTORICAL_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID");

  assert.ok(jsonIdentity >= 0 && jsonRead > jsonIdentity, "JSON output identity must be verified before reading");
  assert.ok(mdIdentity >= 0 && mdRead > mdIdentity, "Markdown output identity must be verified before reading");
  assert.ok(sanitize > mdIdentity, "filesystem provenance must be removed before canonical publication");
  assert.ok(tempIdentity > sanitize, "atomic publication must verify the temporary artifact");
  assert.ok(destinationIdentity > tempIdentity, "atomic publication must revalidate an existing destination");
  assert.match(source, /openSync\(tempPath, "wx", 0o600\)/);
  assert.match(source, /fsyncSync\(fd\)/);
  assert.match(source, /renameSync\(verifiedTempPath, path\)/);
});
