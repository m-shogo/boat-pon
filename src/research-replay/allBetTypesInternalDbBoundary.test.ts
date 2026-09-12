import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const wrapper = readFileSync("scripts/analyze-all-bet-types-roi.ts", "utf8");
const raw = readFileSync("scripts/analyze-all-bet-types-roi-raw.ts", "utf8");

test("all-bet-types canonical analyzer revalidates the DB immediately before isolated internal execution", () => {
  assert.match(wrapper, /ALL_BET_TYPES_ROI_DB_HANDOFF_IDENTITY_INVALID/);
  assert.match(wrapper, /ALL_BET_TYPES_ROI_DB_CHILD_HANDOFF_IDENTITY_INVALID/);
  assert.match(wrapper, /ALL_BET_TYPES_ROI_DB_CHILD_LAUNCH_IDENTITY_INVALID/);
  assert.match(wrapper, /assertCanonicalSingleLinkRegularFile\(/);
  assert.match(wrapper, /BOAT_PON_DB_PATH: launchDbPath/);
  assert.doesNotMatch(wrapper, /process\.env\.BOAT_PON_DB_PATH = childDbPath/);
  assert.doesNotMatch(wrapper, /BOAT_PON_DB_PATH: childDbPath/);

  const gate = wrapper.indexOf("audit !== 0");
  const identityRecheck = wrapper.indexOf("ALL_BET_TYPES_ROI_DB_HANDOFF_IDENTITY_INVALID");
  const mdPreflight = wrapper.indexOf("ALL_BET_TYPES_ROI_MD_PREEXISTING_IDENTITY_INVALID");
  const jsonPreflight = wrapper.indexOf("ALL_BET_TYPES_ROI_JSON_PREEXISTING_IDENTITY_INVALID");
  const childHandoffIdentity = wrapper.indexOf("ALL_BET_TYPES_ROI_DB_CHILD_HANDOFF_IDENTITY_INVALID");
  const workspace = wrapper.indexOf("mkdtempSync(", childHandoffIdentity);
  const launchIdentity = wrapper.indexOf("ALL_BET_TYPES_ROI_DB_CHILD_LAUNCH_IDENTITY_INVALID", workspace);
  const internalRun = wrapper.indexOf("const analysis = spawnSync", launchIdentity);

  assert.ok(gate >= 0);
  assert.ok(identityRecheck > gate, "DB handoff identity must be verified only after payout completeness passes");
  assert.ok(mdPreflight > identityRecheck && jsonPreflight > identityRecheck, "existing output identities must be checked after the initial DB handoff");
  assert.ok(childHandoffIdentity > mdPreflight && childHandoffIdentity > jsonPreflight, "DB identity must be reverified after output-path checks and before workspace setup");
  assert.ok(workspace > childHandoffIdentity, "isolated workspace must be created only after child handoff identity verification");
  assert.ok(launchIdentity > workspace, "DB identity must be reverified after workspace setup and immediately before child launch");
  assert.ok(internalRun > launchIdentity, "internal analyzer must run only after launch-time canonical DB identity verification");
});

test("all-bet-types canonical analyzer isolates legacy writes and atomically publishes verified outputs", () => {
  const mdPreflight = wrapper.indexOf("ALL_BET_TYPES_ROI_MD_PREEXISTING_IDENTITY_INVALID");
  const jsonPreflight = wrapper.indexOf("ALL_BET_TYPES_ROI_JSON_PREEXISTING_IDENTITY_INVALID");
  const workspace = wrapper.indexOf('mkdtempSync(join(tmpdir(), "boat-pon-all-bet-types-roi-"))');
  const internalRun = wrapper.indexOf("const analysis = spawnSync", workspace);
  const mdWorkspaceIdentity = wrapper.indexOf("ALL_BET_TYPES_ROI_MD_WORKSPACE_OUTPUT_IDENTITY_INVALID", internalRun);
  const jsonWorkspaceIdentity = wrapper.indexOf("ALL_BET_TYPES_ROI_JSON_WORKSPACE_OUTPUT_IDENTITY_INVALID", internalRun);
  const mdRead = wrapper.indexOf('readFileSync(workspaceMd, "utf8")', mdWorkspaceIdentity);
  const jsonRead = wrapper.indexOf('readFileSync(workspaceJson, "utf8")', jsonWorkspaceIdentity);
  const tempCreate = wrapper.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = wrapper.indexOf("fsyncSync(fd)", tempCreate);
  const tempIdentity = wrapper.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)", fsync);
  const destinationIdentity = wrapper.indexOf("assertCanonicalSingleLinkRegularFile(path, destinationErrorCode)", tempIdentity);
  const rename = wrapper.indexOf("renameSync(verifiedTempPath, path)", destinationIdentity);
  const outputMissing = wrapper.indexOf("ALL_BET_TYPES_ROI_OUTPUT_MISSING", internalRun);
  const mdPostflight = wrapper.indexOf("ALL_BET_TYPES_ROI_MD_OUTPUT_IDENTITY_INVALID", outputMissing);
  const jsonPostflight = wrapper.indexOf("ALL_BET_TYPES_ROI_JSON_OUTPUT_IDENTITY_INVALID", outputMissing);

  assert.ok(mdPreflight >= 0 && jsonPreflight >= 0);
  assert.ok(mdPreflight < workspace && jsonPreflight < workspace, "existing report paths must be identity-checked before isolated legacy writes");
  assert.ok(internalRun > workspace, "legacy analyzer must run inside the isolated workspace");
  assert.ok(mdWorkspaceIdentity > internalRun && jsonWorkspaceIdentity > internalRun, "workspace outputs must be identity-verified before reads");
  assert.ok(mdRead > mdWorkspaceIdentity && jsonRead > jsonWorkspaceIdentity, "workspace outputs must be read only after identity verification");
  assert.ok(tempCreate >= 0 && fsync > tempCreate, "publication must use exclusive temp creation and fsync");
  assert.ok(
    tempIdentity > fsync && destinationIdentity > tempIdentity && rename > destinationIdentity,
    "temp identity and destination revalidation must precede atomic rename",
  );
  assert.ok(outputMissing > internalRun, "successful internal execution must still prove both final outputs exist");
  assert.ok(mdPostflight > outputMissing && jsonPostflight > outputMissing, "published outputs must be canonical single-link files before success");
  assert.match(wrapper, /cwd: workspace/);
  assert.match(wrapper, /stdio: \["ignore", "pipe", "pipe"\]/u);
  assert.match(wrapper, /ALL_BET_TYPES_ROI_INTERNAL_FAILED/u);
  assert.match(wrapper, /ALL_BET_TYPES_ROI_MD_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(wrapper, /ALL_BET_TYPES_ROI_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(wrapper, /ALL_BET_TYPES_ROI_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(wrapper, /ALL_BET_TYPES_ROI_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(wrapper, /if \(existsSync\(path\)\) \{\s*assertCanonicalSingleLinkRegularFile\(path, destinationErrorCode\);\s*\}/s);
  assert.match(wrapper, /atomicPublish\(\s*OUT_MD,\s*markdown,/u);
  assert.match(wrapper, /atomicPublish\(\s*OUT_JSON,\s*json,/u);
});

test("all-bet-types raw compatibility path cannot load the internal analyzer directly", () => {
  assert.match(raw, /ALL_BET_TYPES_ROI_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/analyze-all-bet-types-roi"\)/);
  assert.doesNotMatch(raw, /analyze-all-bet-types-roi-internal/);
});
