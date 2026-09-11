import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypointSource = readFileSync("scripts/analyze-payout-rebase.ts", "utf-8");
const internalSource = readFileSync("scripts/analyze-payout-rebase-internal.ts", "utf-8");

test("direct payout-rebase invocation runs settlement integrity preflight before verified internal analysis", () => {
  const preflight = entrypointSource.indexOf('run("scripts/audit-odds-payout-gap-completeness.ts")');
  const guard = entrypointSource.indexOf("if (preflight !== 0)");
  const verify = entrypointSource.indexOf('"PAYOUT_REBASE_PRIMARY_DB_IDENTITY_INVALID"');
  const analysis = entrypointSource.indexOf('run("scripts/analyze-payout-rebase-internal.ts"');

  assert.ok(preflight >= 0, "direct entrypoint must invoke settlement integrity preflight");
  assert.ok(guard > preflight, "preflight result must be checked before DB identity verification");
  assert.ok(verify > guard, "DB identity must be re-verified only after settlement integrity passes");
  assert.ok(analysis > verify, "internal payout analysis must remain downstream of DB identity verification");
  assert.match(entrypointSource, /process\.exit\(preflight\)/);
});

test("canonical payout-rebase entrypoint passes only a verified opaque DB identity to internal analysis", () => {
  assert.match(entrypointSource, /PAYOUT_REBASE_PRIMARY_DB_MISSING/);
  assert.match(entrypointSource, /PAYOUT_REBASE_PRIMARY_DB_IDENTITY_INVALID/);
  assert.doesNotMatch(entrypointSource, /DB not found:/);
  assert.match(entrypointSource, /BOAT_PON_DB_PATH: verifiedDbPath/);
});

test("canonical payout-rebase rejects unsafe pre-existing report paths before legacy analysis writes", () => {
  const dbVerify = entrypointSource.indexOf('"PAYOUT_REBASE_PRIMARY_DB_IDENTITY_INVALID"');
  const reportVerify = entrypointSource.indexOf('"PAYOUT_REBASE_PREEXISTING_REPORT_IDENTITY_INVALID"');
  const analysis = entrypointSource.indexOf('run("scripts/analyze-payout-rebase-internal.ts"');

  assert.ok(reportVerify > dbVerify, "report-path identity preflight must follow verified DB handoff");
  assert.ok(analysis > reportVerify, "legacy analysis must not write before an existing report path is verified");
  assert.match(entrypointSource, /if \(existsSync\(OUT_MD\)\)/u);
});

test("canonical payout-rebase entrypoint redacts private DB provenance after successful analysis", () => {
  const analysis = entrypointSource.indexOf('run("scripts/analyze-payout-rebase-internal.ts"');
  const successGuard = entrypointSource.indexOf("if (analysis !== 0)");
  const redact = entrypointSource.lastIndexOf("redactDbProvenance(verifiedDbPath)");

  assert.ok(analysis >= 0);
  assert.ok(successGuard > analysis);
  assert.ok(redact > successGuard, "private DB provenance must be sanitized only after successful analysis");
  assert.match(entrypointSource, /const OPAQUE_DB_SOURCE = "primary research database"/u);
  assert.match(entrypointSource, /const privateMarker = `DB: \$\{dbPath\}`/u);
  assert.match(entrypointSource, /report\.replaceAll\(privateMarker, `DB: \$\{OPAQUE_DB_SOURCE\}`\)/u);
  assert.match(entrypointSource, /PAYOUT_REBASE_REPORT_MISSING_AFTER_ANALYSIS/u);
  assert.match(entrypointSource, /PAYOUT_REBASE_PRIVATE_DB_PROVENANCE_MARKER_MISSING/u);
});

test("canonical payout-rebase entrypoint verifies generated report identity before provenance read and again before write", () => {
  const firstIdentity = entrypointSource.indexOf('"PAYOUT_REBASE_REPORT_IDENTITY_INVALID"');
  const read = entrypointSource.indexOf('readFileSync(verifiedReportPath, "utf-8")');
  const handoffIdentity = entrypointSource.indexOf('"PAYOUT_REBASE_REPORT_HANDOFF_IDENTITY_INVALID"');
  const write = entrypointSource.indexOf("writeFileSync(\n    handoffReportPath");

  assert.ok(firstIdentity >= 0 && read > firstIdentity && handoffIdentity > read && write > handoffIdentity);
  assert.match(entrypointSource, /assertCanonicalSingleLinkRegularFile\(\s*OUT_MD,/u);
  assert.match(entrypointSource, /assertCanonicalSingleLinkRegularFile\(\s*verifiedReportPath,/u);
});

test("internal payout-rebase analysis keeps canonical read-only database boundaries", () => {
  const verify = internalSource.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = internalSource.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(verify >= 0, "primary DB identity guard must exist");
  assert.ok(open > verify, "SQLite must open only after canonical identity verification");
  assert.match(internalSource, /PRAGMA query_only = ON/);
});

test("internal payout-rebase still consumes official payout values only after the guarded entrypoint", () => {
  assert.match(internalSource, /race_payouts\.payout_yen/);
  assert.match(internalSource, /COALESCE/);
  assert.match(internalSource, /本番 decision ロジック変更/);
});
