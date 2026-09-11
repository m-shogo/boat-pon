import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const CASES = [
  {
    alias: "analyze:condb-switch-historical",
    entry: "scripts/analyze-condb-switch-historical-closing-odds.ts",
    safeRunner: "scripts/run-condb-switch-historical-closing-odds-safe.ts",
    auditPath: "scripts/audit-condb-switch-historical-payout-completeness.ts",
    audit: "audit-condb-switch-historical-payout-completeness.ts",
    raw: "analyze-condb-switch-historical-closing-odds-raw.ts",
    analyzer: "analyze-condb-switch-historical-closing-odds-internal",
    primaryIdentityError: "CONDB_SWITCH_HISTORICAL_PRIMARY_DB_IDENTITY_INVALID",
    handoffIdentityError: "CONDB_SWITCH_HISTORICAL_DB_HANDOFF_IDENTITY_INVALID",
  },
  {
    alias: "analyze:skip6r-switch-historical",
    entry: "scripts/analyze-skip6r-switch-historical-closing-odds.ts",
    safeRunner: "scripts/run-skip6r-switch-historical-closing-odds-safe.ts",
    auditPath: "scripts/audit-skip6r-historical-payout-completeness.ts",
    audit: "audit-skip6r-historical-payout-completeness.ts",
    raw: "analyze-skip6r-switch-historical-closing-odds-raw.ts",
    analyzer: "analyze-skip6r-switch-historical-closing-odds-internal",
    primaryIdentityError: "SKIP6R_SWITCH_HISTORICAL_PRIMARY_DB_IDENTITY_INVALID",
    handoffIdentityError: "SKIP6R_SWITCH_HISTORICAL_DB_HANDOFF_IDENTITY_INVALID",
  },
  {
    alias: "analyze:skipvenue-switch-historical",
    entry: "scripts/analyze-skipvenue-switch-historical-closing-odds.ts",
    safeRunner: "scripts/run-skipvenue-switch-historical-closing-odds-safe.ts",
    auditPath: "scripts/audit-skipvenue-historical-payout-completeness.ts",
    audit: "audit-skipvenue-historical-payout-completeness.ts",
    raw: "analyze-skipvenue-switch-historical-closing-odds-raw.ts",
    analyzer: "analyze-skipvenue-switch-historical-closing-odds-raw",
    primaryIdentityError: "SKIPVENUE_SWITCH_HISTORICAL_PRIMARY_DB_IDENTITY_INVALID",
    handoffIdentityError: "SKIPVENUE_SWITCH_HISTORICAL_DB_HANDOFF_IDENTITY_INVALID",
  },
] as const;

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

for (const c of CASES) {
  test(`${c.alias} direct entrypoint verifies DB identity and fails closed before analysis`, () => {
    const source = readFileSync(c.entry, "utf8");
    const primaryIdentityIndex = source.indexOf(c.primaryIdentityError);
    const auditIndex = source.indexOf(c.audit);
    const gateIndex = source.indexOf("audit !== 0");
    const handoffIdentityIndex = source.indexOf(c.handoffIdentityError);
    const analyzerIndex = source.indexOf(c.analyzer);

    assert.ok(primaryIdentityIndex >= 0, "canonical entrypoint must verify primary DB identity");
    assert.ok(auditIndex > primaryIdentityIndex, "payout audit must receive only the verified DB path");
    assert.ok(gateIndex > auditIndex);
    assert.ok(handoffIdentityIndex > gateIndex, "DB identity must be reverified after payout preflight");
    assert.ok(analyzerIndex > handoffIdentityIndex, "analysis must start only after handoff identity revalidation");
    assert.match(source, /BOAT_PON_DB_PATH: verifiedDbPath/);
    assert.match(source, /BOAT_PON_DB_PATH = handoffDbPath/);
    assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
    assert.doesNotMatch(source, /DatabaseSync/);
    assert.equal(pkg.scripts?.[c.alias], `tsx ${c.entry}`);
  });

  test(`${c.alias} compatibility safe runner delegates to the canonical entrypoint`, () => {
    const source = readFileSync(c.safeRunner, "utf8");
    assert.ok(source.includes(c.entry), "safe runner must invoke the canonical fail-closed entrypoint");
    assert.ok(!source.includes(c.raw), "safe runner must not invoke the guarded raw module directly");
    assert.ok(!source.includes(c.audit), "safe runner must not duplicate the canonical preflight sequence");
  });

  test(`${c.alias} payout audit allows legitimate multi-line trifecta settlements but rejects duplicate or invalid lines`, () => {
    const source = readFileSync(c.auditPath, "utf8");
    assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
    assert.match(source, /PRAGMA query_only = ON/);
    assert.match(source, /rp\.bet_type\s*=\s*'trifecta'/);
    assert.match(source, /rp\.returned\s*=\s*0/);
    assert.match(source, /rp\.returned IS NULL OR rp\.returned != 0/);
    assert.match(source, /PAYOUT_RETURN_STATE_INVALID/);
    assert.match(source, /GROUP BY rp\.race_id/);
    assert.match(source, /HAVING COUNT\(\*\) >= 1/);
    assert.match(source, /COUNT\(DISTINCT rp\.combination\) = COUNT\(\*\)/);
    assert.match(source, /SUM\(CASE WHEN rp\.payout_yen IS NOT NULL AND rp\.payout_yen > 0 THEN 1 ELSE 0 END\) = COUNT\(\*\)/);
    assert.doesNotMatch(source, /HAVING COUNT\(\*\) = 1/);
    const returnStateGate = source.indexOf("const payoutReturnState = db.prepare");
    const coverage = source.indexOf("const row = db.prepare");
    assert.ok(returnStateGate >= 0);
    assert.ok(coverage > returnStateGate);
  });

  test(`${c.alias} payout audit pins cohort and settlement checks to one read snapshot`, () => {
    const source = readFileSync(c.auditPath, "utf8");
    const queryOnly = source.indexOf("PRAGMA query_only = ON");
    const begin = source.indexOf('db.exec("BEGIN;")');
    const contamination = source.indexOf("const contamination = db.prepare");
    const coverage = source.indexOf("const row = db.prepare");
    assert.ok(queryOnly >= 0);
    assert.ok(begin > queryOnly);
    assert.ok(contamination > begin);
    assert.ok(coverage > contamination);
  });

  test(`${c.alias} payout audit rejects decision cohort drift before settlement coverage`, () => {
    const source = readFileSync(c.auditPath, "utf8");
    const contamination = source.indexOf("const contamination = db.prepare");
    const coverage = source.indexOf("WITH ");
    assert.ok(contamination >= 0);
    assert.ok(coverage > contamination);
    assert.match(source, /dh\.bet_type != '3連単'/);
    assert.match(source, /dh\.returned IS NULL OR dh\.returned != 0/);
    assert.match(source, /dh\.bet_type\s*=\s*'3連単'/);
    assert.match(source, /dh\.returned\s*=\s*0/);
    assert.match(source, /HISTORICAL_COHORT_INVALID/);
  });
}