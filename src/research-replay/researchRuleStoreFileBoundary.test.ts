import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/manage-research-rules.ts", "utf8");

test("research rule store is identity-verified before parsing", () => {
  const identity = source.indexOf("RESEARCH_RULE_STORE_IDENTITY_INVALID");
  const read = source.indexOf("readFileSync(verifiedStorePath, \"utf8\")");

  assert.ok(identity >= 0, "rule store identity guard must exist");
  assert.ok(read > identity, "rule store must only be parsed after identity verification");
  assert.doesNotMatch(source, /readFileSync\(STORE_PATH/);
});

test("research rule evaluation input is identity-verified and missing diagnostics stay opaque", () => {
  const identity = source.indexOf("RESEARCH_RULE_EVALUATION_IDENTITY_INVALID");
  const read = source.indexOf("readFileSync(verifiedEvaluationPath, \"utf8\")");

  assert.ok(identity >= 0, "evaluation identity guard must exist");
  assert.ok(read > identity, "evaluation JSON must only be parsed after identity verification");
  assert.match(source, /console\.error\("evaluation file not found"\)/);
  assert.doesNotMatch(source, /evaluation file not found: \$\{evaluationFile\}/);
});

test("research rule store publication uses exclusive fsynced temp plus atomic rename", () => {
  const tempCreate = source.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = source.indexOf("fsyncSync(fd)");
  const tempIdentity = source.indexOf("RESEARCH_RULE_STORE_TEMP_IDENTITY_INVALID");
  const destinationIdentity = source.lastIndexOf("RESEARCH_RULE_STORE_TARGET_IDENTITY_INVALID");
  const rename = source.indexOf("renameSync(tempPath, STORE_PATH)");

  assert.ok(tempCreate >= 0, "publication must use an exclusive temp file");
  assert.ok(fsync > tempCreate, "temp file must be fsynced after creation");
  assert.ok(tempIdentity > fsync, "temp identity must be verified after durable write");
  assert.ok(destinationIdentity > tempIdentity, "existing store destination must be revalidated after temp identity");
  assert.ok(rename > destinationIdentity, "publication must rename only after destination revalidation");
  assert.doesNotMatch(source, /writeFileSync\(STORE_PATH/);
});
