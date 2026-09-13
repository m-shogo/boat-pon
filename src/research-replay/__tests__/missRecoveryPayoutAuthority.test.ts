import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("miss recovery normal entrypoint validates official settlement integrity before isolated internal analysis", () => {
  const source = readFileSync("scripts/analyze-miss-to-bet-type-recovery.ts", "utf8");
  const raw = readFileSync("scripts/analyze-miss-to-bet-type-recovery-raw.ts", "utf8");
  const internal = readFileSync("scripts/analyze-miss-to-bet-type-recovery-internal.ts", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

  assert.equal(pkg.scripts["analyze:miss-recovery"], "tsx scripts/analyze-miss-to-bet-type-recovery.ts");
  assert.match(source, /assertCanonicalSingleLinkRegularFile/u);
  assert.match(source, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/u);
  assert.match(source, /PRAGMA query_only=ON/u);
  assert.match(source, /returned IS NULL OR returned != 0/u);
  assert.match(source, /returned = 0/u);
  assert.match(source, /MISS_RECOVERY_RETURNED_BUY_UNSUPPORTED/u);
  assert.ok(source.indexOf("returned IS NULL OR returned != 0") < source.indexOf("const rows = db.prepare"));
  assert.match(source, /seenSettlementKeys\.has\(key\)/u);
  assert.match(source, /MISS_RECOVERY_PAYOUT_DUPLICATE_COMBINATION/u);
  assert.match(source, /p\.returned !== 0 && p\.returned !== 1/u);
  assert.match(source, /MISS_RECOVERY_PAYOUT_RETURN_STATE_INVALID/u);
  assert.match(source, /const isPositivePayout = p\.payout_yen != null && p\.payout_yen > 0/u);
  assert.match(source, /p\.returned === 0 && !isPositivePayout/u);
  assert.match(source, /p\.returned === 0 && isPositivePayout/u);
  assert.match(source, /MISS_RECOVERY_PAYOUT_INVALID_LINE/u);
  assert.match(source, /MISS_RECOVERY_BUY_POPULATION_EMPTY/u);
  assert.match(source, /MISS_RECOVERY_PAYOUT_COVERAGE_INCOMPLETE/u);
  assert.match(source, /analyze-miss-to-bet-type-recovery-internal\.ts/u);
  assert.doesNotMatch(source, /analyze-miss-to-bet-type-recovery-raw/u);

  const isolatedLaunch = source.indexOf("cwd: workspace");
  assert.ok(isolatedLaunch >= 0);
  assert.ok(source.indexOf("MISS_RECOVERY_RETURNED_BUY_UNSUPPORTED") < isolatedLaunch);
  assert.ok(source.indexOf("MISS_RECOVERY_PAYOUT_RETURN_STATE_INVALID") < isolatedLaunch);
  assert.ok(source.indexOf("assertPayoutCompleteness();") < isolatedLaunch);

  assert.match(raw, /fileURLToPath\(import\.meta\.url\)/u);
  assert.match(raw, /process\.argv\[1\]/u);
  assert.match(raw, /MISS_RECOVERY_RAW_DIRECT_EXECUTION_FORBIDDEN/u);
  assert.match(raw, /await import\("\.\/analyze-miss-to-bet-type-recovery"\)/u);
  assert.doesNotMatch(raw, /analyze-miss-to-bet-type-recovery-internal/u);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/u);
  assert.match(internal, /const payoutIndex = new Map<string, number>\(\)/u);
  assert.match(internal, /const analyzed: RecoveryRow\[\] = \[\]/u);
  assert.match(internal, /writeFileSync\(OUT_JSON/u);
  assert.match(internal, /readOnly: true/u);
});
