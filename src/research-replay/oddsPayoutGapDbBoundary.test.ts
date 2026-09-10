import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const raw = readFileSync("scripts/analyze-odds-payout-gap-raw.ts", "utf8");

test("odds-payout-gap guarded raw module verifies canonical DB identity before internal analysis", () => {
  const identity = raw.indexOf("ODDS_PAYOUT_GAP_DB_IDENTITY_INVALID");
  const internal = raw.indexOf('await import("./analyze-odds-payout-gap-internal")');

  assert.ok(identity >= 0);
  assert.ok(internal > identity, "internal analyzer must load only after canonical DB identity verification");
  assert.match(raw, /ODDS_PAYOUT_GAP_DB_MISSING/);
  assert.match(raw, /process\.env\.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(raw, /DB not found: \$\{configuredDbPath\}/);
});
