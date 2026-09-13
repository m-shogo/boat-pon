import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-one-four-structure.ts", "utf8");
const raw = readFileSync("scripts/analyze-one-four-structure-raw.ts", "utf8");
const internal = readFileSync("scripts/analyze-one-four-structure-internal.ts", "utf8");

test("one-four canonical entrypoint revalidates DB after payout audit and immediately before isolated internal analysis", () => {
  const audit = entrypoint.indexOf("audit !== 0");
  const handoffIdentity = entrypoint.indexOf("ONE_FOUR_STRUCTURE_DB_HANDOFF_IDENTITY_INVALID");
  const childIdentity = entrypoint.indexOf("ONE_FOUR_STRUCTURE_DB_CHILD_HANDOFF_IDENTITY_INVALID", handoffIdentity);
  const workspace = entrypoint.indexOf("mkdtempSync(", childIdentity);
  const launchIdentity = entrypoint.indexOf("ONE_FOUR_STRUCTURE_DB_CHILD_LAUNCH_IDENTITY_INVALID", workspace);
  const internalRun = entrypoint.indexOf("const analysis = spawnSync", launchIdentity);

  assert.ok(audit >= 0);
  assert.ok(handoffIdentity > audit, "DB identity must be revalidated only after payout audit passes");
  assert.ok(childIdentity > handoffIdentity, "DB identity must be revalidated for child handoff");
  assert.ok(workspace > childIdentity, "isolated workspace must be created only after child handoff verification");
  assert.ok(launchIdentity > workspace, "DB identity must be revalidated again after workspace setup");
  assert.ok(internalRun > launchIdentity, "internal analyzer must run only after launch-time verified DB handoff");
  assert.match(entrypoint, /ONE_FOUR_STRUCTURE_DB_MISSING/);
  assert.match(entrypoint, /BOAT_PON_DB_PATH: launchDbPath/);
  assert.doesNotMatch(entrypoint, /process\.env\.BOAT_PON_DB_PATH = handoffDbPath/);
  assert.doesNotMatch(entrypoint, /process\.env\.BOAT_PON_DB_PATH = childDbPath/);
  assert.doesNotMatch(entrypoint, /await import\("\.\/analyze-one-four-structure-internal"\)/);
  assert.doesNotMatch(entrypoint, /analyze-one-four-structure-raw/);
});

test("one-four canonical entrypoint isolates legacy writes and preflights the complete paired destination set before publication", () => {
  const workspace = entrypoint.indexOf("mkdtempSync(");
  const internalRun = entrypoint.indexOf("const analysis = spawnSync", workspace);
  const mdWorkspaceIdentity = entrypoint.indexOf("ONE_FOUR_STRUCTURE_MD_WORKSPACE_OUTPUT_IDENTITY_INVALID", internalRun);
  const jsonWorkspaceIdentity = entrypoint.indexOf("ONE_FOUR_STRUCTURE_JSON_WORKSPACE_OUTPUT_IDENTITY_INVALID", internalRun);
  const mdRead = entrypoint.indexOf('readFileSync(workspaceMd, "utf8")', mdWorkspaceIdentity);
  const jsonRead = entrypoint.indexOf('readFileSync(workspaceJson, "utf8")', jsonWorkspaceIdentity);
  const reportsIdentity = entrypoint.indexOf("ONE_FOUR_STRUCTURE_REPORTS_DIRECTORY_IDENTITY_INVALID", jsonRead);
  const mdPreflight = entrypoint.indexOf("ONE_FOUR_STRUCTURE_MD_PREEXISTING_IDENTITY_INVALID", reportsIdentity);
  const jsonPreflight = entrypoint.indexOf("ONE_FOUR_STRUCTURE_JSON_PREEXISTING_IDENTITY_INVALID", mdPreflight);
  const firstPublish = entrypoint.indexOf("atomicPublish(", jsonPreflight);

  assert.ok(internalRun > workspace, "legacy analyzer must run inside the isolated workspace");
  assert.ok(mdWorkspaceIdentity > internalRun && jsonWorkspaceIdentity > internalRun, "workspace outputs must be verified before reads");
  assert.ok(mdRead > mdWorkspaceIdentity && jsonRead > jsonWorkspaceIdentity, "workspace outputs must be read only after verification");
  assert.ok(reportsIdentity > jsonRead, "canonical reports directory must be verified only after staged outputs are complete");
  assert.ok(mdPreflight > reportsIdentity && jsonPreflight > mdPreflight, "both canonical destinations must be preflighted together");
  assert.ok(firstPublish > jsonPreflight, "no canonical replacement may start before the complete paired destination preflight");
  assert.match(entrypoint, /cwd: workspace/);
  assert.match(entrypoint, /ONE_FOUR_STRUCTURE_INTERNAL_FAILED/);
});

test("one-four publication revalidates destination and parent handoff before atomic rename", () => {
  const helper = entrypoint.indexOf("function atomicPublish(");
  const parentIdentity = entrypoint.indexOf("ONE_FOUR_STRUCTURE_PUBLISH_PARENT_IDENTITY_INVALID", helper);
  const tempCreate = entrypoint.indexOf('openSync(tempPath, "wx", 0o600)', parentIdentity);
  const fsync = entrypoint.indexOf("fsyncSync(fd)", tempCreate);
  const tempIdentity = entrypoint.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)", fsync);
  const destinationGuard = entrypoint.indexOf("if (existsSync(path))", tempIdentity);
  const destinationIdentity = entrypoint.indexOf("assertCanonicalSingleLinkRegularFile(path, destinationErrorCode)", destinationGuard);
  const parentHandoff = entrypoint.indexOf("ONE_FOUR_STRUCTURE_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
  const rename = entrypoint.indexOf("renameSync(verifiedTempPath, path)", parentHandoff);
  const outputMissing = entrypoint.indexOf("ONE_FOUR_STRUCTURE_OUTPUT_MISSING");
  const mdPostflight = entrypoint.indexOf("ONE_FOUR_STRUCTURE_MD_OUTPUT_IDENTITY_INVALID", outputMissing);
  const jsonPostflight = entrypoint.indexOf("ONE_FOUR_STRUCTURE_JSON_OUTPUT_IDENTITY_INVALID", outputMissing);

  assert.ok(parentIdentity > helper && tempCreate > parentIdentity && fsync > tempCreate);
  assert.ok(tempIdentity > fsync && destinationGuard > tempIdentity && destinationIdentity > destinationGuard);
  assert.ok(parentHandoff > destinationIdentity && rename > parentHandoff, "destination and parent handoff must precede atomic rename");
  assert.ok(mdPostflight > outputMissing && jsonPostflight > outputMissing, "published outputs must be canonical single-link files before success");
  assert.match(entrypoint, /ONE_FOUR_STRUCTURE_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(entrypoint, /ONE_FOUR_STRUCTURE_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(entrypoint, /ONE_FOUR_STRUCTURE_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(entrypoint, /ONE_FOUR_STRUCTURE_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(entrypoint, /if \(existsSync\(path\)\) \{\s*assertCanonicalSingleLinkRegularFile\(path, destinationErrorCode\);\s*\}/s);
});

test("one-four guarded raw compatibility module cannot bypass canonical payout audit", () => {
  assert.match(raw, /ONE_FOUR_STRUCTURE_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/analyze-one-four-structure"\)/);
  assert.doesNotMatch(raw, /analyze-one-four-structure-internal/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(raw, /DatabaseSync/);
});

test("one-four internal verifies canonical DB identity and enables query_only before analysis", () => {
  const identity = internal.indexOf("ONE_FOUR_STRUCTURE_DB_IDENTITY_INVALID");
  const open = internal.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  const queryOnly = internal.indexOf("PRAGMA query_only = ON");
  const firstQuery = internal.indexOf("db.prepare(");

  assert.match(internal, /assertCanonicalSingleLinkRegularFile/u);
  assert.ok(identity >= 0, "internal DB identity error code must exist");
  assert.ok(open > identity, "internal must verify DB identity before SQLite open");
  assert.ok(queryOnly > open, "internal must enable query_only after read-only open");
  assert.ok(firstQuery > queryOnly, "internal must enable query_only before analysis queries");
  assert.doesNotMatch(internal, /DB not found: \$\{DB_PATH\}/u);
  assert.doesNotMatch(internal, /new DatabaseSync\(DB_PATH, \{ readOnly: true \}\)/u);
});
