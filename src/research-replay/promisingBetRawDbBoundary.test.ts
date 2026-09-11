import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-promising-bet-type-strategies.ts", "utf8");
const raw = readFileSync("scripts/analyze-promising-bet-type-strategies-raw.ts", "utf8");

test("promising bet entrypoint completes settlement validation and DB handoff before internal analysis", () => {
  const completeness = entrypoint.indexOf("assertPayoutCompleteness()");
  const close = entrypoint.indexOf("db.close()");
  const handoff = entrypoint.indexOf("PROMISING_BET_DB_HANDOFF_IDENTITY_INVALID");
  const internal = entrypoint.indexOf('await import("./analyze-promising-bet-type-strategies-internal")');

  assert.ok(completeness >= 0);
  assert.ok(close > completeness, "canonical preflight DB must close after settlement validation");
  assert.ok(handoff > close, "DB identity must be revalidated after settlement validation closes the preflight DB");
  assert.ok(internal > handoff, "internal analyzer must load only after the verified DB handoff");
  assert.match(entrypoint, /process\.env\.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(entrypoint, /analyze-promising-bet-type-strategies-raw/);
});

test("promising bet guarded raw module cannot bypass canonical preflight", () => {
  assert.match(raw, /PROMISING_BET_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/analyze-promising-bet-type-strategies"\)/);
  assert.doesNotMatch(raw, /analyze-promising-bet-type-strategies-internal/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
});