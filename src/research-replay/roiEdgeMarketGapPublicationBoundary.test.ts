import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-roi-edge-market-gap.ts", "utf8");

test("market-gap publication revalidates an existing destination immediately before atomic rename", () => {
  const helperStart = source.indexOf("function atomicPublish(");
  const preflightStart = source.indexOf('const preflight = run(', helperStart);
  assert.notEqual(helperStart, -1);
  assert.notEqual(preflightStart, -1);
  const helper = source.slice(helperStart, preflightStart);

  const tempIdentity = helper.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, errorCode)");
  const destinationIdentity = helper.indexOf("assertExistingOutputIdentity(path, destinationErrorCode)");
  const rename = helper.indexOf("renameSync(verifiedTempPath, path)");

  assert.ok(tempIdentity >= 0);
  assert.ok(tempIdentity < destinationIdentity);
  assert.ok(destinationIdentity < rename);
});

test("market-gap canonical report publications provide dedicated destination identity error codes", () => {
  assert.match(source, /ROI_EDGE_MARKET_GAP_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /ROI_EDGE_MARKET_GAP_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
});
