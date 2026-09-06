import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("promising bet normal entrypoint validates settlement integrity before raw analyzer", () => {
  const source = readFileSync("scripts/analyze-promising-bet-type-strategies.ts", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

  assert.equal(pkg.scripts["analyze:promising-bet-types"], "tsx scripts/analyze-promising-bet-type-strategies.ts");
  assert.match(source, /seenSettlementKeys\.has\(key\)/);
  assert.match(source, /PROMISING_BET_PAYOUT_DUPLICATE_COMBINATION/);
  assert.match(source, /p\.returned === 1 \|\| \(p\.payout_yen != null && p\.payout_yen > 0\)/);
  assert.match(source, /PROMISING_BET_PAYOUT_INVALID_LINE/);
  assert.match(source, /settledRaceByType\.get\(p\.bet_type\)\?\.add\(p\.race_id\)/);
  assert.match(source, /assertPayoutCompleteness\(\)/);
  assert.match(source, /await import\("\.\/analyze-promising-bet-type-strategies-raw\.ts"\)/);
  assert.ok(
    source.indexOf("assertPayoutCompleteness();")
      < source.indexOf('await import("./analyze-promising-bet-type-strategies-raw.ts")'),
  );
});

test("promising bet core remains separated from the guarded normal entrypoint", () => {
  const raw = readFileSync("scripts/analyze-promising-bet-type-strategies-raw.ts", "utf8");
  assert.match(raw, /const STRATEGIES: StrategyDef\[\] =/);
  assert.match(raw, /const results = STRATEGIES\.map\(evaluate\)/);
  assert.match(raw, /writeFileSync\(OUT_JSON/);
});
