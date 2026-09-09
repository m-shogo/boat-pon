import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("miss recovery normal entrypoint validates official settlement integrity before guarded analysis", () => {
  const source = readFileSync("scripts/analyze-miss-to-bet-type-recovery.ts", "utf8");
  const raw = readFileSync("scripts/analyze-miss-to-bet-type-recovery-raw.ts", "utf8");
  const internal = readFileSync("scripts/analyze-miss-to-bet-type-recovery-internal.ts", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

  assert.equal(pkg.scripts["analyze:miss-recovery"], "tsx scripts/analyze-miss-to-bet-type-recovery.ts");
  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /returned IS NULL OR returned != 0/);
  assert.match(source, /returned = 0/);
  assert.match(source, /MISS_RECOVERY_RETURNED_BUY_UNSUPPORTED/);
  assert.ok(source.indexOf("returned IS NULL OR returned != 0") < source.indexOf("const rows = db.prepare"));
  assert.match(source, /seenSettlementKeys\.has\(key\)/);
  assert.match(source, /MISS_RECOVERY_PAYOUT_DUPLICATE_COMBINATION/);
  assert.match(source, /const isPositivePayout = p\.payout_yen != null && p\.payout_yen > 0/);
  assert.match(source, /p\.returned !== 1 && !isPositivePayout/);
  assert.match(source, /p\.returned !== 1 && isPositivePayout/);
  assert.match(source, /MISS_RECOVERY_PAYOUT_INVALID_LINE/);
  assert.match(source, /MISS_RECOVERY_BUY_POPULATION_EMPTY/);
  assert.match(source, /MISS_RECOVERY_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /await import\("\.\/analyze-miss-to-bet-type-recovery-raw"\)/);
  assert.ok(
    source.indexOf("MISS_RECOVERY_RETURNED_BUY_UNSUPPORTED")
      < source.indexOf('await import("./analyze-miss-to-bet-type-recovery-raw")'),
  );
  assert.ok(
    source.indexOf("assertPayoutCompleteness();")
      < source.indexOf('await import("./analyze-miss-to-bet-type-recovery-raw")'),
  );

  assert.match(raw, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(raw, /process\.argv\[1\]/);
  assert.match(raw, /MISS_RECOVERY_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/analyze-miss-to-bet-type-recovery-internal"\)/);
  assert.match(internal, /const payoutIndex = new Map<string, number>\(\)/);
  assert.match(internal, /const analyzed: RecoveryRow\[\] = \[\]/);
  assert.match(internal, /writeFileSync\(OUT_JSON/);
  assert.match(internal, /readOnly: true/);
});
