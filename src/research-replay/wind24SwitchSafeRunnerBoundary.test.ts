import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const runnerSource = readFileSync("scripts/run-wind24-exh1-switch-deep-dive-safe.ts", "utf-8");
const auditSource = readFileSync("scripts/audit-wind24-exh1-switch-payout-completeness.ts", "utf-8");
const directSource = readFileSync("scripts/analyze-wind24-exh1-switch-deep-dive.ts", "utf-8");
const coreSource = readFileSync("scripts/analyze-wind24-exh1-switch-deep-dive-core.ts", "utf-8");
const internalSource = readFileSync("scripts/analyze-wind24-exh1-switch-deep-dive-internal.ts", "utf-8");

test("wind24 switch safe runner checks payout completeness before deep-dive", () => {
  const preflight = runnerSource.indexOf('run("scripts/audit-wind24-exh1-switch-payout-completeness.ts")');
  const analysis = runnerSource.indexOf('run("scripts/analyze-wind24-exh1-switch-deep-dive.ts")');
  assert.ok(preflight >= 0);
  assert.ok(analysis > preflight);
});

test("wind24 switch safe runner fails closed before promotion/demotion analysis", () => {
  assert.match(runnerSource, /if \(preflight !== 0\)/);
  assert.match(runnerSource, /process\.exit\(preflight\)/);
  assert.ok(runnerSource.indexOf("if (preflight !== 0)") < runnerSource.indexOf('run("scripts/analyze-wind24-exh1-switch-deep-dive.ts")'));
});

test("direct wind24 entrypoint cannot bypass payout completeness", () => {
  const preflight = directSource.indexOf('run("scripts/audit-wind24-exh1-switch-payout-completeness.ts")');
  const verify = directSource.indexOf('"WIND24_SWITCH_PRIMARY_DB_IDENTITY_INVALID"');
  const analysis = directSource.indexOf('run("scripts/analyze-wind24-exh1-switch-deep-dive-core.ts"');
  assert.ok(preflight >= 0);
  assert.ok(verify > preflight);
  assert.ok(analysis > verify);
  assert.match(directSource, /if \(preflight !== 0\)/);
  assert.match(directSource, /process\.exit\(preflight\)/);
  assert.match(directSource, /WIND24_SWITCH_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(directSource, /BOAT_PON_DB_PATH: verifiedDbPath/);
  assert.match(directSource, /BOAT_PON_WIND24_CORE_GUARD: "1"/);
});

test("wind24 core is guarded and re-verifies the DB identity before legacy aggregation", () => {
  const guard = coreSource.indexOf('process.env.BOAT_PON_WIND24_CORE_GUARD !== "1"');
  const dbMissing = coreSource.indexOf("WIND24_SWITCH_CORE_DB_MISSING");
  const verify = coreSource.indexOf("assertCanonicalSingleLinkRegularFile(");
  const internal = coreSource.indexOf("analyze-wind24-exh1-switch-deep-dive-internal.ts");
  assert.ok(guard >= 0, "core must reject direct execution");
  assert.ok(dbMissing > guard, "opaque DB existence handling must occur after the caller guard");
  assert.ok(verify > dbMissing, "core must re-verify canonical DB identity");
  assert.ok(internal > verify, "legacy aggregation must not start before DB identity verification");
  assert.match(coreSource, /WIND24_SWITCH_CORE_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(coreSource, /WIND24_SWITCH_CORE_DB_IDENTITY_INVALID/);
  assert.match(coreSource, /BOAT_PON_WIND24_INTERNAL_GUARD: "1"/);
  assert.doesNotMatch(coreSource, /DB not found: \\?\$\{[^}]+\}/u);
  assert.doesNotMatch(coreSource, /new DatabaseSync/u);
  assert.match(coreSource, /格上げ条件/);
  assert.match(coreSource, /降格条件/);
});

test("wind24 legacy internal fails closed and re-verifies the actual SQLite connection", () => {
  const guard = internalSource.indexOf('process.env.BOAT_PON_WIND24_INTERNAL_GUARD !== "1"');
  const dbMissing = internalSource.indexOf("WIND24_SWITCH_INTERNAL_DB_MISSING");
  const verify = internalSource.indexOf("assertCanonicalSingleLinkRegularFile(");
  const open = internalSource.indexOf("new DatabaseSync(verifiedDbPath");
  const queryOnly = internalSource.indexOf("PRAGMA query_only = ON");
  assert.ok(guard >= 0, "legacy internal must reject direct execution");
  assert.ok(dbMissing > guard, "opaque DB missing guard must run after caller guard");
  assert.ok(verify > dbMissing, "legacy internal must re-verify canonical DB identity");
  assert.ok(open > verify, "SQLite must open only the re-verified path");
  assert.ok(queryOnly > open, "query-only mode must be enabled on the actual connection");
  assert.match(internalSource, /WIND24_SWITCH_INTERNAL_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(internalSource, /WIND24_SWITCH_INTERNAL_DB_IDENTITY_INVALID/);
  assert.match(internalSource, /readOnly: true/);
  assert.doesNotMatch(internalSource, /DB not found: \\?\$\{[^}]+\}/u);
});

test("direct wind24 entrypoint redacts private DB provenance after successful analysis", () => {
  const analysis = directSource.indexOf('run("scripts/analyze-wind24-exh1-switch-deep-dive-core.ts"');
  const successGuard = directSource.indexOf("if (analysis !== 0)");
  const redact = directSource.lastIndexOf("redactDbProvenance(verifiedDbPath)");

  assert.ok(analysis >= 0);
  assert.ok(successGuard > analysis);
  assert.ok(redact > successGuard, "private DB provenance must be sanitized only after successful analysis");
  assert.match(directSource, /const OPAQUE_DB_SOURCE = "primary research database"/);
  assert.match(directSource, /const privateMarker = `DB: \$\{dbPath\}`/);
  assert.match(directSource, /report\.replaceAll\(privateMarker, `DB: \$\{OPAQUE_DB_SOURCE\}`\)/);
  assert.match(directSource, /WIND24_SWITCH_REPORT_MISSING_AFTER_ANALYSIS/);
  assert.match(directSource, /WIND24_SWITCH_PRIVATE_DB_PROVENANCE_MARKER_MISSING/);
});

test("direct wind24 entrypoint verifies generated report identity before provenance read and again before write", () => {
  const firstIdentity = directSource.indexOf('"WIND24_SWITCH_REPORT_IDENTITY_INVALID"');
  const read = directSource.indexOf('readFileSync(verifiedReportPath, "utf-8")');
  const handoffIdentity = directSource.indexOf('"WIND24_SWITCH_REPORT_HANDOFF_IDENTITY_INVALID"');
  const write = directSource.indexOf("writeFileSync(handoffReportPath");

  assert.ok(firstIdentity >= 0 && read > firstIdentity && handoffIdentity > read && write > handoffIdentity);
  assert.match(directSource, /assertCanonicalSingleLinkRegularFile\(\s*OUT_MD,/u);
  assert.match(directSource, /assertCanonicalSingleLinkRegularFile\(\s*verifiedReportPath,/u);
});

test("wind24 payout preflight matches the deep-dive population and is read-only", () => {
  assert.match(auditSource, /WITH target_rows AS \(/);
  assert.match(auditSource, /SELECT dh\.race_id, dh\.bet_type, dh\.returned/);
  assert.match(auditSource, /target_races AS \(\s*SELECT DISTINCT race_id\s*FROM target_rows/);
  assert.match(auditSource, /rw\.wind_speed_mps >= 2 AND rw\.wind_speed_mps < 4/);
  assert.match(auditSource, /re\.boat = 1/);
  assert.match(auditSource, /dh\.selection = '1-2-3'/);
  assert.match(auditSource, /bet_type = '3連単'/);
  assert.match(auditSource, /returned = 0/);
  assert.match(auditSource, /rp\.bet_type = 'trifecta'/);
  assert.match(auditSource, /readOnly: true/);
  assert.match(auditSource, /PRAGMA query_only = ON/);
  assert.match(auditSource, /assertCanonicalSingleLinkRegularFile/);
  assert.match(auditSource, /total > 0 && covered === total/);
});

test("wind24 payout preflight rejects decision cohort drift before deep-dive", () => {
  assert.match(auditSource, /tr\.bet_type IS NULL/);
  assert.match(auditSource, /tr\.bet_type != '3連単'/);
  assert.match(auditSource, /tr\.returned IS NULL/);
  assert.match(auditSource, /tr\.returned != 0/);
  assert.match(auditSource, /cohortInvalidRows/);
  assert.match(auditSource, /if \(cohortInvalidRows > 0\)/);
  assert.match(auditSource, /non-3連単 or returned\/unknown-return historical BUY rows/);

  const cohortGuard = auditSource.indexOf("if (cohortInvalidRows > 0)");
  const completenessGuard = auditSource.indexOf("if (!complete)");
  assert.ok(cohortGuard >= 0 && cohortGuard < completenessGuard, "cohort drift must fail closed before promotion/demotion completeness is accepted");
});

test("wind24 payout preflight rejects ambiguous, malformed, refund, or unknown-return settlement lines", () => {
  assert.match(auditSource, /ts\.returned = 0/);
  assert.match(auditSource, /ts\.returned IS NULL OR ts\.returned != 0/);
  assert.match(auditSource, /ts\.payout_yen > 0/);
  assert.match(auditSource, /ts\.combination IS NULL OR ts\.combination = ''/);
  assert.match(auditSource, /ts\.payout_yen IS NULL OR ts\.payout_yen <= 0/);
  assert.match(auditSource, /GROUP BY race_id, combination/);
  assert.match(auditSource, /HAVING COUNT\(\*\) > 1/);
  assert.match(auditSource, /returnedRows > 0/);
  assert.match(auditSource, /refund or unknown-return settlement rows/);
  assert.match(auditSource, /duplicateCombinationKeys > 0/);
  assert.match(auditSource, /invalidNonRefundRows > 0/);
});
