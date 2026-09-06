import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

const scriptPath = new URL("../../scripts/report-exacta-forward-monitor.ts", import.meta.url);
const source = readFileSync(scriptPath, "utf8");

test("exacta forward monitor remains valid TypeScript syntax", () => {
  const result = transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: {
      module: ModuleKind.ESNext,
      target: ScriptTarget.ES2022,
    },
  });
  const errors = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === 1);
  assert.deepEqual(errors.map((diagnostic) => diagnostic.messageText), []);
});

test("exacta forward monitor binds both completeness and combo odds to canonical historical source", () => {
  assert.match(source, /historicalExactaCanonicalSourcePredicate/);
  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.match(source, /HAVING \$\{HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING\}/);

  const canonicalBindings = source.match(/historicalExactaCanonicalSourcePredicate\("a"\)/g) ?? [];
  assert.equal(canonicalBindings.length, 2);
  assert.match(source, /SELECT a\.race_id, a\.combination, a\.odds/);
  assert.doesNotMatch(source, /FROM historical_alternative_odds\n  WHERE bet_type='exacta'/);
});

test("exacta forward monitor validates DB identity and stays query-only", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
});

test("exacta forward monitor only resolves one positive payout present in canonical odds", () => {
  assert.match(source, /rows\.length !== 1/);
  assert.match(source, /payout\.payout_yen != null/);
  assert.match(source, /payout\.payout_yen > 0/);
  assert.match(source, /oddsByRace\.get\(raceId\)\?\.has\(payout\.combination\) === true/);
  assert.match(source, /isResolvedExactaSettlement\(race\.race_id, oddsByRace, payoutsByRace\)/);
});

test("exacta forward monitor never coerces a winning payout to zero", () => {
  assert.doesNotMatch(source, /win\.payout_yen \?\? 0/);
  assert.match(source, /const amount = requiredPayout\(win\)/);
  assert.match(source, /monthPayout \+= requiredPayout\(win\)/);
  assert.match(source, /EXACTA_FORWARD_PAYOUT_MISSING/);
});
