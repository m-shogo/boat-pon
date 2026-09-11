import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const runnerSource = readFileSync("scripts/analyze-odds-payout-gap.ts", "utf-8");
const rawSource = readFileSync("scripts/analyze-odds-payout-gap-raw.ts", "utf-8");
const auditSource = readFileSync("scripts/audit-odds-payout-gap-completeness.ts", "utf-8");
const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { scripts?: Record<string, string> };

test("odds-payout-gap normal entrypoint executes settlement preflight and DB handoff before analysis", () => {
  assert.equal(pkg.scripts?.["analyze:odds-payout-gap"], "tsx scripts/analyze-odds-payout-gap.ts");
  const preflight = runnerSource.indexOf('run("scripts/audit-odds-payout-gap-completeness.ts")');
  const gate = runnerSource.indexOf("if (preflight !== 0)");
  const identity = runnerSource.indexOf("ODDS_PAYOUT_GAP_DB_IDENTITY_INVALID");
  const analysis = runnerSource.indexOf('await import("./analyze-odds-payout-gap-internal")');

  assert.ok(preflight >= 0, "normal entrypoint must invoke payout completeness preflight");
  assert.ok(gate > preflight);
  assert.ok(identity > gate, "DB identity must be revalidated only after payout completeness passes");
  assert.ok(analysis > identity, "internal analysis must run only after the verified DB handoff");
  assert.doesNotMatch(runnerSource, /analyze-odds-payout-gap-raw/);
});

test("odds-payout-gap normal entrypoint fails closed before analysis when preflight fails", () => {
  assert.match(runnerSource, /if \(preflight !== 0\)/);
  assert.match(runnerSource, /process\.exit\(preflight\)/);

  const guard = runnerSource.indexOf("if (preflight !== 0)");
  const analysis = runnerSource.indexOf('await import("./analyze-odds-payout-gap-internal")');
  assert.ok(guard >= 0 && guard < analysis, "preflight failure guard must precede analysis execution");
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
