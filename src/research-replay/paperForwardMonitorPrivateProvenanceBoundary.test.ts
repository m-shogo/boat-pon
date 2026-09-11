import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypointSource = readFileSync("scripts/report-paper-forward-monitor.ts", "utf-8");

test("paper-forward monitor sanitizes private DB provenance after internal report generation", () => {
  const preflight = entrypointSource.indexOf('run("scripts/audit-paper-forward-monitor-payout-completeness.ts")');
  const handoffIdentity = entrypointSource.indexOf("PAPER_FORWARD_MONITOR_DB_HANDOFF_IDENTITY_INVALID");
  const internal = entrypointSource.indexOf('run("scripts/report-paper-forward-monitor-internal.ts"');
  const sanitize = entrypointSource.lastIndexOf("sanitizeDbProvenance(handoffDbPath)");

  assert.ok(preflight >= 0);
  assert.ok(handoffIdentity > preflight, "DB identity must be verified after payout completeness preflight");
  assert.ok(internal > handoffIdentity, "internal report must receive only the verified DB handoff");
  assert.ok(sanitize > internal, "private DB provenance must be sanitized after internal report generation");
  assert.match(entrypointSource, /const OPAQUE_DB_SOURCE = "primary research database"/);
  assert.match(entrypointSource, /\.split\(handoffDbPath\)\.join\(OPAQUE_DB_SOURCE\)/);
  assert.match(entrypointSource, /\.replace\(\/\^DB:\.\*\$\/gm, `DB: \$\{OPAQUE_DB_SOURCE\}`\)/);
  assert.match(entrypointSource, /PAPER_FORWARD_MONITOR_PRIVATE_DB_PATH_REMAINS/);
  assert.match(entrypointSource, /PAPER_FORWARD_MONITOR_DB_PROVENANCE_UNEXPECTED/);
});

test("paper-forward monitor verifies generated report identity before provenance read and publishes sanitized output atomically", () => {
  const firstIdentity = entrypointSource.indexOf('"PAPER_FORWARD_MONITOR_REPORT_IDENTITY_INVALID"');
  const read = entrypointSource.indexOf('readFileSync(verifiedReportPath, "utf-8")');
  const handoffIdentity = entrypointSource.indexOf('"PAPER_FORWARD_MONITOR_REPORT_HANDOFF_IDENTITY_INVALID"');
  const atomicPublish = entrypointSource.indexOf("atomicPublishSanitizedReport(handoffReportPath, sanitized)");

  assert.ok(firstIdentity >= 0 && read > firstIdentity && handoffIdentity > read && atomicPublish > handoffIdentity);
  assert.match(entrypointSource, /assertCanonicalSingleLinkRegularFile\(\s*OUT_MD,/u);
  assert.match(entrypointSource, /openSync\(tempPath, "wx", 0o600\)/u);
  assert.match(entrypointSource, /fsyncSync\(fd\)/u);
  assert.match(entrypointSource, /PAPER_FORWARD_MONITOR_SANITIZED_TEMP_IDENTITY_INVALID/u);
  assert.match(entrypointSource, /renameSync\(verifiedTempPath, path\)/u);
  assert.doesNotMatch(entrypointSource, /writeFileSync\(handoffReportPath/u);
});