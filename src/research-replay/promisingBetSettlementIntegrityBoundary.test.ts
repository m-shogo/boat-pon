import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("promising bet normal entrypoint validates settlement integrity before raw analyzer", () => {
  const source = readFileSync("scripts/analyze-promising-bet-type-strategies.ts", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

  assert.equal(pkg.scripts["analyze:promising-bet-types"], "tsx scripts/analyze-promising-bet-type-strategies.ts");
  assert.match(source, /throw new Error\("PROMISING_BET_PRIMARY_DB_MISSING"\)/);
  assert.doesNotMatch(source, /PROMISING_BET_DB_NOT_FOUND \$\{DB_PATH\}/);
  assert.match(source, /returned IS NULL OR returned != 0/);
  assert.match(source, /returned = 0/);
  assert.match(source, /PROMISING_BET_RETURNED_BUY_UNSUPPORTED/);
  assert.ok(source.indexOf("returned IS NULL OR returned != 0") < source.indexOf("const rows = db.prepare"));
  assert.match(source, /seenSettlementKeys\.has\(key\)/);
  assert.match(source, /PROMISING_BET_PAYOUT_DUPLICATE_COMBINATION/);
  assert.match(source, /p\.returned !== 0 && p\.returned !== 1/);
  assert.match(source, /PROMISING_BET_PAYOUT_RETURN_STATE_INVALID/);
  assert.match(source, /const isPositivePayout = p\.payout_yen != null && p\.payout_yen > 0/);
  assert.match(source, /p\.returned === 0 && !isPositivePayout/);
  assert.match(source, /PROMISING_BET_PAYOUT_INVALID_LINE/);
  assert.match(source, /p\.returned === 0 && isPositivePayout/);
  assert.match(source, /settledRaceByType\.get\(p\.bet_type\)\?\.add\(p\.race_id\)/);
  assert.match(source, /p\.returned === 1/);
  assert.match(source, /returnedRaceByType\.get\(p\.bet_type\)\?\.add\(p\.race_id\)/);
  assert.match(source, /PROMISING_BET_PARTIAL_RETURN_UNSUPPORTED/);
  assert.ok(
    source.indexOf("PROMISING_BET_PARTIAL_RETURN_UNSUPPORTED")
      < source.indexOf("PROMISING_BET_PAYOUT_COVERAGE_INCOMPLETE"),
  );
  assert.match(source, /assertPayoutCompleteness\(\)/);
  assert.match(source, /await import\("\.\/analyze-promising-bet-type-strategies-raw"\)/);
  assert.ok(
    source.indexOf("PROMISING_BET_RETURNED_BUY_UNSUPPORTED")
      < source.indexOf('await import("./analyze-promising-bet-type-strategies-raw")'),
  );
  assert.ok(
    source.indexOf("PROMISING_BET_PAYOUT_RETURN_STATE_INVALID")
      < source.indexOf('await import("./analyze-promising-bet-type-strategies-raw")'),
  );
  assert.ok(
    source.indexOf("PROMISING_BET_PARTIAL_RETURN_UNSUPPORTED")
      < source.indexOf('await import("./analyze-promising-bet-type-strategies-raw")'),
  );
  assert.ok(
    source.indexOf("assertPayoutCompleteness();")
      < source.indexOf('await import("./analyze-promising-bet-type-strategies-raw")'),
  );
});

test("promising bet raw compatibility module blocks direct CLI bypass", () => {
  const raw = readFileSync("scripts/analyze-promising-bet-type-strategies-raw.ts", "utf8");
  assert.match(raw, /PROMISING_BET_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /process\.argv\[1\]/);
  assert.match(raw, /await import\("\.\/analyze-promising-bet-type-strategies-internal"\)/);
  assert.doesNotMatch(raw, /DatabaseSync/);
  assert.doesNotMatch(raw, /DB_PATH/);
  assert.doesNotMatch(raw, /const STRATEGIES: StrategyDef\[\] =/);
});

test("promising bet internal analyzer retains the read-only research implementation", () => {
  const internal = readFileSync("scripts/analyze-promising-bet-type-strategies-internal.ts", "utf8");
  assert.match(internal, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(internal, /PRAGMA query_only=ON/);
  assert.match(internal, /const STRATEGIES: StrategyDef\[\] =/);
  assert.match(internal, /const results = STRATEGIES\.map\(evaluate\)/);
  assert.match(internal, /writeFileSync\(OUT_JSON/);
});
