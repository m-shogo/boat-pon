import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("bet type course normal entrypoint validates settlement integrity before raw analysis", () => {
  const source = readFileSync("scripts/analyze-bet-type-course-edge.ts", "utf8");
  const raw = readFileSync("scripts/analyze-bet-type-course-edge-raw.ts", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

  assert.equal(pkg.scripts["analyze:bet-type-course-edge"], "tsx scripts/analyze-bet-type-course-edge.ts");
  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /const BET_TYPES = \["trifecta", "trio", "exacta", "quinella"\] as const/);
  assert.match(source, /seenSettlementKeys\.has\(key\)/);
  assert.match(source, /BET_TYPE_COURSE_PAYOUT_DUPLICATE_COMBINATION/);
  assert.match(source, /const isPositivePayout = p\.payout_yen != null && p\.payout_yen > 0/);
  assert.match(source, /p\.returned !== 1 && !isPositivePayout/);
  assert.match(source, /BET_TYPE_COURSE_PAYOUT_INVALID_LINE/);
  assert.match(source, /p\.returned !== 1 && isPositivePayout/);
  assert.match(source, /BET_TYPE_COURSE_BUY_POPULATION_EMPTY/);
  assert.match(source, /BET_TYPE_COURSE_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /await import\("\.\/analyze-bet-type-course-edge-raw"\)/);
  assert.ok(
    source.indexOf("assertPayoutCompleteness();")
      < source.indexOf('await import("./analyze-bet-type-course-edge-raw")'),
  );

  assert.match(raw, /const payoutIndex = new Map<string, number>\(\)/);
  assert.match(raw, /const groups = new Map<string, GroupAgg>\(\)/);
  assert.match(raw, /writeFileSync\(OUT_JSON/);
});
