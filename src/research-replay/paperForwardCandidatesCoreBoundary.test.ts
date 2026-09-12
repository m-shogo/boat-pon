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
  const reportIdentity = core.indexOf("PAPER_FORWARD_CORE_PREEXISTING_REPORT_IDENTITY_INVALID");
  const internalRun = core.indexOf('run("scripts/report-paper-forward-candidates-internal.ts", {');

  assert.ok(preflight >= 0, "core must invoke the canonical settlement-integrity preflight");
  assert.ok(handoffIdentity > preflight, "core must reverify DB identity after the settlement preflight");
  assert.ok(reportIdentity > handoffIdentity, "pre-existing report identity must be verified after DB handoff");
  assert.ok(internalRun > reportIdentity, "internal aggregation must run only after report-path identity preflight");
  assert.match(core, /if \(preflight !== 0\)[\s\S]*process\.exit\(preflight\)/);
  assert.match(core, /if \(existsSync\(OUT_MD\)\)/u);
  assert.match(core, /BOAT_PON_DB_PATH: handoffDbPath/);
  assert.match(core, /BOAT_PON_PAPER_FORWARD_INTERNAL_GUARD: "1"/);
});

test("paper-forward core validates provenance before atomic redaction publication", () => {
  const read = core.indexOf('readFileSync(verifiedReportPath, "utf-8")');
  const provenanceCheck = core.indexOf("PAPER_FORWARD_CORE_DB_PROVENANCE_UNEXPECTED");
  const handoffIdentity = core.indexOf('"PAPER_FORWARD_CORE_REPORT_HANDOFF_IDENTITY_INVALID"');
  const publishCall = core.indexOf("publishRedactedReportAtomically(handoffReportPath, redacted)");
  const exclusiveOpen = core.indexOf('openSync(tempPath, "wx")');
  const fsync = core.indexOf("fsyncSync(fd)");
  const tempIdentity = core.indexOf('"PAPER_FORWARD_CORE_TEMP_REPORT_IDENTITY_INVALID"');
  const destinationIdentity = core.indexOf('"PAPER_FORWARD_CORE_PUBLISH_DESTINATION_IDENTITY_INVALID"');
  const rename = core.indexOf("renameSync(verifiedTempPath, verifiedTargetPath)");

  assert.ok(read >= 0 && provenanceCheck > read && handoffIdentity > provenanceCheck && publishCall > handoffIdentity);
  assert.ok(
    exclusiveOpen >= 0
      && fsync > exclusiveOpen
      && tempIdentity > fsync
      && destinationIdentity > tempIdentity
      && rename > destinationIdentity,
  );
  assert.match(core, /writeFileSync\(fd, content, "utf-8"\)/u);
  assert.match(core, /if \(existsSync\(tempPath\)\) unlinkSync\(tempPath\)/u);
  assert.doesNotMatch(core, /writeFileSync\(handoffReportPath/u);
});

test("paper-forward public raw compatibility entrypoint is guarded, DB-free, and redacts DB provenance", () => {
  const scripts = Object.values(pkg.scripts ?? {});
  assert.equal(scripts.some((command) => command.includes("report-paper-forward-candidates-raw.ts")), false);

  const preflight = raw.indexOf('run("scripts/audit-odds-payout-gap-completeness.ts")');
  const handoffIdentity = raw.indexOf("PAPER_FORWARD_RAW_DB_HANDOFF_IDENTITY_INVALID");
  const reportIdentity = raw.indexOf("PAPER_FORWARD_RAW_PREEXISTING_REPORT_IDENTITY_INVALID");
  const internalRun = raw.indexOf('run("scripts/report-paper-forward-candidates-internal.ts"');
  const redact = raw.indexOf("redactDbProvenance(handoffDbPath)");
  assert.ok(preflight >= 0, "raw compatibility entrypoint must invoke settlement preflight");
  assert.ok(handoffIdentity > preflight, "raw compatibility entrypoint must reverify DB identity after preflight");
  assert.ok(reportIdentity > handoffIdentity, "raw compatibility entrypoint must verify a pre-existing report after DB handoff");
  assert.ok(internalRun > reportIdentity, "raw compatibility entrypoint must not aggregate before report-path identity preflight");
  assert.ok(redact > internalRun, "raw compatibility output must redact DB provenance only after successful aggregation");
  assert.match(raw, /if \(existsSync\(OUT_MD\)\)/u);
  assert.match(raw, /BOAT_PON_PAPER_FORWARD_INTERNAL_GUARD: "1"/);
  assert.match(raw, /PAPER_FORWARD_RAW_PRIVATE_DB_PATH_REMAINS/);
  assert.match(raw, /PAPER_FORWARD_RAW_DB_PROVENANCE_UNEXPECTED/);
  assert.match(raw, /\.split\(handoffDbPath\)\.join\(OPAQUE_DB_SOURCE\)/);
  assert.match(raw, /replace\(\/\^DB:\.\*\$\/gm, `DB: \$\{OPAQUE_DB_SOURCE\}`\)/);
  assert.doesNotMatch(raw, /new DatabaseSync/u);
});

test("paper-forward raw verifies report identity and publishes provenance redaction atomically", () => {
  const firstIdentity = raw.indexOf('"PAPER_FORWARD_RAW_REPORT_IDENTITY_INVALID"');
  const read = raw.indexOf('readFileSync(verifiedReportPath, "utf-8")');
  const provenanceCheck = raw.indexOf("PAPER_FORWARD_RAW_DB_PROVENANCE_UNEXPECTED");
  const handoffIdentity = raw.indexOf('"PAPER_FORWARD_RAW_REPORT_HANDOFF_IDENTITY_INVALID"');
  const publishCall = raw.indexOf("publishRedactedReportAtomically(handoffReportPath, redacted)");
  const exclusiveOpen = raw.indexOf('openSync(tempPath, "wx")');
  const fsync = raw.indexOf("fsyncSync(fd)");
  const tempIdentity = raw.indexOf('"PAPER_FORWARD_RAW_TEMP_REPORT_IDENTITY_INVALID"');
  const rename = raw.indexOf("renameSync(tempPath, targetPath)");

  assert.ok(
    firstIdentity >= 0
      && read > firstIdentity
      && provenanceCheck > read
      && handoffIdentity > provenanceCheck
      && publishCall > handoffIdentity,
  );
  assert.ok(exclusiveOpen >= 0 && fsync > exclusiveOpen && tempIdentity > fsync && rename > tempIdentity);
  assert.match(raw, /assertCanonicalSingleLinkRegularFile\(\s*OUT_MD,/u);
  assert.match(raw, /assertCanonicalSingleLinkRegularFile\(\s*verifiedReportPath,/u);
  assert.match(raw, /writeFileSync\(fd, content, "utf-8"\)/u);
  assert.match(raw, /if \(existsSync\(tempPath\)\) unlinkSync\(tempPath\)/u);
  assert.doesNotMatch(raw, /writeFileSync\(handoffReportPath/u);
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