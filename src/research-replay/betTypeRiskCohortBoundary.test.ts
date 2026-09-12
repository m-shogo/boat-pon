import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const entrypoint = readFileSync("scripts/analyze-bet-type-risk-factors.ts", "utf8");
const preflight = readFileSync("scripts/audit-bet-type-risk-factors-cohort.ts", "utf8");
const internal = readFileSync("scripts/analyze-bet-type-risk-factors-internal.ts", "utf8");

test("bet type risk analysis runs canonical cohort preflight before internal analysis", () => {
  const guard = entrypoint.indexOf('run("scripts/audit-bet-type-risk-factors-cohort.ts")');
  const identity = entrypoint.indexOf('"BET_TYPE_RISK_PRIMARY_DB_IDENTITY_INVALID"');
  const analysis = entrypoint.indexOf('run("scripts/analyze-bet-type-risk-factors-internal.ts"');
  assert.ok(guard >= 0, "entrypoint must invoke cohort preflight");
  assert.ok(identity > guard, "primary DB identity must be reverified after preflight");
  assert.ok(analysis > identity, "internal analysis must run only after verified DB handoff");
  assert.match(entrypoint, /if \(preflight !== 0\)/);
  assert.match(entrypoint, /process\.exit\(preflight\)/);
  assert.match(entrypoint, /BET_TYPE_RISK_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(entrypoint, /BOAT_PON_DB_PATH: verifiedDbPath/);
});

test("bet type risk analysis redacts configured DB provenance only after successful guarded analysis", () => {
  assert.match(entrypoint, /OPAQUE_DB_SOURCE = "primary research database"/);
  assert.match(entrypoint, /BET_TYPE_RISK_REPORT_MISSING_AFTER_ANALYSIS/);
  assert.match(entrypoint, /BET_TYPE_RISK_DB_PROVENANCE_NOT_FOUND/);
  assert.match(entrypoint, /const redacted = report\.replaceAll\(provenance, `DB: \$\{OPAQUE_DB_SOURCE\}`\)/);
  assert.match(entrypoint, /BET_TYPE_RISK_PRIVATE_DB_PATH_REMAINS/);
  const analysis = entrypoint.indexOf('run("scripts/analyze-bet-type-risk-factors-internal.ts"');
  const successGate = entrypoint.indexOf("if (analysis !== 0)");
  const redact = entrypoint.lastIndexOf("redactDbProvenance(verifiedDbPath)");
  const pass = entrypoint.lastIndexOf("[bet-type-risk] PASS");
  assert.ok(analysis >= 0 && successGate > analysis && redact > successGate && pass > redact);
});

test("bet type risk verifies report identity and publishes sanitized provenance atomically", () => {
  const firstIdentity = entrypoint.indexOf('"BET_TYPE_RISK_REPORT_IDENTITY_INVALID"');
  const read = entrypoint.indexOf('readFileSync(verifiedReportPath, "utf8")');
  const privatePathCheck = entrypoint.indexOf("BET_TYPE_RISK_PRIVATE_DB_PATH_REMAINS");
  const handoffIdentity = entrypoint.indexOf('"BET_TYPE_RISK_REPORT_HANDOFF_IDENTITY_INVALID"');
  const publishCall = entrypoint.indexOf("publishRedactedReportAtomically(handoffReportPath, redacted)");
  const exclusiveOpen = entrypoint.indexOf('openSync(tempPath, "wx")');
  const fsync = entrypoint.indexOf("fsyncSync(fd)");
  const tempIdentity = entrypoint.indexOf('"BET_TYPE_RISK_TEMP_REPORT_IDENTITY_INVALID"');
  const destinationIdentity = entrypoint.indexOf('"BET_TYPE_RISK_PUBLISH_DESTINATION_IDENTITY_INVALID"');
  const rename = entrypoint.indexOf("renameSync(verifiedTempPath, verifiedTargetPath)");

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
  assert.match(entrypoint, /assertCanonicalSingleLinkRegularFile\(\s*OUT_MD,/);
  assert.match(entrypoint, /assertCanonicalSingleLinkRegularFile\(\s*verifiedReportPath,/);
  assert.match(entrypoint, /writeFileSync\(fd, content, "utf8"\)/);
  assert.match(entrypoint, /if \(existsSync\(tempPath\)\) unlinkSync\(tempPath\)/);
  assert.doesNotMatch(entrypoint, /writeFileSync\(handoffReportPath/);
});

test("bet type risk cohort is fixed to unique settled trifecta historical BUY rows", () => {
  assert.match(preflight, /dh\.bet_type IS NULL/);
  assert.match(preflight, /dh\.bet_type != '3連単'/);
  assert.match(preflight, /dh\.returned IS NULL/);
  assert.match(preflight, /dh\.returned != 0/);
  assert.match(preflight, /dh\.bet_type='3連単'/);
  assert.match(preflight, /dh\.returned=0/);
  assert.match(preflight, /GROUP BY dh\.race_id/);
  assert.match(preflight, /HAVING COUNT\(\*\) != 1/);
});

test("bet type risk cohort rejects malformed or duplicate-boat three-boat selections before substring analysis", () => {
  assert.match(preflight, /length\(dh\.selection\) != 5/);
  assert.match(preflight, /dh\.selection NOT GLOB '\[1-6\]-\[1-6\]-\[1-6\]'/);
  assert.match(preflight, /substr\(dh\.selection, 1, 1\) = substr\(dh\.selection, 3, 1\)/);
  assert.match(preflight, /substr\(dh\.selection, 1, 1\) = substr\(dh\.selection, 5, 1\)/);
  assert.match(preflight, /substr\(dh\.selection, 3, 1\) = substr\(dh\.selection, 5, 1\)/);
  assert.match(preflight, /malformed three-boat selection/);
});

test("bet type risk cohort preflight verifies canonical read-only DB identity without configured path disclosure", () => {
  const identity = preflight.indexOf("assertCanonicalSingleLinkRegularFile");
  const open = preflight.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(identity >= 0 && open > identity);
  assert.match(preflight, /PRAGMA query_only = ON/);
  assert.doesNotMatch(preflight, /DB not found: \$\{DB_PATH\}/);
});

test("bet type risk cohort shape and uniqueness checks share one read snapshot", () => {
  const queryOnly = preflight.indexOf("PRAGMA query_only = ON");
  const begin = preflight.indexOf('db.exec("BEGIN;")');
  const shapeCheck = preflight.indexOf("const invalid = db.prepare");
  const uniquenessCheck = preflight.indexOf("const duplicateRace = db.prepare");
  assert.ok(queryOnly >= 0);
  assert.ok(begin > queryOnly);
  assert.ok(shapeCheck > begin);
  assert.ok(uniquenessCheck > shapeCheck);
});

test("bet type risk internal ROI fails closed on unknown or returned BUY rows and invalid official settlements", () => {
  assert.match(internal, /assertCanonicalSingleLinkRegularFile/);
  assert.match(internal, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(internal, /PRAGMA query_only=ON/);
  assert.match(internal, /assertPayoutCompleteness\(\)/);
  assert.match(internal, /BET_TYPE_RISK_BUY_RETURN_STATE_INVALID/);
  assert.match(internal, /returned IS NULL OR returned != 0/);
  assert.match(internal, /BET_TYPE_RISK_BUY_POPULATION_EMPTY/);
  assert.match(internal, /BET_TYPE_RISK_PAYOUT_RETURN_STATE_INVALID/);
  assert.match(internal, /rp\.returned IS NULL OR rp\.returned != 0/);
  assert.match(internal, /BET_TYPE_RISK_PAYOUT_INVALID_LINE/);
  assert.match(internal, /BET_TYPE_RISK_PAYOUT_DUPLICATE_KEY/);
  assert.match(internal, /BET_TYPE_RISK_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(internal, /const BET_TYPES = \["trifecta", "trio", "exacta", "quinella"\] as const/);
  assert.ok((internal.match(/(?:dh\.)?returned=0/g) ?? []).length >= 4);
  assert.doesNotMatch(internal, /COALESCE\((?:dh\.)?returned,0\)=0/);
  assert.ok((internal.match(/rp\.returned = 0/g) ?? []).length >= 2);
  assert.doesNotMatch(internal, /rp\.returned != 1/);
  assert.match(internal, /rp\.payout_yen IS NULL OR rp\.payout_yen <= 0/);
  assert.match(internal, /rp\.payout_yen IS NOT NULL AND rp\.payout_yen > 0/);
  assert.match(internal, /GROUP BY rp\.race_id, rp\.bet_type, rp\.combination/);
  assert.match(internal, /HAVING COUNT\(\*\) > 1/);

  const returnCheck = internal.indexOf("BET_TYPE_RISK_BUY_RETURN_STATE_INVALID");
  const populationCheck = internal.indexOf("BET_TYPE_RISK_BUY_POPULATION_EMPTY");
  const payoutReturnCheck = internal.indexOf("BET_TYPE_RISK_PAYOUT_RETURN_STATE_INVALID");
  const malformedCheck = internal.indexOf("BET_TYPE_RISK_PAYOUT_INVALID_LINE");
  const duplicateCheck = internal.indexOf("BET_TYPE_RISK_PAYOUT_DUPLICATE_KEY");
  const coverageCheck = internal.indexOf("BET_TYPE_RISK_PAYOUT_COVERAGE_INCOMPLETE");
  assert.ok(
    returnCheck >= 0 &&
      populationCheck > returnCheck &&
      payoutReturnCheck > populationCheck &&
      malformedCheck > payoutReturnCheck &&
      duplicateCheck > malformedCheck &&
      coverageCheck > duplicateCheck,
  );
});