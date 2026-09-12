import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const entrypoint = readFileSync("scripts/analyze-bet-type-risk-factors.ts", "utf8");
const preflight = readFileSync("scripts/audit-bet-type-risk-factors-cohort.ts", "utf8");
const internal = readFileSync("scripts/analyze-bet-type-risk-factors-internal.ts", "utf8");

test("bet type risk analysis runs canonical cohort preflight before isolated internal analysis", () => {
  const guard = entrypoint.indexOf('run("scripts/audit-bet-type-risk-factors-cohort.ts")');
  const identity = entrypoint.indexOf('"BET_TYPE_RISK_PRIMARY_DB_IDENTITY_INVALID"');
  const launchIdentity = entrypoint.indexOf('"BET_TYPE_RISK_CHILD_LAUNCH_DB_IDENTITY_INVALID"');
  const workspace = entrypoint.indexOf('mkdtempSync(join(tmpdir(), "boat-pon-bet-type-risk-"))');
  const analysis = entrypoint.indexOf("const analysis = spawnSync", workspace);
  assert.ok(guard >= 0, "entrypoint must invoke cohort preflight");
  assert.ok(identity > guard, "primary DB identity must be reverified after preflight");
  assert.ok(launchIdentity > identity, "DB identity must be reverified immediately before child launch");
  assert.ok(workspace > launchIdentity && analysis > workspace, "internal analysis must run only inside isolated workspace");
  assert.match(entrypoint, /if \(preflight !== 0\)/);
  assert.match(entrypoint, /process\.exit\(preflight\)/);
  assert.match(entrypoint, /BET_TYPE_RISK_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(entrypoint, /BOAT_PON_DB_PATH: launchDbPath/);
  assert.match(entrypoint, /cwd: workspace/);
  assert.doesNotMatch(entrypoint, /run\("scripts\/analyze-bet-type-risk-factors-internal\.ts"/);
});

test("bet type risk analysis sanitizes staged DB provenance before canonical publication", () => {
  assert.match(entrypoint, /OPAQUE_DB_SOURCE = "primary research database"/);
  assert.match(entrypoint, /BET_TYPE_RISK_MD_OUTPUT_MISSING/);
  assert.match(entrypoint, /BET_TYPE_RISK_JSON_OUTPUT_MISSING/);
  assert.match(entrypoint, /BET_TYPE_RISK_MD_DB_PROVENANCE_NOT_FOUND/);
  assert.match(entrypoint, /const redacted = content\.split\(dbPath\)\.join\(OPAQUE_DB_SOURCE\)/);
  assert.match(entrypoint, /BET_TYPE_RISK_\$\{code\}_PRIVATE_DB_PATH_REMAINS/);
  const analysis = entrypoint.indexOf("const analysis = spawnSync");
  const successGate = entrypoint.indexOf("if (analysis.error || analysis.status !== 0)", analysis);
  const redactMd = entrypoint.indexOf('redactDbProvenance(readFileSync(verifiedMdPath, "utf8"), launchDbPath, "MD", true)', successGate);
  const redactJson = entrypoint.indexOf('redactDbProvenance(readFileSync(verifiedJsonPath, "utf8"), launchDbPath, "JSON", false)', redactMd);
  const publishMd = entrypoint.indexOf('atomicPublish(OUT_MD, markdown, "MD")', redactJson);
  const pass = entrypoint.lastIndexOf("[bet-type-risk] PASS");
  assert.ok(analysis >= 0 && successGate > analysis && redactMd > successGate && redactJson > redactMd && publishMd > redactJson && pass > publishMd);
});

test("bet type risk verifies staged identities and publishes both reports atomically", () => {
  const mdIdentity = entrypoint.indexOf('"BET_TYPE_RISK_MD_STAGED_OUTPUT_IDENTITY_INVALID"');
  const jsonIdentity = entrypoint.indexOf('"BET_TYPE_RISK_JSON_STAGED_OUTPUT_IDENTITY_INVALID"');
  const privatePathCheck = entrypoint.indexOf("PRIVATE_DB_PATH_REMAINS");
  const exclusiveOpen = entrypoint.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = entrypoint.indexOf("fsyncSync(fd)", exclusiveOpen);
  const tempIdentity = entrypoint.indexOf("PUBLISH_TEMP_IDENTITY_INVALID", fsync);
  const destinationGuard = entrypoint.indexOf("if (existsSync(path))", tempIdentity);
  const destinationIdentity = entrypoint.indexOf("PUBLISH_DESTINATION_IDENTITY_INVALID", destinationGuard);
  const rename = entrypoint.indexOf("renameSync(verifiedTempPath, path)", destinationIdentity);

  assert.ok(mdIdentity >= 0 && jsonIdentity > mdIdentity && privatePathCheck >= 0);
  assert.ok(
    exclusiveOpen >= 0
      && fsync > exclusiveOpen
      && tempIdentity > fsync
      && destinationGuard > tempIdentity
      && destinationIdentity > destinationGuard
      && rename > destinationIdentity,
  );
  assert.match(entrypoint, /atomicPublish\(OUT_MD, markdown, "MD"\)/);
  assert.match(entrypoint, /atomicPublish\(OUT_JSON, json, "JSON"\)/);
  assert.match(entrypoint, /writeFileSync\(fd, content, "utf8"\)/);
  assert.match(entrypoint, /rmSync\(tempPath, \{ force: true \}\)/);
  assert.doesNotMatch(entrypoint, /writeFileSync\(OUT_MD/);
  assert.doesNotMatch(entrypoint, /writeFileSync\(OUT_JSON/);
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