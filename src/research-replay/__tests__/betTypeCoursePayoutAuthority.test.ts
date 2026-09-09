import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("bet type course normal entrypoint validates settlement integrity before raw analysis", () => {
  const source = readFileSync("scripts/analyze-bet-type-course-edge.ts", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

  assert.equal(pkg.scripts["analyze:bet-type-course-edge"], "tsx scripts/analyze-bet-type-course-edge.ts");
  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /throw new Error\("BET_TYPE_COURSE_PRIMARY_DB_MISSING"\)/);
  assert.doesNotMatch(source, /BET_TYPE_COURSE_DB_NOT_FOUND \$\{DB_PATH\}/);
  assert.match(source, /const BET_TYPES = \["trifecta", "trio", "exacta", "quinella"\] as const/);
  assert.match(source, /returned IS NULL OR returned != 0/);
  assert.match(source, /returned = 0/);
  assert.match(source, /BET_TYPE_COURSE_RETURNED_BUY_UNSUPPORTED/);
  assert.ok(source.indexOf("returned IS NULL OR returned != 0") < source.indexOf("const rows = db.prepare"));
  assert.match(source, /seenSettlementKeys\.has\(key\)/);
  assert.match(source, /BET_TYPE_COURSE_PAYOUT_DUPLICATE_COMBINATION/);
  assert.match(source, /p\.returned !== 0 && p\.returned !== 1/);
  assert.match(source, /BET_TYPE_COURSE_PAYOUT_RETURN_STATE_INVALID/);
  assert.match(source, /const isPositivePayout = p\.payout_yen != null && p\.payout_yen > 0/);
  assert.match(source, /p\.returned === 0 && !isPositivePayout/);
  assert.match(source, /BET_TYPE_COURSE_PAYOUT_INVALID_LINE/);
  assert.match(source, /p\.returned === 0 && isPositivePayout/);
  assert.match(source, /BET_TYPE_COURSE_BUY_POPULATION_EMPTY/);
  assert.match(source, /BET_TYPE_COURSE_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /await import\("\.\/analyze-bet-type-course-edge-raw"\)/);
  assert.ok(
    source.indexOf("BET_TYPE_COURSE_RETURNED_BUY_UNSUPPORTED")
      < source.indexOf('await import("./analyze-bet-type-course-edge-raw")'),
  );
  assert.ok(
    source.indexOf("BET_TYPE_COURSE_PAYOUT_RETURN_STATE_INVALID")
      < source.indexOf('await import("./analyze-bet-type-course-edge-raw")'),
  );
  assert.ok(
    source.indexOf("assertPayoutCompleteness();")
      < source.indexOf('await import("./analyze-bet-type-course-edge-raw")'),
  );
});

test("bet type course raw compatibility module blocks direct CLI bypass", () => {
  const raw = readFileSync("scripts/analyze-bet-type-course-edge-raw.ts", "utf8");
  assert.match(raw, /BET_TYPE_COURSE_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /process\.argv\[1\]/);
  assert.match(raw, /await import\("\.\/analyze-bet-type-course-edge-internal"\)/);
  assert.doesNotMatch(raw, /DatabaseSync/);
  assert.doesNotMatch(raw, /DB_PATH/);
  assert.doesNotMatch(raw, /const payoutIndex = new Map<string, number>\(\)/);
});

test("bet type course internal analyzer retains read-only behavior without exposing configured database paths", () => {
  const internal = readFileSync("scripts/analyze-bet-type-course-edge-internal.ts", "utf8");
  assert.match(internal, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(internal, /PRAGMA query_only=ON/);
  assert.match(internal, /const payoutIndex = new Map<string, number>\(\)/);
  assert.match(internal, /const courseGroups: CourseEdgeGroup\[\] =/);
  assert.match(internal, /writeFileSync\(OUT_JSON/);
  assert.match(internal, /BET_TYPE_COURSE_PRIMARY_DB_MISSING/);
  assert.match(internal, /DB: canonical research database \(path redacted\)/);
  assert.doesNotMatch(internal, /DB not found: \$\{DB_PATH\}/);
  assert.doesNotMatch(internal, /DB: \$\{DB_PATH\}/);
});
