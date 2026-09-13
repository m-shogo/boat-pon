import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const entrypoint = readFileSync("scripts/report-paper-forward-monitor.ts", "utf-8");
const raw = readFileSync("scripts/report-paper-forward-monitor-raw.ts", "utf-8");
const internal = readFileSync("scripts/report-paper-forward-monitor-internal.ts", "utf-8");
const audit = readFileSync("scripts/audit-paper-forward-monitor-payout-completeness.ts", "utf-8");
const pkg = readFileSync("package.json", "utf-8");

test("paper-forward monitor entrypoint fails closed before verified isolated internal report generation", () => {
  const preflight = entrypoint.indexOf('run("scripts/audit-paper-forward-monitor-payout-completeness.ts")');
  const verify = entrypoint.indexOf("PAPER_FORWARD_MONITOR_DB_HANDOFF_IDENTITY_INVALID");
  const outputPreflight = entrypoint.indexOf("verifyExistingOutputs();", verify);
  const isolated = entrypoint.indexOf("runIsolated(workspace, handoffDbPath)");
  const childVerify = entrypoint.indexOf("PAPER_FORWARD_MONITOR_DB_CHILD_LAUNCH_IDENTITY_INVALID");
  const handoff = entrypoint.indexOf("BOAT_PON_DB_PATH: launchDbPath");
  const internalGuard = entrypoint.indexOf('BOAT_PON_PAPER_FORWARD_MONITOR_INTERNAL_GUARD: "1"');
  assert.ok(preflight >= 0);
  assert.ok(verify > preflight, "DB identity must be reverified after settlement preflight");
  assert.ok(outputPreflight > verify, "canonical destinations must be checked before analysis");
  assert.ok(isolated > outputPreflight, "internal report must start only after output-path preflight");
  assert.ok(childVerify >= 0 && handoff > childVerify, "DB must be reverified immediately before child handoff");
  assert.ok(internalGuard > handoff, "internal execution guard must accompany the verified DB handoff");
  assert.match(entrypoint, /if \(preflight !== 0\)/);
  assert.match(entrypoint, /process\.exit\(preflight\)/);
  assert.match(entrypoint, /cwd: workspace/);
});

test("paper-forward monitor raw compatibility entrypoint is independently guarded and isolated", () => {
  const preflight = raw.indexOf('run("scripts/audit-paper-forward-monitor-payout-completeness.ts")');
  const verify = raw.indexOf("PAPER_FORWARD_MONITOR_RAW_DB_HANDOFF_IDENTITY_INVALID");
  const outputPreflight = raw.indexOf("verifyExistingOutputs();", verify);
  const isolated = raw.indexOf("runIsolated(workspace, handoffDbPath)");
  const childVerify = raw.indexOf("PAPER_FORWARD_MONITOR_RAW_DB_CHILD_LAUNCH_IDENTITY_INVALID");
  const handoff = raw.indexOf("BOAT_PON_DB_PATH: launchDbPath");
  const internalGuard = raw.indexOf('BOAT_PON_PAPER_FORWARD_MONITOR_INTERNAL_GUARD: "1"');
  const staged = raw.indexOf("readStagedOutputs(workspace, handoffDbPath)", isolated);
  assert.ok(preflight >= 0);
  assert.ok(verify > preflight, "raw DB identity must be reverified after settlement preflight");
  assert.ok(outputPreflight > verify, "raw canonical destinations must be checked before analysis");
  assert.ok(isolated > outputPreflight, "raw internal aggregation must be isolated after path preflight");
  assert.ok(childVerify >= 0 && handoff > childVerify, "raw DB must be reverified before child handoff");
  assert.ok(internalGuard > handoff);
  assert.ok(staged > isolated, "raw staged outputs must be verified after isolated aggregation");
  assert.match(raw, /PAPER_FORWARD_MONITOR_RAW_PRIVATE_DB_PATH_REMAINS/);
  assert.match(raw, /PAPER_FORWARD_MONITOR_RAW_DB_PROVENANCE_UNEXPECTED/);
  assert.match(raw, /PAPER_FORWARD_MONITOR_RAW_PREEXISTING_JSON_IDENTITY_INVALID/);
  assert.doesNotMatch(raw, /new DatabaseSync/);
  assert.doesNotMatch(raw, /sanitizeDbProvenance/);
});

test("paper-forward monitor raw verifies and atomically publishes both staged artifacts", () => {
  const mdIdentity = raw.indexOf('"PAPER_FORWARD_MONITOR_RAW_REPORT_IDENTITY_INVALID"');
  const jsonIdentity = raw.indexOf('"PAPER_FORWARD_MONITOR_RAW_JSON_IDENTITY_INVALID"');
  const jsonParse = raw.indexOf("JSON.parse(json)");
  const reportsIdentity = raw.indexOf('"PAPER_FORWARD_MONITOR_RAW_REPORTS_DIRECTORY_IDENTITY_INVALID"');
  const completePreflight = raw.indexOf("verifyExistingOutputs();", reportsIdentity);
  const firstPublish = raw.indexOf("atomicPublish(", completePreflight);
  const parentInitial = raw.indexOf("PAPER_FORWARD_MONITOR_RAW_PUBLISH_PARENT_IDENTITY_INVALID");
  const exclusiveOpen = raw.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = raw.indexOf("fsyncSync(fd)");
  const parentHandoff = raw.indexOf("PAPER_FORWARD_MONITOR_RAW_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID");
  const rename = raw.indexOf("renameSync(verifiedTempPath, path)");

  assert.ok(mdIdentity >= 0 && jsonIdentity > mdIdentity && jsonParse > jsonIdentity);
  assert.ok(reportsIdentity > jsonParse && completePreflight > reportsIdentity && firstPublish > completePreflight);
  assert.ok(parentInitial >= 0 && exclusiveOpen > parentInitial && fsync > exclusiveOpen);
  assert.ok(parentHandoff > fsync && rename > parentHandoff);
  assert.match(raw, /PAPER_FORWARD_MONITOR_RAW_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(raw, /PAPER_FORWARD_MONITOR_RAW_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/);
});

test("paper-forward monitor payout preflight covers only settled historical trifecta 1-2-3 BUY rows and stays read-only", () => {
  assert.match(audit, /WITH target_rows AS/);
  assert.match(audit, /SELECT DISTINCT race_id/);
  assert.match(audit, /dh\.decision = 'BUY'/);
  assert.match(audit, /dh\.run_kind = 'historical-backfill'/);
  assert.match(audit, /dh\.result IS NOT NULL/);
  assert.match(audit, /dh\.selection = '1-2-3'/);
  assert.match(audit, /bet_type = '3連単'/);
  assert.match(audit, /returned = 0/);
  assert.match(audit, /rp\.bet_type = 'trifecta'/);
  assert.match(audit, /ts\.returned = 0/);
  assert.match(audit, /ts\.payout_yen > 0/);
  assert.match(audit, /readOnly: true/);
  assert.match(audit, /PRAGMA query_only = ON/);
  assert.match(audit, /assertCanonicalSingleLinkRegularFile/);
  assert.match(audit, /evaluatePaperForwardPayoutCompleteness/);
  assert.match(audit, /PAPER_FORWARD_MONITOR_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
});

test("paper-forward monitor fails closed on decision cohort drift before settlement verdicts", () => {
  assert.match(audit, /tr\.bet_type IS NULL/);
  assert.match(audit, /tr\.bet_type != '3連単'/);
  assert.match(audit, /tr\.returned IS NULL/);
  assert.match(audit, /tr\.returned != 0/);
  assert.match(audit, /cohortInvalidRows/);
  assert.match(audit, /PAPER_FORWARD_MONITOR_COHORT_INVALID/);
  const cohortGate = audit.indexOf("if ((row.cohortInvalidRows ?? 0) > 0)");
  const coverageGate = audit.indexOf("if (!result.complete)");
  assert.ok(cohortGate >= 0);
  assert.ok(coverageGate > cohortGate);
});

test("paper-forward monitor settlement gate accepts legitimate multi-line races but rejects ambiguous or unknown-return lines", () => {
  assert.match(audit, /target_settlements/);
  assert.match(audit, /GROUP BY race_id, combination/);
  assert.match(audit, /HAVING COUNT\(\*\) > 1/);
  assert.match(audit, /duplicateCombinationKeys/);
  assert.match(audit, /invalidNonRefundRows/);
  assert.match(audit, /returnedRows/);
  assert.match(audit, /ts\.returned IS NULL OR ts\.returned != 0/);
  assert.match(audit, /refund or unknown-return settlement rows/);
  assert.match(audit, /ts\.combination IS NULL/);
  assert.match(audit, /ts\.combination = ''/);
  assert.match(audit, /ts\.payout_yen IS NULL/);
  assert.match(audit, /ts\.payout_yen <= 0/);
  assert.doesNotMatch(audit, /HAVING COUNT\(\*\) = 1/);
});

test("paper-forward monitor internal report revalidates its DB boundary and remains payout dependent/read-only", () => {
  const guard = internal.indexOf("PAPER_FORWARD_MONITOR_INTERNAL_DIRECT_EXECUTION_FORBIDDEN");
  const missing = internal.indexOf("PAPER_FORWARD_MONITOR_INTERNAL_DB_MISSING");
  const identity = internal.indexOf("PAPER_FORWARD_MONITOR_INTERNAL_DB_IDENTITY_INVALID");
  const open = internal.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  const queryOnly = internal.indexOf("PRAGMA query_only = ON");
  assert.ok(guard >= 0, "internal report must reject direct execution");
  assert.ok(missing > guard, "DB existence must be checked after the internal guard");
  assert.ok(identity > missing, "DB identity must be revalidated after existence checking");
  assert.ok(open > identity, "SQLite must open only the revalidated DB path");
  assert.ok(queryOnly > open, "SQLite connection must be forced query-only after read-only open");
  assert.match(internal, /COALESCE/);
  assert.match(internal, /payoutRoi132/);
  assert.match(internal, /switchVerdict/);
  assert.match(internal, /upgradeVerdict/);
  assert.match(internal, /assertCanonicalSingleLinkRegularFile/);
  assert.match(internal, /DB: \$\{OPAQUE_DB_SOURCE\}/);
  assert.doesNotMatch(internal, /DB not found: \$\{DB_PATH\}/);
  assert.doesNotMatch(internal, /DB: \$\{DB_PATH\}/);
  assert.doesNotMatch(internal, /db\.(?:exec|prepare)\(\s*[`\"']\s*(?:INSERT|UPDATE|DELETE|DROP)\b/i);
});

test("paper-forward monitor npm command stays on the fail-closed entrypoint", () => {
  assert.match(pkg, /"report:paper-forward-monitor": "tsx scripts\/report-paper-forward-monitor\.ts"/);
});
