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
  assert.match(entrypointSource, /writeFileSync\(OUT_MD, sanitized, "utf-8"\)/);
  assert.match(entrypointSource, /PAPER_FORWARD_MONITOR_PRIVATE_DB_PATH_REMAINS/);
  assert.match(entrypointSource, /PAPER_FORWARD_MONITOR_DB_PROVENANCE_UNEXPECTED/);
});
