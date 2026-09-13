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
  const launchHandoff = entrypoint.indexOf("ROI_PATTERN_DB_CHILD_LAUNCH_IDENTITY_INVALID", isolatedHandoff);
  const analysis = entrypoint.indexOf("const analysis = spawnSync", launchHandoff);

  assert.ok(close >= 0);
  assert.ok(handoff > close, "DB identity must be revalidated after the settlement preflight DB closes");
  assert.ok(childHandoff > handoff, "DB identity must be reverified at child handoff");
  assert.ok(workspace > childHandoff, "isolated workspace must be created after canonical child handoff");
  assert.ok(isolatedHandoff > workspace, "DB identity must be reverified after isolated workspace creation");
  assert.ok(launchHandoff > isolatedHandoff, "DB identity must be reverified immediately before isolated child launch");
  assert.ok(analysis > launchHandoff, "internal analyzer must start only after launch-time DB handoff revalidation");
  assert.match(entrypoint, /BOAT_PON_DB_PATH: launchDbPath/);
  assert.doesNotMatch(entrypoint, /BOAT_PON_DB_PATH: isolatedDbPath/);
  assert.doesNotMatch(entrypoint, /process\.env\.BOAT_PON_DB_PATH =/);
  assert.doesNotMatch(entrypoint, /await import\("\.\/search-roi-patterns-internal"\)/);
  assert.doesNotMatch(entrypoint, /search-roi-patterns-raw/);
});

test("ROI pattern entrypoint revalidates staged reports across read and publication handoff", () => {
  const analysis = entrypoint.indexOf("const analysis = spawnSync");
  const mdIdentity = entrypoint.indexOf("ROI_PATTERN_MD_OUTPUT_IDENTITY_INVALID", analysis);
  const jsonIdentity = entrypoint.indexOf("ROI_PATTERN_JSON_OUTPUT_IDENTITY_INVALID", analysis);
  const mdReadIdentity = entrypoint.indexOf("ROI_PATTERN_MD_READ_IDENTITY_INVALID", jsonIdentity);
  const jsonReadIdentity = entrypoint.indexOf("ROI_PATTERN_JSON_READ_IDENTITY_INVALID", mdReadIdentity);
  const mdRead = entrypoint.indexOf('readFileSync(mdReadPath, "utf8")', mdReadIdentity);
  const jsonRead = entrypoint.indexOf('readFileSync(jsonReadPath, "utf8")', jsonReadIdentity);
  const redaction = entrypoint.indexOf('.split(launchDbPath)', mdRead);
  const provenance = entrypoint.indexOf("ROI_PATTERN_PRIVATE_DB_PROVENANCE_REMAINED", jsonRead);
  const mdHandoff = entrypoint.indexOf("ROI_PATTERN_MD_HANDOFF_IDENTITY_INVALID", provenance);
  const jsonHandoff = entrypoint.indexOf("ROI_PATTERN_JSON_HANDOFF_IDENTITY_INVALID", mdHandoff);
  const tempCreate = entrypoint.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = entrypoint.indexOf("fsyncSync(fd)", tempCreate);
  const tempIdentity = entrypoint.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)", fsync);
  const destinationCheck = entrypoint.indexOf("if (existsSync(path))", tempIdentity);
  const destinationIdentity = entrypoint.indexOf("assertCanonicalSingleLinkRegularFile(path, destinationErrorCode)", destinationCheck);
  const rename = entrypoint.indexOf("renameSync(verifiedTempPath, path)", destinationIdentity);
  const mdPublish = entrypoint.indexOf("ROI_PATTERN_MD_PUBLISH_TEMP_IDENTITY_INVALID", jsonHandoff);
  const jsonPublish = entrypoint.indexOf("ROI_PATTERN_JSON_PUBLISH_TEMP_IDENTITY_INVALID", mdPublish);

  assert.ok(mdIdentity > analysis && jsonIdentity > mdIdentity, "both staged reports must be identity-verified before reads begin");
  assert.ok(mdReadIdentity > jsonIdentity && jsonReadIdentity > mdReadIdentity, "each staged path must be reverified immediately before read");
  assert.ok(mdRead > mdReadIdentity && jsonRead > jsonReadIdentity, "reports must be read only through read-verified paths");
  assert.ok(redaction > mdRead, "DB filesystem provenance must be redacted before publication");
  assert.ok(provenance > jsonRead, "redacted outputs must fail closed if private DB provenance remains");
  assert.ok(mdHandoff > provenance && jsonHandoff > mdHandoff, "staged artifacts must be reverified after reads before canonical publication");
  assert.ok(
    tempCreate >= 0
      && fsync > tempCreate
      && tempIdentity > fsync
      && destinationCheck > tempIdentity
      && destinationIdentity > destinationCheck
      && rename > destinationIdentity,
    "publication must use exclusive durable temp output and reverify any existing canonical destination before replacement",
  );
  assert.ok(mdPublish > jsonHandoff && jsonPublish > mdPublish, "both reports must publish only after staged handoff revalidation");
  assert.match(entrypoint, /markdown\.includes\(launchDbPath\) \|\| json\.includes\(launchDbPath\)/);
  assert.match(entrypoint, /ROI_PATTERN_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(entrypoint, /ROI_PATTERN_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/);
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
