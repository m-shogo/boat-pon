import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entry = readFileSync("scripts/report-review-summary.ts", "utf8");
const raw = readFileSync("scripts/report-review-summary-raw.ts", "utf8");

test("review summary normal entrypoint pins the canonical research DB before raw reporting", () => {
  assert.match(entry, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/);
  assert.match(entry, /BOAT_PON_DB_PATH: verifiedDbPath/);
  const verifyAt = entry.indexOf("assertCanonicalSingleLinkRegularFile");
  const rawAt = entry.indexOf("report-review-summary-raw.ts");
  assert.ok(verifyAt >= 0 && rawAt > verifyAt);
});

test("raw review summary remains read-only and fails payout metrics closed on missing hit payouts", () => {
  assert.match(raw, /new DatabaseSync\(DB_PATH, \{ readOnly: true \}\)/);
  assert.match(raw, /missing_payout_hits > 0 THEN NULL ELSE ROUND/);
});
