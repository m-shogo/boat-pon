import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-miss-to-bet-type-recovery.ts", "utf8");

test("miss recovery wrapper keeps configured database paths out of missing-file errors", () => {
  assert.match(source, /throw new Error\("MISS_RECOVERY_DB_NOT_FOUND"\)/u);
  assert.doesNotMatch(source, /MISS_RECOVERY_DB_NOT_FOUND \$\{DB_PATH\}/u);
});

test("miss recovery wrapper preserves canonical read-only database boundary", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/u);
  assert.match(source, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/u);
  assert.match(source, /PRAGMA query_only=ON/u);
});

test("miss recovery wrapper rejects unsafe pre-existing report paths before legacy analysis writes", () => {
  const dbHandoff = source.indexOf("MISS_RECOVERY_DB_HANDOFF_IDENTITY_INVALID");
  const reportPreflight = source.indexOf("MISS_RECOVERY_PREEXISTING_REPORT_IDENTITY_INVALID");
  const analysis = source.indexOf('await import("./analyze-miss-to-bet-type-recovery-internal")');

  assert.ok(reportPreflight > dbHandoff, "report identity must be checked after verified DB handoff");
  assert.ok(analysis > reportPreflight, "legacy analyzer must not write before an existing report path is verified");
  assert.match(source, /if \(existsSync\(OUT_MD\)\)/u);
});

test("miss recovery wrapper redacts private database provenance after canonical analysis", () => {
  const analysis = source.indexOf('await import("./analyze-miss-to-bet-type-recovery-internal")');
  const redact = source.lastIndexOf("redactDbProvenance(handoffDbPath)");

  assert.ok(analysis >= 0);
  assert.ok(redact > analysis, "private DB provenance must be sanitized only after canonical analysis completes");
  assert.match(source, /const OPAQUE_DB_SOURCE = "primary research database"/u);
  assert.match(source, /const privateMarker = `DB: \$\{dbPath\}`/u);
  assert.match(source, /const redacted = report\.replaceAll\(privateMarker, `DB: \$\{OPAQUE_DB_SOURCE\}`\)/u);
  assert.match(source, /MISS_RECOVERY_REPORT_MISSING_AFTER_ANALYSIS/u);
  assert.match(source, /MISS_RECOVERY_PRIVATE_DB_PROVENANCE_MARKER_MISSING/u);
  assert.match(source, /MISS_RECOVERY_PRIVATE_DB_PATH_REMAINS/u);
});

test("miss recovery wrapper verifies report identity and publishes provenance atomically", () => {
  const firstIdentity = source.indexOf('"MISS_RECOVERY_REPORT_IDENTITY_INVALID"');
  const read = source.indexOf('readFileSync(verifiedReportPath, "utf8")');
  const privatePathCheck = source.indexOf("MISS_RECOVERY_PRIVATE_DB_PATH_REMAINS");
  const handoffIdentity = source.indexOf('"MISS_RECOVERY_REPORT_HANDOFF_IDENTITY_INVALID"');
  const publishCall = source.indexOf("publishRedactedReportAtomically(handoffReportPath, redacted)");
  const exclusiveOpen = source.indexOf('openSync(tempPath, "wx")');
  const fsync = source.indexOf("fsyncSync(fd)");
  const tempIdentity = source.indexOf('"MISS_RECOVERY_TEMP_REPORT_IDENTITY_INVALID"');
  const destinationIdentity = source.indexOf('"MISS_RECOVERY_PUBLISH_DESTINATION_IDENTITY_INVALID"');
  const rename = source.indexOf("renameSync(verifiedTempPath, verifiedTargetPath)");

  assert.ok(
    firstIdentity >= 0
      && read > firstIdentity
      && privatePathCheck > read
      && handoffIdentity > privatePathCheck
      && publishCall > handoffIdentity,
  );
  assert.ok(
    exclusiveOpen >= 0
      && fsync > exclusiveOpen
      && tempIdentity > fsync
      && destinationIdentity > tempIdentity
      && rename > destinationIdentity,
  );
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(\s*OUT_MD,/u);
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(\s*verifiedReportPath,/u);
  assert.match(source, /writeFileSync\(fd, content, "utf8"\)/u);
  assert.match(source, /if \(existsSync\(tempPath\)\) unlinkSync\(tempPath\)/u);
  assert.doesNotMatch(source, /writeFileSync\(\s*handoffReportPath/u);
});
