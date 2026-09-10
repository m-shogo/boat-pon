import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const core = readFileSync("scripts/report-paper-forward-candidates-core.ts", "utf-8");
const raw = readFileSync("scripts/report-paper-forward-candidates-raw.ts", "utf-8");
const internal = readFileSync("scripts/report-paper-forward-candidates-internal.ts", "utf-8");
const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { scripts?: Record<string, string> };

test("paper-forward core cannot bypass official settlement completeness when invoked directly", () => {
  const preflight = core.indexOf('run("scripts/audit-odds-payout-gap-completeness.ts")');
  const handoffIdentity = core.indexOf("PAPER_FORWARD_CORE_DB_HANDOFF_IDENTITY_INVALID");
  const internalRun = core.indexOf('run("scripts/report-paper-forward-candidates-internal.ts", {');

  assert.ok(preflight >= 0, "core must invoke the canonical settlement-integrity preflight");
  assert.ok(handoffIdentity > preflight, "core must reverify DB identity after the settlement preflight");
  assert.ok(internalRun > handoffIdentity, "internal aggregation must run only after DB handoff identity verification");
  assert.match(core, /if \(preflight !== 0\)[\s\S]*process\.exit\(preflight\)/);
  assert.match(core, /BOAT_PON_DB_PATH: handoffDbPath/);
  assert.match(core, /BOAT_PON_PAPER_FORWARD_INTERNAL_GUARD: "1"/);
});

test("paper-forward public raw compatibility entrypoint is guarded, DB-free, and redacts DB provenance", () => {
  const scripts = Object.values(pkg.scripts ?? {});
  assert.equal(scripts.some((command) => command.includes("report-paper-forward-candidates-raw.ts")), false);

  const preflight = raw.indexOf('run("scripts/audit-odds-payout-gap-completeness.ts")');
  const internalRun = raw.indexOf('run("scripts/report-paper-forward-candidates-internal.ts"');
  const redact = raw.indexOf("redactDbProvenance(handoffDbPath)");
  assert.ok(preflight >= 0, "raw compatibility entrypoint must invoke settlement preflight");
  assert.ok(internalRun > preflight, "raw compatibility entrypoint must not aggregate before preflight");
  assert.ok(redact > internalRun, "raw compatibility output must redact DB provenance only after successful aggregation");
  assert.match(raw, /BOAT_PON_PAPER_FORWARD_INTERNAL_GUARD: "1"/);
  assert.match(raw, /PAPER_FORWARD_RAW_PRIVATE_DB_PATH_REMAINS/);
  assert.match(raw, /PAPER_FORWARD_RAW_DB_PROVENANCE_UNEXPECTED/);
  assert.match(raw, /\.split\(handoffDbPath\)\.join\(OPAQUE_DB_SOURCE\)/);
  assert.match(raw, /replace\(\/\^DB:\.\*\$\/gm, `DB: \$\{OPAQUE_DB_SOURCE\}`\)/);
  assert.doesNotMatch(raw, /new DatabaseSync/u);
});

test("paper-forward raw verifies generated report identity before provenance read and again before write", () => {
  const firstIdentity = raw.indexOf('"PAPER_FORWARD_RAW_REPORT_IDENTITY_INVALID"');
  const read = raw.indexOf('readFileSync(verifiedReportPath, "utf-8")');
  const handoffIdentity = raw.indexOf('"PAPER_FORWARD_RAW_REPORT_HANDOFF_IDENTITY_INVALID"');
  const write = raw.indexOf("writeFileSync(handoffReportPath");

  assert.ok(firstIdentity >= 0 && read > firstIdentity && handoffIdentity > read && write > handoffIdentity);
  assert.match(raw, /assertCanonicalSingleLinkRegularFile\(\s*OUT_MD,/u);
  assert.match(raw, /assertCanonicalSingleLinkRegularFile\(\s*verifiedReportPath,/u);
});

test("paper-forward aggregation implementation fails closed and hardens the actual SQLite boundary", () => {
  const guard = internal.indexOf('process.env.BOAT_PON_PAPER_FORWARD_INTERNAL_GUARD !== "1"');
  const missing = internal.indexOf("PAPER_FORWARD_INTERNAL_DB_MISSING");
  const identity = internal.indexOf("assertCanonicalSingleLinkRegularFile(");
  const open = internal.indexOf("new DatabaseSync(verifiedDbPath");
  const queryOnly = internal.indexOf("PRAGMA query_only = ON");

  assert.ok(guard >= 0, "internal aggregation must reject direct execution");
  assert.ok(missing > guard, "opaque missing guard must run after caller guard");
  assert.ok(identity > missing, "DB identity must be reverified inside the internal aggregation boundary");
  assert.ok(open > identity, "SQLite must open only the reverified DB path");
  assert.ok(queryOnly > open, "the actual SQLite connection must be forced into query-only mode");
  assert.match(internal, /PAPER_FORWARD_INTERNAL_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(internal, /PAPER_FORWARD_INTERNAL_DB_IDENTITY_INVALID/);
  assert.match(internal, /readOnly: true/);
  assert.doesNotMatch(internal, /DB not found: \\?\$\{[^}]+\}/u);
  assert.doesNotMatch(internal, /db\.(?:exec|prepare)\(\s*[`\"']\s*(?:INSERT|UPDATE|DELETE|DROP)\b/i);
});
