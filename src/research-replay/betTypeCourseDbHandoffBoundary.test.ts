import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-bet-type-course-edge.ts", "utf8");
const raw = readFileSync("scripts/analyze-bet-type-course-edge-raw.ts", "utf8");

test("bet-type course entrypoint revalidates DB identity after settlement preflight before internal analysis", () => {
  const close = entrypoint.indexOf("db.close()");
  const handoff = entrypoint.indexOf("BET_TYPE_COURSE_DB_HANDOFF_IDENTITY_INVALID");
  const internalImport = entrypoint.indexOf('await import("./analyze-bet-type-course-edge-internal")');

  assert.ok(close >= 0);
  assert.ok(handoff > close, "DB identity must be revalidated after payout preflight DB closes");
  assert.ok(internalImport > handoff, "internal analyzer must load only after DB handoff revalidation");
  assert.match(entrypoint, /process\.env\.BOAT_PON_DB_PATH = handoffDbPath/);
  assert.doesNotMatch(entrypoint, /analyze-bet-type-course-edge-raw/);
});

test("bet-type course guarded raw compatibility module routes through canonical DB and settlement preflight", () => {
  const canonical = raw.indexOf('await import("./analyze-bet-type-course-edge")');

  assert.ok(canonical >= 0);
  assert.match(raw, /BET_TYPE_COURSE_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.doesNotMatch(raw, /BET_TYPE_COURSE_DB_IDENTITY_INVALID/);
  assert.doesNotMatch(raw, /BET_TYPE_COURSE_DB_MISSING/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(raw, /assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(raw, /analyze-bet-type-course-edge-internal/);
});
