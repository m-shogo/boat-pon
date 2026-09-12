import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/run-roi-master-review.ts", "utf8");

test("ROI master review verifies every existing input before read", () => {
  assert.match(source, /ROI_MASTER_REVIEW_INPUT_IDENTITY_INVALID/u);
  assert.match(source, /const verifiedPath = assertCanonicalSingleLinkRegularFile\(path,/u);
  assert.match(source, /JSON\.parse\(readFileSync\(verifiedPath, "utf8"\)\)/u);
  assert.doesNotMatch(source, /JSON\.parse\(readFileSync\(path, "utf8"\)\)/u);
});

test("ROI master review revalidates existing destinations before atomic replacement", () => {
  assert.match(source, /ROI_MASTER_REVIEW_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /ROI_MASTER_REVIEW_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /ROI_MASTER_REVIEW_MD_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /ROI_MASTER_REVIEW_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  const create = source.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)", fsync);
  const destinationGuard = source.indexOf("if (existsSync(path))", tempIdentity);
  const destinationIdentity = source.indexOf(
    "assertCanonicalSingleLinkRegularFile(path, destinationErrorCode)",
    destinationGuard,
  );
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", destinationIdentity);
  assert.ok(
    create >= 0 &&
      fsync > create &&
      tempIdentity > fsync &&
      destinationGuard > tempIdentity &&
      destinationIdentity > destinationGuard &&
      rename > destinationIdentity,
  );
  assert.doesNotMatch(source, /writeFileSync\(OUT_JSON,/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_MD,/u);
});
