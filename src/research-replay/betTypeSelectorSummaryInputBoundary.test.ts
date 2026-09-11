import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entry = readFileSync("scripts/report-bet-type-selector-summary.ts", "utf8");
const raw = readFileSync("scripts/report-bet-type-selector-summary-raw.ts", "utf8");
const internal = readFileSync("scripts/report-bet-type-selector-summary-internal.ts", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

const requiredReports = [
  "reports/bet-type-coverage-audit.json",
  "reports/all-bet-type-screening.json",
  "reports/promising-bet-type-strategies.json",
  "reports/miss-to-bet-type-recovery.json",
  "reports/bet-type-course-edge.json",
  "reports/bet-type-risk-factors.json",
];

test("bet-type selector summary fails closed on missing, non-canonical, invalid, or point-in-time-unsafe prerequisite reports before internal summary", () => {
  for (const path of requiredReports) assert.match(entry, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(entry, /BET_TYPE_SELECTOR_INPUT_REPORT_INVALID/);
  assert.match(entry, /BET_TYPE_SELECTOR_INPUT_REPORT_IDENTITY_INVALID/);
  assert.match(entry, /assertCanonicalSingleLinkRegularFile\(\s*path,/u);
  assert.match(entry, /JSON\.parse\(readFileSync\(verifiedPath, "utf8"\)\)/);
  assert.match(entry, /parsed === null \|\| typeof parsed !== "object" \|\| Array\.isArray\(parsed\)/);
  assert.match(entry, /envelope\.safety\?\.pointInTimeSafe === false/);
  assert.match(entry, /point_in_time_unsafe/);
  const validation = entry.indexOf("function verifyRequiredReports()");
  const identity = entry.indexOf("BET_TYPE_SELECTOR_INPUT_REPORT_IDENTITY_INVALID");
  const safetyValidation = entry.indexOf("pointInTimeSafe === false");
  const internalRun = entry.lastIndexOf("runIsolated(workspace, verifiedDbPath)");
  assert.ok(validation >= 0 && identity > validation && safetyValidation > identity && internalRun > safetyValidation);
  assert.doesNotMatch(entry, /report-bet-type-selector-summary-raw\.ts/);
  assert.doesNotMatch(entry, /DatabaseSync/);
  assert.equal(pkg.scripts?.["report:bet-type-selector"], "tsx scripts/report-bet-type-selector-summary.ts");
});

test("bet-type selector summary reverifies prerequisite reports and DB identity before isolated child handoff", () => {
  assert.match(entry, /BET_TYPE_SELECTOR_DB_MISSING/);
  assert.match(entry, /BET_TYPE_SELECTOR_DB_HANDOFF_IDENTITY_INVALID/);
  assert.match(entry, /BET_TYPE_SELECTOR_DB_CHILD_LAUNCH_IDENTITY_INVALID/);
  assert.match(entry, /env: \{ \.\.\.process\.env, BOAT_PON_DB_PATH: launchDbPath \}/);

  const calls = [...entry.matchAll(/verifyRequiredReports\(\);/g)].map((match) => match.index ?? -1);
  assert.equal(calls.length, 2, "prerequisite reports must be validated initially and again before staging");
  const outputPreflight = entry.lastIndexOf("verifyExistingOutputPaths()");
  const handoff = entry.lastIndexOf("const verifiedDbPath = verifyDbHandoff()");
  const workspace = entry.lastIndexOf("mkdtempSync(");
  const stage = entry.lastIndexOf("stageRequiredReports(workspace)");
  const internalRun = entry.lastIndexOf("runIsolated(workspace, verifiedDbPath)");
  assert.ok(calls[0] >= 0 && outputPreflight > calls[0]);
  assert.ok(calls[1] > outputPreflight && handoff > calls[1] && workspace > handoff && stage > workspace && internalRun > stage);
});

test("bet-type selector summary stages verified prerequisite reports into an isolated workspace", () => {
  assert.match(entry, /mkdtempSync\(join\(tmpdir\(\), "boat-pon-bet-type-selector-"\)\)/);
  assert.match(entry, /BET_TYPE_SELECTOR_INPUT_REPORT_HANDOFF_IDENTITY_INVALID/);
  assert.match(entry, /copyFileSync\(sourcePath, stagedPath\)/);
  assert.match(entry, /BET_TYPE_SELECTOR_STAGED_INPUT_REPORT_IDENTITY_INVALID/);
  assert.match(entry, /cwd: workspace/);
  assert.match(entry, /pathToFileURL\(internalPath\)/);
  assert.match(entry, /rmSync\(workspace, \{ recursive: true, force: true \}\)/);
});

test("bet-type selector summary redacts configured DB provenance before canonical publication", () => {
  assert.match(entry, /BET_TYPE_SELECTOR_REPORT_MISSING_AFTER_ANALYSIS/);
  assert.match(entry, /BET_TYPE_SELECTOR_DB_PROVENANCE_NOT_FOUND/);
  assert.match(entry, /OPAQUE_DB_SOURCE = "primary research database"/);
  assert.match(entry, /markdown: report\.replaceAll\(provenance, `DB: \$\{OPAQUE_DB_SOURCE\}`\)/);
  const isolatedRead = entry.lastIndexOf("readIsolatedOutputs(workspace, verifiedDbPath)");
  const publish = entry.lastIndexOf("atomicPublish(");
  assert.ok(isolatedRead >= 0 && publish > isolatedRead);
  assert.doesNotMatch(entry, /writeFileSync\(handoffReportPath/);
});

test("bet-type selector summary rejects unsafe pre-existing Markdown and JSON outputs before child write", () => {
  const firstInputPreflight = entry.lastIndexOf("verifyRequiredReports();", entry.lastIndexOf("verifyExistingOutputPaths()"));
  const outputPreflight = entry.lastIndexOf("verifyExistingOutputPaths()");
  const finalInputPreflight = entry.lastIndexOf("verifyRequiredReports();");
  const markdownIdentity = entry.indexOf("BET_TYPE_SELECTOR_PREEXISTING_REPORT_IDENTITY_INVALID");
  const jsonIdentity = entry.indexOf("BET_TYPE_SELECTOR_PREEXISTING_JSON_REPORT_IDENTITY_INVALID");
  const workspace = entry.lastIndexOf("mkdtempSync(");

  assert.ok(markdownIdentity >= 0 && jsonIdentity > markdownIdentity);
  assert.ok(firstInputPreflight >= 0 && outputPreflight > firstInputPreflight);
  assert.ok(finalInputPreflight > outputPreflight && workspace > finalInputPreflight);
  assert.match(entry, /if \(existsSync\(OUT_MD\)\)/u);
  assert.match(entry, /if \(existsSync\(OUT_JSON\)\)/u);
  assert.match(entry, /assertCanonicalSingleLinkRegularFile\(\s*OUT_MD,/u);
  assert.match(entry, /assertCanonicalSingleLinkRegularFile\(\s*OUT_JSON,/u);
});

test("bet-type selector summary verifies isolated Markdown and JSON outputs before publication", () => {
  const mdIdentity = entry.indexOf('"BET_TYPE_SELECTOR_REPORT_IDENTITY_INVALID"');
  const jsonIdentity = entry.indexOf('"BET_TYPE_SELECTOR_JSON_REPORT_IDENTITY_INVALID"');
  const mdRead = entry.indexOf('readFileSync(verifiedReportPath, "utf8")');
  const jsonRead = entry.indexOf('readFileSync(verifiedJsonPath, "utf8")');
  const mdHandoff = entry.indexOf('"BET_TYPE_SELECTOR_REPORT_HANDOFF_IDENTITY_INVALID"');
  const jsonHandoff = entry.indexOf('"BET_TYPE_SELECTOR_JSON_REPORT_HANDOFF_IDENTITY_INVALID"');
  assert.ok(mdIdentity >= 0 && jsonIdentity > mdIdentity && mdRead > jsonIdentity && jsonRead > mdRead);
  assert.ok(mdHandoff > jsonRead && jsonHandoff > mdHandoff);
  assert.match(entry, /JSON\.parse\(json\)/);
});

test("bet-type selector summary publishes both outputs through exclusive fsynced temporary files and atomic rename", () => {
  const tempCreate = entry.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = entry.indexOf("fsyncSync(fd)", tempCreate);
  const tempIdentity = entry.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, errorCode)", fsync);
  const rename = entry.indexOf("renameSync(verifiedTempPath, path)", tempIdentity);
  const mdPublish = entry.lastIndexOf("BET_TYPE_SELECTOR_MD_PUBLISH_TEMP_IDENTITY_INVALID");
  const jsonPublish = entry.lastIndexOf("BET_TYPE_SELECTOR_JSON_PUBLISH_TEMP_IDENTITY_INVALID");
  assert.ok(tempCreate >= 0 && fsync > tempCreate && tempIdentity > fsync && rename > tempIdentity);
  assert.ok(mdPublish > rename && jsonPublish > mdPublish);
});

test("legacy raw selector summary path cannot bypass prerequisite report validation", () => {
  assert.match(raw, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(raw, /process\.argv\[1\]/);
  assert.match(raw, /BET_TYPE_SELECTOR_SUMMARY_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/report-bet-type-selector-summary"\)/);
  assert.doesNotMatch(raw, /report-bet-type-selector-summary-internal/);
});

test("internal selector summary retains canonical read-only research DB boundary", () => {
  assert.match(internal, /assertCanonicalSingleLinkRegularFile/);
  assert.match(internal, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(internal, /PRAGMA query_only=ON/);
});
