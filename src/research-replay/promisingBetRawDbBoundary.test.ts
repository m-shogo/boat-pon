import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-promising-bet-type-strategies.ts", "utf8");
const raw = readFileSync("scripts/analyze-promising-bet-type-strategies-raw.ts", "utf8");

test("promising bet entrypoint completes settlement validation and verified DB handoff before isolated internal analysis", () => {
  const completeness = entrypoint.indexOf("assertPayoutCompleteness()");
  const closeAfterCompleteness = entrypoint.indexOf("db.close();", completeness);
  const handoff = entrypoint.indexOf("PROMISING_BET_DB_HANDOFF_IDENTITY_INVALID");
  const childHandoff = entrypoint.indexOf("PROMISING_BET_DB_CHILD_HANDOFF_IDENTITY_INVALID");
  const launch = entrypoint.indexOf("spawnSync(process.execPath");

  assert.ok(completeness >= 0);
  assert.ok(closeAfterCompleteness > completeness, "canonical preflight DB must close after settlement validation");
  assert.ok(handoff > closeAfterCompleteness, "DB identity must be revalidated after settlement validation closes the preflight DB");
  assert.ok(childHandoff > handoff, "verified DB must be revalidated at the child handoff boundary");
  assert.ok(launch > childHandoff, "isolated internal analyzer must launch only after the child DB handoff revalidation");
  assert.match(entrypoint, /const verifiedDbPath = assertCanonicalSingleLinkRegularFile/);
  assert.match(entrypoint, /const childDbPath = assertCanonicalSingleLinkRegularFile/);
  assert.match(entrypoint, /cwd: workspace/);
  assert.match(entrypoint, /BOAT_PON_DB_PATH: childDbPath/);
  assert.doesNotMatch(entrypoint, /process\.env\.BOAT_PON_DB_PATH\s*=/);
  assert.doesNotMatch(entrypoint, /await import\("\.\/analyze-promising-bet-type-strategies-internal"\)/);
  assert.doesNotMatch(entrypoint, /analyze-promising-bet-type-strategies-raw/);
});

test("promising bet guarded raw module cannot bypass canonical preflight", () => {
  assert.match(raw, /PROMISING_BET_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/analyze-promising-bet-type-strategies"\)/);
  assert.doesNotMatch(raw, /analyze-promising-bet-type-strategies-internal/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
});
