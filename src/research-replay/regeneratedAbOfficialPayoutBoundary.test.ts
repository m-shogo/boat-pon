import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-regenerated-ab.ts", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

test("normal regenerated A/B commands fail closed instead of using quote odds as realized payout", () => {
  assert.equal(pkg.scripts?.["analyze:regenerated-ab"], "tsx scripts/analyze-regenerated-ab.ts");
  assert.equal(
    pkg.scripts?.["analyze:regenerated-ab:full"],
    "BOAT_PON_REGEN_SCOPE=odds-results tsx scripts/analyze-regenerated-ab.ts",
  );
  assert.match(entrypoint, /REGENERATED_AB_OFFICIAL_PAYOUT_REQUIRED/);
  assert.match(entrypoint, /official race_payouts\.payout_yen/);
  assert.match(entrypoint, /complete settlement coverage/);
  assert.doesNotMatch(entrypoint, /new DatabaseSync/);
  assert.doesNotMatch(entrypoint, /writeFileSync/);
  assert.doesNotMatch(entrypoint, /currentOdds\s*\*\s*100/);
  assert.equal(
    existsSync("scripts/analyze-regenerated-ab-raw.ts"),
    false,
    "unsafe quote-based raw analyzer must not remain as a direct-invocation bypass",
  );
});
