import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/search-roi-patterns.ts", "utf8");
const raw = readFileSync("scripts/search-roi-patterns-raw.ts", "utf8");

test("ROI pattern entrypoint revalidates DB identity after settlement preflight and before isolated analysis", () => {
  const close = entrypoint.indexOf("db.close()");
  const handoff = entrypoint.indexOf("ROI_PATTERN_DB_HANDOFF_IDENTITY_INVALID");
  const childHandoff = entrypoint.indexOf("ROI_PATTERN_DB_CHILD_HANDOFF_IDENTITY_INVALID", handoff);
  const workspace = entrypoint.indexOf("mkdtempSync(", childHandoff);
  const isolatedHandoff = entrypoint.indexOf("ROI_PATTERN_DB_ISOLATED_CHILD_HANDOFF_IDENTITY_INVALID", workspace);
  const analysis = entrypoint.indexOf("const analysis = spawnSync", isolatedHandoff);

  assert.ok(close >= 0);
  assert.ok(handoff > close, "DB identity must be revalidated after the settlement preflight DB closes");
  assert.ok(childHandoff > handoff, "DB identity must be reverified at child handoff");
  assert.ok(workspace > childHandoff, "isolated workspace must be created after canonical child handoff");
  assert.ok(isolatedHandoff > workspace, "DB identity must be reverified immediately before isolated execution");
  assert.ok(analysis > isolatedHandoff, "internal analyzer must start only after isolated DB handoff revalidation");
  assert.match(entrypoint, /BOAT_PON_DB_PATH: isolatedDbPath/);
  assert.doesNotMatch(entrypoint, /process\.env\.BOAT_PON_DB_PATH =/);
  assert.doesNotMatch(entrypoint, /await import\("\.\/search-roi-patterns-internal"\)/);
  assert.doesNotMatch(entrypoint, /search-roi-patterns-raw/);
});

test("ROI pattern entrypoint verifies isolated reports before atomic publication", () => {
  const analysis = entrypoint.indexOf("const analysis = spawnSync");
  const mdIdentity = entrypoint.indexOf("ROI_PATTERN_MD_OUTPUT_IDENTITY_INVALID", analysis);
  const jsonIdentity = entrypoint.indexOf("ROI_PATTERN_JSON_OUTPUT_IDENTITY_INVALID", analysis);
  const mdRead = entrypoint.indexOf('readFileSync(verifiedMdPath, "utf8")', mdIdentity);
  const jsonRead = entrypoint.indexOf('readFileSync(verifiedJsonPath, "utf8")', jsonIdentity);
  const redaction = entrypoint.indexOf('.split(isolatedDbPath)', mdRead);
  const tempCreate = entrypoint.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = entrypoint.indexOf("fsyncSync(fd)", tempCreate);
  const tempIdentity = entrypoint.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, errorCode)", fsync);
  const rename = entrypoint.indexOf("renameSync(verifiedTempPath, path)", tempIdentity);
  const mdPublish = entrypoint.indexOf("ROI_PATTERN_MD_PUBLISH_TEMP_IDENTITY_INVALID", mdRead);
  const jsonPublish = entrypoint.indexOf("ROI_PATTERN_JSON_PUBLISH_TEMP_IDENTITY_INVALID", jsonRead);

  assert.ok(mdIdentity > analysis && jsonIdentity > analysis, "isolated reports must be identity-verified after analysis");
  assert.ok(mdRead > mdIdentity && jsonRead > jsonIdentity, "reports must not be read before identity verification");
  assert.ok(redaction > mdRead, "DB filesystem provenance must be redacted before publication");
  assert.ok(tempCreate >= 0 && fsync > tempCreate && tempIdentity > fsync && rename > tempIdentity, "publication must use exclusive, durable, verified atomic replacement");
  assert.ok(mdPublish > mdRead && jsonPublish > jsonRead, "both reports must publish through the atomic writer");
  assert.match(entrypoint, /ROI_PATTERN_MD_OUTPUT_MISSING/);
  assert.match(entrypoint, /ROI_PATTERN_JSON_OUTPUT_MISSING/);
  assert.match(entrypoint, /rmSync\(workspace, \{ recursive: true, force: true \}\)/);
});

test("ROI pattern guarded raw compatibility module routes through canonical DB and settlement preflight", () => {
  const canonical = raw.indexOf('await import("./search-roi-patterns")');

  assert.ok(canonical >= 0);
  assert.match(raw, /ROI_PATTERN_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.doesNotMatch(raw, /ROI_PATTERN_DB_IDENTITY_INVALID/);
  assert.doesNotMatch(raw, /ROI_PATTERN_DB_MISSING/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(raw, /assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(raw, /search-roi-patterns-internal/);
});
