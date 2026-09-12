import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/run-roi-autopilot.ts", "utf8");

test("ROI autopilot excludes the still quote-based commit review from decision inputs", () => {
  assert.doesNotMatch(source, /\["pnpm", \["analyze:roi-commit"\]\]/);
  assert.doesNotMatch(source, /reports\/roi-commit-review\.json/);
  assert.doesNotMatch(source, /commitReview\?\.overall/);
  assert.match(source, /quoteBasedCommitReviewExcluded: true/);
});

test("ROI autopilot fails closed if an optional hypothesis report is not official-payout based", () => {
  assert.match(source, /assertOfficialPayoutHypotheses\(hypotheses\);/);
  assert.match(source, /report\.safety\?\.metricBasis !== "official_payout_yen"/);
  assert.match(source, /ROI_AUTOPILOT_HYPOTHESIS_METRIC_BASIS_UNSAFE/);
  const reportRead = source.indexOf('"reports/roi-hypothesis-sets.json"');
  const gate = source.indexOf("assertOfficialPayoutHypotheses(hypotheses);");
  const decision = source.indexOf("const decision = decide(");
  assert.ok(reportRead >= 0);
  assert.ok(gate > reportRead);
  assert.ok(decision > gate);
});

test("ROI autopilot declares official payout metric basis", () => {
  assert.match(source, /metricBasis: "official_payout_yen"/);
});

test("ROI autopilot verifies upstream JSON identities before parsing", () => {
  assert.match(source, /ROI_AUTOPILOT_MATRIX_IDENTITY_INVALID/);
  assert.match(source, /ROI_AUTOPILOT_HYPOTHESES_IDENTITY_INVALID/);
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile(path, identityErrorCode)");
  const read = source.indexOf('readFileSync(verifiedPath, "utf8")', identity);
  assert.ok(identity >= 0 && read > identity, "research JSON must only be parsed from a verified canonical file identity");
  assert.doesNotMatch(source, /throw new Error\(`\$\{path\} does not exist`\)/);
});

test("ROI autopilot validates existing outputs and publishes through fsynced exclusive temp files", () => {
  const preflightJson = source.indexOf("verifyExistingOutput(OUT_JSON");
  const preflightMd = source.indexOf("verifyExistingOutput(OUT_MD");
  const jsonPublish = source.indexOf("atomicPublish(\n  OUT_JSON");
  const mdPublish = source.indexOf("atomicPublish(\n  OUT_MD");
  assert.ok(preflightJson >= 0 && preflightMd > preflightJson && jsonPublish > preflightMd && mdPublish > jsonPublish);

  const create = source.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, identityErrorCode)", fsync);
  const destinationIdentity = source.indexOf("verifyExistingOutput(path, destinationIdentityErrorCode)", identity);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", destinationIdentity);
  assert.ok(create >= 0 && fsync > create && identity > fsync && destinationIdentity > identity && rename > destinationIdentity);
  assert.match(source, /ROI_AUTOPILOT_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /ROI_AUTOPILOT_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /ROI_AUTOPILOT_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(source, /ROI_AUTOPILOT_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/);
});
