import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const coreSource = readFileSync("scripts/report-paper-forward-candidates-core.ts", "utf-8");

test("paper-forward core sanitizes all configured DB provenance after internal aggregation", () => {
  const preflight = coreSource.indexOf('run("scripts/audit-odds-payout-gap-completeness.ts")');
  const handoffIdentity = coreSource.indexOf("PAPER_FORWARD_CORE_DB_HANDOFF_IDENTITY_INVALID");
  const internal = coreSource.indexOf('run("scripts/report-paper-forward-candidates-internal.ts"');
  const redact = coreSource.lastIndexOf("redactDbProvenance(handoffDbPath)");

  assert.ok(preflight >= 0);
  assert.ok(handoffIdentity > preflight, "DB identity must be verified after settlement preflight");
  assert.ok(internal > handoffIdentity, "internal aggregation must receive only the verified DB handoff");
  assert.ok(redact > internal, "private DB provenance must be sanitized after internal aggregation");
  assert.match(coreSource, /const OPAQUE_DB_SOURCE = "primary research database"/);
  assert.match(coreSource, /\.split\(handoffDbPath\)\.join\(OPAQUE_DB_SOURCE\)/);
  assert.match(coreSource, /\.replace\(\/\^DB:\.\*\$\/gm, `DB: \$\{OPAQUE_DB_SOURCE\}`\)/);
  assert.match(coreSource, /dbLines\.length !== 1/);
  assert.match(coreSource, /PAPER_FORWARD_CORE_DB_PROVENANCE_UNEXPECTED/);
  assert.match(coreSource, /PAPER_FORWARD_CORE_PRIVATE_DB_PATH_REMAINS/);
});

test("paper-forward core verifies generated report identity before atomic provenance publication", () => {
  const firstIdentity = coreSource.indexOf('"PAPER_FORWARD_CORE_REPORT_IDENTITY_INVALID"');
  const read = coreSource.indexOf('readFileSync(verifiedReportPath, "utf-8")');
  const provenanceCheck = coreSource.indexOf("PAPER_FORWARD_CORE_DB_PROVENANCE_UNEXPECTED");
  const handoffIdentity = coreSource.indexOf('"PAPER_FORWARD_CORE_REPORT_HANDOFF_IDENTITY_INVALID"');
  const publishCall = coreSource.indexOf("publishRedactedReportAtomically(handoffReportPath, redacted)");
  const exclusiveOpen = coreSource.indexOf('openSync(tempPath, "wx")');
  const fsync = coreSource.indexOf("fsyncSync(fd)");
  const tempIdentity = coreSource.indexOf('"PAPER_FORWARD_CORE_TEMP_REPORT_IDENTITY_INVALID"');
  const destinationIdentity = coreSource.indexOf('"PAPER_FORWARD_CORE_PUBLISH_DESTINATION_IDENTITY_INVALID"');
  const rename = coreSource.indexOf("renameSync(verifiedTempPath, verifiedTargetPath)");

  assert.ok(
    firstIdentity >= 0
      && read > firstIdentity
      && provenanceCheck > read
      && handoffIdentity > provenanceCheck
      && publishCall > handoffIdentity,
  );
  assert.ok(
    exclusiveOpen >= 0
      && fsync > exclusiveOpen
      && tempIdentity > fsync
      && destinationIdentity > tempIdentity
      && rename > destinationIdentity,
  );
  assert.match(coreSource, /assertCanonicalSingleLinkRegularFile\(\s*OUT_MD,/u);
  assert.match(coreSource, /assertCanonicalSingleLinkRegularFile\(\s*verifiedReportPath,/u);
  assert.match(coreSource, /writeFileSync\(fd, content, "utf-8"\)/u);
  assert.doesNotMatch(coreSource, /writeFileSync\(handoffReportPath/u);
});
