import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entry = readFileSync("scripts/audit-all-bet-type-data-feasibility.ts", "utf8");
const internal = readFileSync("scripts/audit-all-bet-type-data-feasibility-internal.ts", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

test("all-bet-type feasibility audit verifies DB identity before isolated legacy analysis", () => {
  const missing = entry.indexOf("ALL_BET_TYPE_FEASIBILITY_RESEARCH_DB_UNAVAILABLE");
  const identity = entry.indexOf("ALL_BET_TYPE_FEASIBILITY_DB_IDENTITY_INVALID");
  const childIdentity = entry.indexOf("ALL_BET_TYPE_FEASIBILITY_DB_CHILD_HANDOFF_IDENTITY_INVALID");
  const workspace = entry.indexOf('mkdtempSync(join(tmpdir(), "boat-pon-all-bet-type-feasibility-"))');
  const childLaunch = entry.indexOf("spawnSync(process.execPath");

  assert.ok(missing >= 0);
  assert.ok(identity > missing);
  assert.ok(childIdentity > identity);
  assert.ok(workspace > childIdentity);
  assert.ok(childLaunch > workspace);
  assert.match(entry, /cwd: workspace/);
  assert.match(entry, /BOAT_PON_DB_PATH: childDbPath/);
  assert.doesNotMatch(entry, /await import\("\.\/audit-all-bet-type-data-feasibility-internal"\)/);
});

test("all-bet-type feasibility persisted DB provenance is fail-closed and opaque", () => {
  assert.match(entry, /parsed\.safety\.dbPath = OPAQUE_DB_SOURCE/);
  assert.match(entry, /sanitizedJson\.includes\(childDbPath\)/);
  assert.match(entry, /markdown\.replaceAll\(childDbPath, OPAQUE_DB_SOURCE\)/);
  assert.match(entry, /sanitizedMarkdown\.includes\(childDbPath\)/);
  assert.doesNotMatch(entry, /`DB not found: \$\{configuredDbPath\}`/);
});

test("all-bet-type feasibility validates both staged reports before canonical atomic publication", () => {
  const childLaunch = entry.indexOf("spawnSync(process.execPath");
  const jsonIdentity = entry.indexOf("ALL_BET_TYPE_FEASIBILITY_JSON_STAGED_OUTPUT_IDENTITY_INVALID");
  const markdownIdentity = entry.indexOf("ALL_BET_TYPE_FEASIBILITY_MARKDOWN_STAGED_OUTPUT_IDENTITY_INVALID");
  const jsonReadIdentity = entry.indexOf("ALL_BET_TYPE_FEASIBILITY_JSON_STAGED_READ_IDENTITY_INVALID");
  const jsonRead = entry.indexOf('readFileSync(jsonReadPath, "utf8")');
  const jsonHandoffIdentity = entry.indexOf("ALL_BET_TYPE_FEASIBILITY_JSON_STAGED_HANDOFF_IDENTITY_INVALID");
  const markdownReadIdentity = entry.indexOf("ALL_BET_TYPE_FEASIBILITY_MARKDOWN_STAGED_READ_IDENTITY_INVALID");
  const markdownRead = entry.indexOf('readFileSync(markdownReadPath, "utf8")');
  const markdownHandoffIdentity = entry.indexOf("ALL_BET_TYPE_FEASIBILITY_MARKDOWN_STAGED_HANDOFF_IDENTITY_INVALID");
  const jsonPublish = entry.indexOf("ALL_BET_TYPE_FEASIBILITY_JSON_PUBLISH_TEMP_IDENTITY_INVALID");
  const jsonPublishDestination = entry.indexOf("ALL_BET_TYPE_FEASIBILITY_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID");
  const markdownPublish = entry.indexOf("ALL_BET_TYPE_FEASIBILITY_MARKDOWN_PUBLISH_TEMP_IDENTITY_INVALID");
  const markdownPublishDestination = entry.indexOf("ALL_BET_TYPE_FEASIBILITY_MARKDOWN_PUBLISH_DESTINATION_IDENTITY_INVALID");

  assert.ok(jsonIdentity > childLaunch);
  assert.ok(markdownIdentity > jsonIdentity);
  assert.ok(jsonReadIdentity > markdownIdentity, "both staged output identities must be known before staged content is read");
  assert.ok(jsonRead > jsonReadIdentity);
  assert.ok(jsonHandoffIdentity > jsonRead);
  assert.ok(markdownReadIdentity > jsonHandoffIdentity);
  assert.ok(markdownRead > markdownReadIdentity);
  assert.ok(markdownHandoffIdentity > markdownRead);
  assert.ok(jsonPublish > markdownHandoffIdentity, "canonical JSON publication must wait for both staged artifacts to validate");
  assert.ok(jsonPublishDestination > jsonPublish);
  assert.ok(markdownPublish > jsonPublishDestination);
  assert.ok(markdownPublishDestination > markdownPublish);

  assert.match(entry, /join\(workspace, REPORT_JSON\)/);
  assert.match(entry, /join\(workspace, REPORT_MD\)/);
  assert.match(entry, /openSync\(tempPath, "wx", 0o600\)/);
  assert.match(entry, /writeFileSync\(fd, contents, "utf8"\);\s*fsyncSync\(fd\);/u);
  assert.match(entry, /assertCanonicalSingleLinkRegularFile\(tempPath, tempErrorCode\);\s*verifyExistingOutput\(path, destinationErrorCode\);\s*renameSync\(verifiedTempPath, path\);/u);
  assert.match(entry, /atomicPublish\(\s*REPORT_JSON,\s*sanitizedJson,[\s\S]*?JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(entry, /atomicPublish\(\s*REPORT_MD,\s*sanitizedMarkdown,[\s\S]*?MARKDOWN_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.doesNotMatch(entry, /writeFileSync\(REPORT_(?:JSON|MD)/);
});

test("legacy feasibility implementation stays read-only and is not the npm entrypoint", () => {
  assert.match(internal, /new DatabaseSync\(DB_PATH, \{ readOnly: true \}\)/);
  assert.match(internal, /PRAGMA query_only=ON/);
  assert.doesNotMatch(internal, /db\.(?:exec|prepare)\(\s*[`\"']\s*(?:INSERT|UPDATE|DELETE|DROP)\b/i);
  assert.equal(pkg.scripts?.["audit:all-bet-type-feasibility"], "tsx scripts/audit-all-bet-type-data-feasibility.ts");
  assert.notEqual(pkg.scripts?.["audit:all-bet-type-feasibility"], "tsx scripts/audit-all-bet-type-data-feasibility-internal.ts");
});
