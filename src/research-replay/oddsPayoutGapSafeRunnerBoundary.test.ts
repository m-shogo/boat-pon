import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const runnerSource = readFileSync("scripts/analyze-odds-payout-gap.ts", "utf-8");
const rawSource = readFileSync("scripts/analyze-odds-payout-gap-raw.ts", "utf-8");
const auditSource = readFileSync("scripts/audit-odds-payout-gap-completeness.ts", "utf-8");
const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { scripts?: Record<string, string> };

test("odds-payout-gap normal entrypoint executes settlement preflight and launch-time DB handoff before isolated analysis", () => {
  assert.equal(pkg.scripts?.["analyze:odds-payout-gap"], "tsx scripts/analyze-odds-payout-gap.ts");
  const preflight = runnerSource.indexOf('run("scripts/audit-odds-payout-gap-completeness.ts")');
  const gate = runnerSource.indexOf("if (preflight !== 0)");
  const identity = runnerSource.indexOf("ODDS_PAYOUT_GAP_DB_IDENTITY_INVALID");
  const workspace = runnerSource.indexOf("mkdtempSync(", identity);
  const launchIdentity = runnerSource.indexOf("ODDS_PAYOUT_GAP_DB_CHILD_LAUNCH_IDENTITY_INVALID", workspace);
  const analysis = runnerSource.indexOf("const analysis = spawnSync", launchIdentity);

  assert.ok(preflight >= 0, "normal entrypoint must invoke payout completeness preflight");
  assert.ok(gate > preflight);
  assert.ok(identity > gate, "DB identity must be revalidated only after payout completeness passes");
  assert.ok(workspace > identity, "isolated workspace must be created only after the initial DB handoff");
  assert.ok(launchIdentity > workspace, "DB identity must be revalidated after workspace setup");
  assert.ok(analysis > launchIdentity, "internal analysis must run only after the launch-time verified DB handoff");
  assert.match(runnerSource, /cwd: workspace/);
  assert.match(runnerSource, /BOAT_PON_DB_PATH: launchDbPath/);
  assert.doesNotMatch(runnerSource, /process\.env\.BOAT_PON_DB_PATH =/);
  assert.doesNotMatch(runnerSource, /await import\("\.\/analyze-odds-payout-gap-internal"\)/);
  assert.doesNotMatch(runnerSource, /analyze-odds-payout-gap-raw/);
});

test("odds-payout-gap normal entrypoint fails closed before analysis when preflight fails", () => {
  assert.match(runnerSource, /if \(preflight !== 0\)/);
  assert.match(runnerSource, /process\.exit\(preflight\)/);

  const guard = runnerSource.indexOf("if (preflight !== 0)");
  const analysis = runnerSource.indexOf("const analysis = spawnSync", guard);
  assert.ok(guard >= 0 && guard < analysis, "preflight failure guard must precede analysis execution");
});

test("odds-payout-gap isolated analysis verifies child outputs and reverifies final destinations before atomic publication", () => {
  const analysis = runnerSource.indexOf("const analysis = spawnSync");
  const mdIdentity = runnerSource.indexOf("ODDS_PAYOUT_GAP_MD_WORKSPACE_OUTPUT_IDENTITY_INVALID", analysis);
  const jsonIdentity = runnerSource.indexOf("ODDS_PAYOUT_GAP_JSON_WORKSPACE_OUTPUT_IDENTITY_INVALID", analysis);
  const tempCreate = runnerSource.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = runnerSource.indexOf("fsyncSync(fd)", tempCreate);
  const tempIdentity = runnerSource.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)", fsync);
  const destinationIdentity = runnerSource.indexOf("assertCanonicalSingleLinkRegularFile(path, destinationErrorCode)", tempIdentity);
  const rename = runnerSource.indexOf("renameSync(verifiedTempPath, path)", destinationIdentity);

  assert.ok(mdIdentity > analysis && jsonIdentity > analysis);
  assert.ok(tempCreate >= 0 && fsync > tempCreate);
  assert.ok(tempIdentity > fsync && destinationIdentity > tempIdentity && rename > destinationIdentity);
  assert.match(runnerSource, /ODDS_PAYOUT_GAP_INTERNAL_FAILED/);
  assert.match(runnerSource, /ODDS_PAYOUT_GAP_MD_OUTPUT_IDENTITY_INVALID/);
  assert.match(runnerSource, /ODDS_PAYOUT_GAP_JSON_OUTPUT_IDENTITY_INVALID/);
  assert.match(runnerSource, /ODDS_PAYOUT_GAP_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(runnerSource, /ODDS_PAYOUT_GAP_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/);
});

test("odds-payout-gap raw compatibility module forbids direct CLI execution and routes through canonical preflight", () => {
  assert.match(rawSource, /ODDS_PAYOUT_GAP_RAW_DIRECT_EXECUTION_FORBIDDEN/u);
  assert.match(rawSource, /if \(invokedPath === rawEntrypointPath\)/u);
  assert.match(rawSource, /await import\("\.\/analyze-odds-payout-gap"\)/u);
  assert.doesNotMatch(rawSource, /analyze-odds-payout-gap-internal/u);
});

test("odds-payout-gap completeness audit covers the full research population and remains read-only", () => {
  assert.match(auditSource, /dh\.decision = 'BUY'/);
  assert.match(auditSource, /dh\.run_kind = 'historical-backfill'/);
  assert.match(auditSource, /rp\.bet_type = 'trifecta'/);
  assert.match(auditSource, /readOnly: true/);
  assert.match(auditSource, /PRAGMA query_only = ON/);
  assert.match(auditSource, /assertCanonicalSingleLinkRegularFile/);
  assert.match(auditSource, /if \(!result\.complete\)/);
});

test("odds-payout-gap preflight rejects cohort drift before ROI analysis", () => {
  assert.match(auditSource, /SELECT dh\.race_id, dh\.bet_type, dh\.returned/);
  assert.match(auditSource, /bet_type = '3連単'/);
  assert.match(auditSource, /returned = 0/);
  assert.match(auditSource, /tr\.bet_type IS NULL/);
  assert.match(auditSource, /tr\.bet_type != '3連単'/);
  assert.match(auditSource, /tr\.returned IS NULL/);
  assert.match(auditSource, /tr\.returned != 0/);
  assert.match(auditSource, /cohortInvalidRows/);
  assert.match(auditSource, /non-3連単 or returned\/unknown-return historical BUY rows/);
  assert.match(auditSource, /if \(\(row\.cohortInvalidRows \?\? 0\) > 0\)/);

  const cohortGuard = auditSource.indexOf("if ((row.cohortInvalidRows ?? 0) > 0)");
  const completenessGuard = auditSource.indexOf("if (!result.complete)");
  assert.ok(cohortGuard >= 0 && cohortGuard < completenessGuard, "cohort drift must fail closed before payout completeness is accepted");
});
