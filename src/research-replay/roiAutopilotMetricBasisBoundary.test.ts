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

test("ROI autopilot preflights the canonical report directory and complete paired destination set before publication", () => {
  const reportsDirectory = source.indexOf("ROI_AUTOPILOT_REPORTS_DIRECTORY_IDENTITY_INVALID");
  const preflightJson = source.indexOf("verifyExistingOutput(OUT_JSON", reportsDirectory);
  const preflightMd = source.indexOf("verifyExistingOutput(OUT_MD", preflightJson);
  const jsonPublish = source.indexOf("atomicPublish(\n  OUT_JSON", preflightMd);
  const mdPublish = source.indexOf("atomicPublish(\n  OUT_MD", jsonPublish);
  assert.ok(reportsDirectory >= 0);
  assert.ok(preflightJson > reportsDirectory && preflightMd > preflightJson);
  assert.ok(jsonPublish > preflightMd && mdPublish > jsonPublish, "both destinations must be preflighted before the first replacement");
});

test("ROI autopilot validates publish parent handoff and uses fsynced exclusive temp files", () => {
  const helper = source.indexOf("function atomicPublish(");
  const parentIdentity = source.indexOf("ROI_AUTOPILOT_PUBLISH_PARENT_IDENTITY_INVALID", helper);
  const create = source.indexOf('openSync(tempPath, "wx", 0o600)', parentIdentity);
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, identityErrorCode)", fsync);
  const destinationIdentity = source.indexOf("verifyExistingOutput(path, destinationIdentityErrorCode)", identity);
  const parentHandoff = source.indexOf("ROI_AUTOPILOT_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", parentHandoff);
  assert.ok(helper >= 0 && parentIdentity > helper);
  assert.ok(create > parentIdentity && fsync > create && identity > fsync);
  assert.ok(destinationIdentity > identity && parentHandoff > destinationIdentity && rename > parentHandoff);
  assert.match(source, /ROI_AUTOPILOT_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /ROI_AUTOPILOT_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /ROI_AUTOPILOT_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(source, /ROI_AUTOPILOT_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/);
});
