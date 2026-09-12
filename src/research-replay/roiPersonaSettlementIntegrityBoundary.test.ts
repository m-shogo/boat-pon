import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/roi-pro-persona-review.ts", "utf8");

test("ROI persona review fails closed on ambiguous all-feature settlements before consuming or generating the report", () => {
  assert.match(source, /const SETTLEMENT_GATE = "scripts\/assert-roi-all-feature-settlement-integrity\.ts";/);
  assert.match(source, /function assertAllFeatureSettlementIntegrity\(\)/);
  assert.match(source, /execFileSync\("pnpm", \["tsx", SETTLEMENT_GATE\], \{ stdio: "inherit" \}\)/);

  const metricGate = source.indexOf("assertRealizedPayoutMetricBasis();");
  const settlementGate = source.indexOf("assertAllFeatureSettlementIntegrity();");
  const generate = source.indexOf("if (!existsSync(ALL_FEATURE_JSON))");
  const readReport = source.indexOf("const allFeature = readVerified<AllFeatureReport>(");

  assert.ok(metricGate >= 0, "metric-basis gate must exist");
  assert.ok(settlementGate > metricGate, "settlement gate must run after source metric-basis validation");
  assert.ok(generate > settlementGate, "settlement gate must run before all-feature report generation");
  assert.ok(readReport > settlementGate, "settlement gate must run before an existing report can drive persona verdicts");
});

test("ROI persona review verifies research inputs before reading", () => {
  assert.match(source, /ROI_PERSONA_REVIEW_ALL_FEATURE_SOURCE_IDENTITY_INVALID/);
  assert.match(source, /ROI_PERSONA_REVIEW_ALL_FEATURE_IDENTITY_INVALID/);

  const requiredHelper = source.indexOf("function readRequiredText(");
  const requiredIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(path, identityErrorCode)", requiredHelper);
  const requiredRead = source.indexOf('readFileSync(verifiedPath, "utf8")', requiredIdentity);
  assert.ok(requiredHelper >= 0 && requiredIdentity > requiredHelper && requiredRead > requiredIdentity);

  const reportHelper = source.indexOf("function readVerified<T>(");
  const reportIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(path, identityErrorCode)", reportHelper);
  const reportRead = source.indexOf('readFileSync(verifiedPath, "utf8")', reportIdentity);
  assert.ok(reportHelper >= 0 && reportIdentity > reportHelper && reportRead > reportIdentity);
});

test("ROI persona review validates existing outputs and publishes atomically", () => {
  const preflightJson = source.indexOf("verifyExistingOutput(OUT_JSON");
  const preflightMd = source.indexOf("verifyExistingOutput(OUT_MD");
  const jsonPublish = source.indexOf("atomicPublish(\n  OUT_JSON");
  const mdPublish = source.indexOf("atomicPublish(\n  OUT_MD");
  assert.ok(preflightJson >= 0 && preflightMd > preflightJson && jsonPublish > preflightMd && mdPublish > jsonPublish);

  const create = source.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, identityErrorCode)", fsync);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", identity);
  assert.ok(create >= 0 && fsync > create && identity > fsync && rename > identity);
  assert.match(source, /ROI_PERSONA_REVIEW_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /ROI_PERSONA_REVIEW_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
});
