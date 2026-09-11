import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entry = readFileSync("scripts/analyze-odds-payout-gap.ts", "utf8");
const raw = readFileSync("scripts/analyze-odds-payout-gap-raw.ts", "utf8");

test("odds-payout-gap canonical entrypoint verifies DB identity after preflight before internal analysis", () => {
  const gate = entry.indexOf("if (preflight !== 0)");
  const identity = entry.indexOf("ODDS_PAYOUT_GAP_DB_IDENTITY_INVALID");
  const internal = entry.indexOf('await import("./analyze-odds-payout-gap-internal")');

  assert.ok(gate >= 0);
  assert.ok(identity > gate);
  assert.ok(internal > identity, "internal analyzer must load only after payout preflight and canonical DB identity verification");
  assert.match(entry, /ODDS_PAYOUT_GAP_DB_MISSING/);
  assert.match(entry, /process\.env\.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(entry, /analyze-odds-payout-gap-raw/);
});

test("odds-payout-gap raw compatibility module cannot bypass canonical preflight", () => {
  assert.match(raw, /ODDS_PAYOUT_GAP_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/analyze-odds-payout-gap"\)/);
  assert.doesNotMatch(raw, /analyze-odds-payout-gap-internal/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
});
