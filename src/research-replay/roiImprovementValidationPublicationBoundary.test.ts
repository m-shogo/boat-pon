import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-roi-improvement-validation.ts", "utf8");

test("ROI improvement validation publishes reports through exclusive atomic destinations", () => {
  assert.match(source, /openSync\(tempPath, "wx", 0o600\)/);
  assert.match(source, /fsyncSync\(fd\)/);
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(\s*tempPath,/);
  assert.match(source, /if \(existsSync\(path\)\) \{/);
  assert.match(source, /ROI_IMPROVEMENT_VALIDATION_\$\{code\}_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(source, /renameSync\(verifiedTempPath, path\)/);
  assert.match(source, /atomicPublish\(OUT_MD, md, "MD"\)/);
  assert.match(source, /atomicPublish\(OUT_JSON, JSON\.stringify\(json, null, 2\), "JSON"\)/);
  assert.doesNotMatch(source, /writeFileSync\(OUT_MD/);
  assert.doesNotMatch(source, /writeFileSync\(OUT_JSON/);

  const exclusiveOpen = source.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = source.indexOf("fsyncSync(fd)");
  const tempIdentity = source.indexOf("const verifiedTempPath = assertCanonicalSingleLinkRegularFile");
  const destinationIdentity = source.indexOf("if (existsSync(path))");
  const rename = source.indexOf("renameSync(verifiedTempPath, path)");
  assert.ok(exclusiveOpen >= 0 && fsync > exclusiveOpen && tempIdentity > fsync && destinationIdentity > tempIdentity && rename > destinationIdentity);
});
