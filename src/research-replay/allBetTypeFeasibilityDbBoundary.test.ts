import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entry = readFileSync("scripts/audit-all-bet-type-data-feasibility.ts", "utf8");
const internal = readFileSync("scripts/audit-all-bet-type-data-feasibility-internal.ts", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

test("all-bet-type feasibility audit verifies DB identity before legacy analysis", () => {
  const missing = entry.indexOf("ALL_BET_TYPE_FEASIBILITY_RESEARCH_DB_UNAVAILABLE");
  const identity = entry.indexOf("ALL_BET_TYPE_FEASIBILITY_DB_IDENTITY_INVALID");
  const handoff = entry.indexOf("process.env.BOAT_PON_DB_PATH = verifiedDbPath");
  const internalImport = entry.indexOf('await import("./audit-all-bet-type-data-feasibility-internal")');

  assert.ok(missing >= 0);
  assert.ok(identity > missing);
  assert.ok(handoff > identity);
  assert.ok(internalImport > handoff);
});

test("all-bet-type feasibility persisted DB provenance is fail-closed and opaque", () => {
  assert.match(entry, /parsed\.safety\.dbPath = OPAQUE_DB_SOURCE/);
  assert.match(entry, /sanitizedJson\.includes\(verifiedDbPath\)/);
  assert.match(entry, /markdown\.replaceAll\(verifiedDbPath, OPAQUE_DB_SOURCE\)/);
  assert.match(entry, /sanitizedMarkdown\.includes\(verifiedDbPath\)/);
  assert.doesNotMatch(entry, /`DB not found: \$\{configuredDbPath\}`/);
});

test("all-bet-type feasibility verifies generated report identity before read and write", () => {
  const internalImport = entry.indexOf('await import("./audit-all-bet-type-data-feasibility-internal")');
  const jsonIdentity = entry.indexOf("ALL_BET_TYPE_FEASIBILITY_JSON_REPORT_IDENTITY_INVALID");
  const markdownIdentity = entry.indexOf("ALL_BET_TYPE_FEASIBILITY_MARKDOWN_REPORT_IDENTITY_INVALID");
  const jsonRead = entry.indexOf('readFileSync(verifiedJsonPath, "utf8")');
  const jsonHandoffIdentity = entry.indexOf("ALL_BET_TYPE_FEASIBILITY_JSON_REPORT_HANDOFF_IDENTITY_INVALID");
  const jsonWrite = entry.indexOf("writeFileSync(jsonHandoffPath, sanitizedJson)");
  const markdownReadIdentity = entry.indexOf("ALL_BET_TYPE_FEASIBILITY_MARKDOWN_REPORT_READ_IDENTITY_INVALID");
  const markdownRead = entry.indexOf('readFileSync(markdownReadPath, "utf8")');
  const markdownHandoffIdentity = entry.indexOf("ALL_BET_TYPE_FEASIBILITY_MARKDOWN_REPORT_HANDOFF_IDENTITY_INVALID");
  const markdownWrite = entry.indexOf("writeFileSync(markdownHandoffPath, sanitizedMarkdown)");

  assert.ok(jsonIdentity > internalImport);
  assert.ok(markdownIdentity > internalImport);
  assert.ok(jsonRead > jsonIdentity);
  assert.ok(jsonHandoffIdentity > jsonRead);
  assert.ok(jsonWrite > jsonHandoffIdentity);
  assert.ok(markdownReadIdentity > jsonWrite, "markdown identity must be reverified after JSON sanitization before markdown read");
  assert.ok(markdownRead > markdownReadIdentity);
  assert.ok(markdownHandoffIdentity > markdownRead);
  assert.ok(markdownWrite > markdownHandoffIdentity);
  assert.match(entry, /assertCanonicalSingleLinkRegularFile\(\s*verifiedMarkdownPath,\s*"ALL_BET_TYPE_FEASIBILITY_MARKDOWN_REPORT_READ_IDENTITY_INVALID"/u);
  assert.doesNotMatch(entry, /readFileSync\(REPORT_(?:JSON|MD)/);
  assert.doesNotMatch(entry, /writeFileSync\(REPORT_(?:JSON|MD)/);
});

test("legacy feasibility implementation stays read-only and is not the npm entrypoint", () => {
  assert.match(internal, /new DatabaseSync\(DB_PATH, \{ readOnly: true \}\)/);
  assert.match(internal, /PRAGMA query_only=ON/);
  assert.doesNotMatch(internal, /db\.(?:exec|prepare)\(\s*[`\"']\s*(?:INSERT|UPDATE|DELETE|DROP)\b/i);
  assert.equal(pkg.scripts?.["audit:all-bet-type-feasibility"], "tsx scripts/audit-all-bet-type-data-feasibility.ts");
  assert.notEqual(pkg.scripts?.["audit:all-bet-type-feasibility"], "tsx scripts/audit-all-bet-type-data-feasibility-internal.ts");
});
