import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entry = readFileSync("scripts/report-h011-forward-monitor.ts", "utf8");
const raw = readFileSync("scripts/report-h011-forward-monitor-raw.ts", "utf8");
const internal = readFileSync("scripts/report-h011-forward-monitor-internal.ts", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

test("H011 forward monitor validates exacta settlement integrity and DB handoff before isolated aggregation", () => {
  assert.equal(pkg.scripts?.["report:h011-forward-monitor"], "tsx scripts/report-h011-forward-monitor.ts");
  assert.match(entry, /H011_FORWARD_PRIMARY_DB_MISSING/);
  assert.match(entry, /H011_FORWARD_HANDOFF_DB_MISSING/);
  assert.doesNotMatch(entry, /DB not found: \$\{DB_PATH\}/);
  assert.match(entry, /assertCanonicalSingleLinkRegularFile/);
  assert.match(entry, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(entry, /PRAGMA query_only=ON/);
  assert.match(entry, /rp\.bet_type='exacta'/);
  assert.match(entry, /rp\.returned=0/);
  assert.match(entry, /rp\.combination!=''/);
  assert.match(entry, /rp\.payout_yen>0/);
  assert.match(entry, /line_count=1 AND valid_count=1/);
  assert.match(entry, /integrity\.ambiguous !== 0/);
  assert.match(entry, /H011_FORWARD_EXACTA_SETTLEMENT_INTEGRITY_FAILED/);
  assert.match(entry, /H011_FORWARD_DB_HANDOFF_IDENTITY_INVALID/);
  assert.match(entry, /H011_FORWARD_DB_CHILD_LAUNCH_IDENTITY_INVALID/);

  const gate = entry.indexOf("H011_FORWARD_EXACTA_SETTLEMENT_INTEGRITY_FAILED");
  const handoff = entry.indexOf("H011_FORWARD_DB_HANDOFF_IDENTITY_INVALID");
  const childIdentity = entry.indexOf("H011_FORWARD_DB_CHILD_LAUNCH_IDENTITY_INVALID");
  const run = entry.indexOf("const monitor = spawnSync");
  assert.ok(gate >= 0 && handoff > gate, "database identity must be reverified after settlement integrity passes");
  assert.ok(childIdentity > handoff && run > childIdentity, "isolated aggregation must start only after launch identity revalidation");
  assert.match(entry, /env: \{ \.\.\.process\.env, BOAT_PON_DB_PATH: launchDbPath \}/u);
  assert.doesNotMatch(entry, /await import\("\.\/report-h011-forward-monitor-internal"\)/u);
  assert.equal(entry.includes("report-h011-forward-monitor-raw"), false);
});

test("H011 forward monitor verifies isolated outputs and publishes atomically", () => {
  assert.match(entry, /mkdtempSync\(join\(tmpdir\(\), "boat-pon-h011-forward-"\)\)/u);
  assert.match(entry, /H011_FORWARD_MARKDOWN_OUTPUT_IDENTITY_INVALID/u);
  assert.match(entry, /H011_FORWARD_JSON_OUTPUT_IDENTITY_INVALID/u);
  assert.match(entry, /openSync\(tempPath, "wx", 0o600\)/u);
  assert.match(entry, /writeFileSync\(fd, contents, "utf8"\);\s*fsyncSync\(fd\);/u);
  assert.match(entry, /assertCanonicalSingleLinkRegularFile\(tempPath, errorCode\);\s*renameSync\(verifiedTempPath, path\);/u);
  assert.match(entry, /atomicPublish\(\s*OUT_MD,\s*markdown,/u);
  assert.match(entry, /atomicPublish\(\s*OUT_JSON,\s*json,/u);
  assert.match(entry, /rmSync\(workspace, \{ recursive: true, force: true \}\)/u);
  assert.doesNotMatch(entry, /writeFileSync\(OUT_(?:MD|JSON)/u);
});

test("H011 forward raw compatibility module forbids direct CLI execution and cannot bypass canonical preflight", () => {
  const directGuard = raw.indexOf("H011_FORWARD_RAW_DIRECT_EXECUTION_FORBIDDEN");
  const canonicalImport = raw.indexOf('await import("./report-h011-forward-monitor")');

  assert.ok(directGuard >= 0 && canonicalImport > directGuard);
  assert.doesNotMatch(raw, /report-h011-forward-monitor-internal/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
});

test("H011 forward implementation revalidates the DB and remains query-only behind the guarded command", () => {
  assert.match(internal, /H011_FORWARD_INTERNAL_DB_MISSING/);
  assert.match(internal, /H011_FORWARD_INTERNAL_DB_IDENTITY_INVALID/);
  assert.match(internal, /assertCanonicalSingleLinkRegularFile/);
  assert.match(internal, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(internal, /PRAGMA query_only = ON/);
  assert.doesNotMatch(internal, /DB not found: \$\{/);
  assert.doesNotMatch(internal, /db\.(?:exec|prepare)\(\s*[`\"']\s*(?:INSERT|UPDATE|DELETE|DROP)\b/i);

  const identity = internal.indexOf("H011_FORWARD_INTERNAL_DB_IDENTITY_INVALID");
  const dbOpen = internal.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  const queryOnly = internal.indexOf('db.exec("PRAGMA query_only = ON;")');
  assert.ok(identity >= 0 && dbOpen > identity && queryOnly > dbOpen);
});
