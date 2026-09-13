import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const entrySource = readFileSync("scripts/analyze-ticket-selector-strategies.ts", "utf8");
const auditSource = readFileSync("scripts/audit-ticket-selector-payout-completeness.ts", "utf8");
const coreSource = readFileSync("scripts/analyze-ticket-selector-strategies-core.ts", "utf8");

test("direct ticket-selector analysis cannot bypass compared-market payout completeness", () => {
  const preflight = entrySource.indexOf('run("scripts/audit-ticket-selector-payout-completeness.ts")');
  const identity = entrySource.indexOf('"TICKET_SELECTOR_PRIMARY_DB_IDENTITY_INVALID"');
  const analysis = entrySource.indexOf("runIsolated(workspace, verifiedDbPath)");
  assert.ok(preflight >= 0);
  assert.ok(identity > preflight);
  assert.ok(analysis > identity);
  assert.match(entrySource, /if \(preflight !== 0\)/);
  assert.match(entrySource, /process\.exit\(preflight\)/);
  assert.match(entrySource, /TICKET_SELECTOR_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(entrySource, /BOAT_PON_DB_PATH: launchDbPath/);
  assert.match(entrySource, /TICKET_SELECTOR_DB_CHILD_LAUNCH_IDENTITY_INVALID/);
});

test("ticket-selector keeps raw core outputs isolated and sanitizes DB provenance before canonical publication", () => {
  assert.match(entrySource, /OPAQUE_DB_SOURCE = "primary research database"/);
  assert.match(entrySource, /mkdtempSync\(join\(tmpdir\(\), "boat-pon-ticket-selector-"\)\)/);
  assert.match(entrySource, /cwd: workspace/);
  assert.match(entrySource, /TICKET_SELECTOR_REPORT_MISSING_AFTER_ANALYSIS/);
  assert.match(entrySource, /TICKET_SELECTOR_JSON_REPORT_MISSING_AFTER_ANALYSIS/);
  assert.match(entrySource, /TICKET_SELECTOR_DB_PROVENANCE_NOT_FOUND/);
  assert.match(entrySource, /const redacted = report\.replaceAll\(provenance, `DB: \$\{OPAQUE_DB_SOURCE\}`\)/);
  assert.match(entrySource, /TICKET_SELECTOR_PRIVATE_DB_PATH_REMAINS/);
  assert.match(entrySource, /TICKET_SELECTOR_JSON_REPORT_INVALID/);

  const analysis = entrySource.indexOf("runIsolated(workspace, verifiedDbPath)");
  const successGate = entrySource.indexOf("if (status === 0)", analysis);
  const readOutputs = entrySource.indexOf("readIsolatedOutputs(workspace, verifiedDbPath)", successGate);
  const firstPublish = entrySource.indexOf("publishAtomically(", readOutputs);
  const pass = entrySource.lastIndexOf("[ticket-selector] PASS");
  assert.ok(analysis >= 0 && successGate > analysis && readOutputs > successGate && firstPublish > readOutputs && pass > firstPublish);
  assert.doesNotMatch(entrySource, /cwd:\s*process\.cwd\(\)/u);
});

test("ticket-selector verifies staged outputs and publishes both sanitized artifacts atomically", () => {
  const firstIdentity = entrySource.indexOf('"TICKET_SELECTOR_REPORT_IDENTITY_INVALID"');
  const jsonIdentity = entrySource.indexOf('"TICKET_SELECTOR_JSON_REPORT_IDENTITY_INVALID"');
  const read = entrySource.indexOf('readFileSync(verifiedReportPath, "utf8")');
  const privatePathCheck = entrySource.indexOf("TICKET_SELECTOR_PRIVATE_DB_PATH_REMAINS");
  const handoffIdentity = entrySource.indexOf('"TICKET_SELECTOR_REPORT_HANDOFF_IDENTITY_INVALID"');
  const jsonHandoffIdentity = entrySource.indexOf('"TICKET_SELECTOR_JSON_REPORT_HANDOFF_IDENTITY_INVALID"');
  const exclusiveOpen = entrySource.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = entrySource.indexOf("fsyncSync(fd)");
  const parentHandoff = entrySource.indexOf('"TICKET_SELECTOR_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID"');
  const rename = entrySource.indexOf("renameSync(verifiedTempPath, targetPath)");
  const mdPublish = entrySource.indexOf("outputs.markdown");
  const jsonPublish = entrySource.indexOf("outputs.json", mdPublish);

  assert.ok(
    firstIdentity >= 0
      && jsonIdentity > firstIdentity
      && read > jsonIdentity
      && privatePathCheck > read
      && handoffIdentity > privatePathCheck
      && jsonHandoffIdentity > handoffIdentity,
  );
  assert.ok(exclusiveOpen >= 0 && fsync > exclusiveOpen && parentHandoff > fsync && rename > parentHandoff);
  assert.ok(mdPublish >= 0 && jsonPublish > mdPublish);
  assert.match(entrySource, /writeFileSync\(fd, content, "utf8"\)/);
  assert.match(entrySource, /rmSync\(tempPath, \{ force: true \}\)/);
  assert.match(entrySource, /TICKET_SELECTOR_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(entrySource, /TICKET_SELECTOR_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/);
});

test("ticket-selector preflight covers the exact base population and every compared market", () => {
  assert.match(auditSource, /SELECT DISTINCT dh\.race_id/);
  assert.match(auditSource, /dh\.decision='BUY'/);
  assert.match(auditSource, /dh\.run_kind='historical-backfill'/);
  assert.match(auditSource, /dh\.selection='1-2-3'/);
  assert.match(auditSource, /dh\.current_odds IS NOT NULL/);
  assert.match(auditSource, /dh\.returned=0/);
  assert.match(auditSource, /dh\.returned IS NULL OR dh\.returned != 0/);
  assert.match(auditSource, /target historical BUY cohort contains unknown or returned rows/);
  assert.match(auditSource, /EXCLUDED_VENUES/);
  assert.match(auditSource, /EXCLUDED_RACE_NOS/);
  for (const betType of ["trifecta", "trio", "exacta", "quinella", "wide"]) {
    assert.match(auditSource, new RegExp(`ts\\.bet_type='${betType}'`));
  }
  assert.match(auditSource, /total > 0/);
  assert.match(auditSource, /covered !== total/);
});

test("ticket-selector preflight validates all compared settlement lines without banning legitimate multi-line winners", () => {
  assert.match(auditSource, /ts\.returned=0/);
  assert.match(auditSource, /ts\.returned IS NULL OR ts\.returned != 0/);
  assert.match(auditSource, /invalidSettlementReturnStates/);
  assert.match(auditSource, /ts\.payout_yen>0/);
  assert.match(auditSource, /ts\.payout_yen<=0/);
  assert.match(auditSource, /ts\.combination IS NULL/);
  assert.match(auditSource, /GROUP BY race_id, bet_type, combination/);
  assert.match(auditSource, /HAVING COUNT\(\*\) > 1/);
  assert.match(auditSource, /duplicateCombinationKeys/);
  assert.match(auditSource, /invalidNonRefundRows/);
  assert.match(auditSource, /process\.exit\(2\)/);
  assert.doesNotMatch(auditSource, /HAVING COUNT\(\*\) = 1/);
  assert.doesNotMatch(auditSource, /COUNT\(DISTINCT ts\.combination\) = 1/);
});

test("ticket-selector payout audit verifies database identity and remains query-only", () => {
  const verify = auditSource.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = auditSource.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(verify >= 0);
  assert.ok(open > verify);
  assert.match(auditSource, /PRAGMA query_only = ON/);
});

test("preserved selector core still ranks train and forward strategies from scalar payout ROI", () => {
  assert.match(coreSource, /bestTrain/);
  assert.match(coreSource, /bestFwd/);
  assert.match(coreSource, /coverage:/);
  assert.match(coreSource, /COALESCE\(\(SELECT rp\.payout_yen/);
  assert.match(coreSource, /LIMIT 1/);
});
