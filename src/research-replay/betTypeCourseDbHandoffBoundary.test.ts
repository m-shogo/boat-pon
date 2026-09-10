import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-bet-type-course-edge.ts", "utf8");
const raw = readFileSync("scripts/analyze-bet-type-course-edge-raw.ts", "utf8");

test("bet-type course entrypoint revalidates DB identity after settlement preflight before guarded raw import", () => {
  const close = entrypoint.indexOf("db.close()");
  const handoff = entrypoint.indexOf("BET_TYPE_COURSE_DB_HANDOFF_IDENTITY_INVALID");
  const rawImport = entrypoint.indexOf('await import("./analyze-bet-type-course-edge-raw")');

  assert.ok(close >= 0);
  assert.ok(handoff > close, "DB identity must be revalidated after payout preflight DB closes");
  assert.ok(rawImport > handoff, "guarded raw module must load only after DB handoff revalidation");
  assert.match(entrypoint, /process\.env\.BOAT_PON_DB_PATH = handoffDbPath/);
});

test("bet-type course guarded raw module verifies canonical DB identity before internal analysis", () => {
  const identity = raw.indexOf("BET_TYPE_COURSE_DB_IDENTITY_INVALID");
  const internal = raw.indexOf('await import("./analyze-bet-type-course-edge-internal")');

  assert.ok(identity >= 0);
  assert.ok(internal > identity, "internal analyzer must load only after canonical DB identity verification");
  assert.match(raw, /BET_TYPE_COURSE_DB_MISSING/);
  assert.match(raw, /process\.env\.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile/);
});
