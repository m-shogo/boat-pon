import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-promising-bet-type-strategies.ts", "utf8");
const raw = readFileSync("scripts/analyze-promising-bet-type-strategies-raw.ts", "utf8");

test("promising bet entrypoint completes settlement validation before guarded raw import", () => {
  const completeness = entrypoint.indexOf("assertPayoutCompleteness()");
  const close = entrypoint.indexOf("db.close()");
  const rawImport = entrypoint.indexOf('await import("./analyze-promising-bet-type-strategies-raw")');

  assert.ok(completeness >= 0);
  assert.ok(close > completeness, "canonical preflight DB must close after settlement validation");
  assert.ok(rawImport > close, "guarded raw module must load only after settlement validation closes the DB");
});

test("promising bet guarded raw module revalidates canonical DB identity before internal analysis", () => {
  const identity = raw.indexOf("PROMISING_BET_RAW_DB_IDENTITY_INVALID");
  const internal = raw.indexOf('await import("./analyze-promising-bet-type-strategies-internal")');

  assert.ok(identity >= 0);
  assert.ok(internal > identity, "internal analyzer must load only after raw DB identity revalidation");
  assert.match(raw, /PROMISING_BET_RAW_DB_MISSING/);
  assert.match(raw, /process\.env\.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(raw, /DB not found: \$\{configuredDbPath\}/);
});
