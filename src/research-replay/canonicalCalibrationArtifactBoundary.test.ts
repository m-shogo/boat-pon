import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-canonical-calibration.ts", "utf8");

test("canonical calibration preflights parent and complete destination set before publication", () => {
  const publishStart = source.indexOf('mkdirSync("reports", { recursive: true })');
  const publishEnd = source.indexOf("console.log(`[canonical-calibration] wrote");
  assert.ok(publishStart >= 0 && publishEnd > publishStart);

  const publish = source.slice(publishStart, publishEnd);
  const parentPreflight = publish.indexOf("CANONICAL_CALIBRATION_REPORTS_DIRECTORY_IDENTITY_INVALID");
  const preflightJson = publish.indexOf("verifyExistingOutput(OUT_JSON");
  const preflightMd = publish.indexOf("verifyExistingOutput(OUT_MD");
  const firstPublish = publish.indexOf("atomicPublish(");

  assert.ok(parentPreflight >= 0, "canonical reports parent must be verified");
  assert.ok(preflightJson > parentPreflight, "JSON destination must be checked after parent identity");
  assert.ok(preflightMd > parentPreflight, "Markdown destination must be checked after parent identity");
  assert.ok(firstPublish > preflightJson && firstPublish > preflightMd, "both destinations must be checked before first publication");
});

test("canonical calibration atomic publication rechecks parent immediately before rename", () => {
  const atomicStart = source.indexOf("function atomicPublish(");
  const atomicEnd = source.indexOf("function assertNonblankResultIntegrity(", atomicStart);
  assert.ok(atomicStart >= 0 && atomicEnd > atomicStart);

  const atomic = source.slice(atomicStart, atomicEnd);
  const parentPreflight = atomic.indexOf("CANONICAL_CALIBRATION_PUBLISH_PARENT_IDENTITY_INVALID");
  const tempOpen = atomic.indexOf('openSync(tempPath, "wx"');
  const destinationCheck = atomic.indexOf("assertCanonicalSingleLinkRegularFile(path, destinationIdentityErrorCode)");
  const parentHandoff = atomic.indexOf("CANONICAL_CALIBRATION_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID");
  const rename = atomic.indexOf("renameSync(verifiedTempPath, path)");

  assert.ok(parentPreflight >= 0 && parentPreflight < tempOpen, "parent must be verified before temp creation");
  assert.ok(destinationCheck > tempOpen, "destination must be rechecked after durable temp creation");
  assert.ok(parentHandoff > destinationCheck, "parent handoff must follow destination recheck");
  assert.ok(rename > parentHandoff, "rename must happen only after parent handoff verification");
});
