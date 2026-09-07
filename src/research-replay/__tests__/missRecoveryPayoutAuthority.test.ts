import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("miss recovery normal entrypoint validates official settlement integrity before raw analysis", () => {
  const source = readFileSync("scripts/analyze-miss-to-bet-type-recovery.ts", "utf8");
  const raw = readFileSync("scripts/analyze-miss-to-bet-type-recovery-raw.ts", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

  assert.equal(pkg.scripts["analyze:miss-recovery"], "tsx scripts/analyze-miss-to-bet-type-recovery.ts");
  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /seenSettlementKeys\.has\(key\)/);
  assert.match(source, /MISS_RECOVERY_PAYOUT_DUPLICATE_COMBINATION/);
  assert.match(source, /const isPositivePayout = p\.payout_yen != null && p\.payout_yen > 0/);
  assert.match(source, /p\.returned !== 1 && !isPositivePayout/);
  assert.match(source, /MISS_RECOVERY_PAYOUT_INVALID_LINE/);
  assert.match(source, /MISS_RECOVERY_BUY_POPULATION_EMPTY/);
  assert.match(source, /MISS_RECOVERY_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /await import\("\.\/analyze-miss-to-bet-type-recovery-raw"\)/);
  assert.ok(
    source.indexOf("assertPayoutCompleteness();")
      < source.indexOf('await import("./analyze-miss-to-bet-type-recovery-raw")'),
  );

  assert.match(raw, /const payoutIndex = new Map<string, number>\(\)/);
  assert.match(raw, /const analyzed: RecoveryRow\[\] = \[\]/);
  assert.match(raw, /writeFileSync\(OUT_JSON/);
});
