import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-wind-direction-by-venue.ts", "utf8");

test("wind-direction report preflights parent and complete destination set before publication", () => {
  const publishStart = source.indexOf('mkdirSync("reports", { recursive: true })');
  const publishEnd = source.indexOf("console.log(`[wind-direction] rows=");
  assert.ok(publishStart >= 0 && publishEnd > publishStart);

  const publish = source.slice(publishStart, publishEnd);
  const parentPreflight = publish.indexOf("WIND_DIRECTION_REPORTS_DIRECTORY_IDENTITY_INVALID");
  const preflightMd = publish.indexOf("verifyExistingOutput(OUT_MD");
  const preflightJson = publish.indexOf("verifyExistingOutput(OUT_JSON");
  const firstPublish = publish.indexOf("atomicPublish(");

  assert.ok(parentPreflight >= 0, "canonical reports parent must be verified");
  assert.ok(preflightMd > parentPreflight, "Markdown destination must be checked after parent identity");
  assert.ok(preflightJson > parentPreflight, "JSON destination must be checked after parent identity");
  assert.ok(firstPublish > preflightMd && firstPublish > preflightJson, "both destinations must be checked before first publication");
});

test("wind-direction atomic publication rechecks parent immediately before rename", () => {
  const atomicStart = source.indexOf("function atomicPublish(");
  assert.ok(atomicStart >= 0);
  const atomic = source.slice(atomicStart);
  const parentPreflight = atomic.indexOf("WIND_DIRECTION_PUBLISH_PARENT_IDENTITY_INVALID");
  const tempOpen = atomic.indexOf('openSync(tempPath, "wx"');
  const destinationCheck = atomic.indexOf("assertCanonicalSingleLinkRegularFile(path, destinationIdentityErrorCode)");
  const parentHandoff = atomic.indexOf("WIND_DIRECTION_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID");
  const rename = atomic.indexOf("renameSync(verifiedTempPath, path)");

  assert.ok(parentPreflight >= 0 && parentPreflight < tempOpen, "parent must be verified before temp creation");
  assert.ok(destinationCheck > tempOpen, "destination must be rechecked after durable temp creation");
  assert.ok(parentHandoff > destinationCheck, "parent handoff must follow destination recheck");
  assert.ok(rename > parentHandoff, "rename must happen only after parent handoff verification");
});
