import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/audit-t5-historical-market-forward.ts", "utf8");

test("T-5 historical market forward verifies DB and model identities before reading", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "T5_HISTORICAL_MARKET_DB_IDENTITY_INVALID"\)/u);
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(MODEL_PATH, "T5_HISTORICAL_MARKET_MODEL_IDENTITY_INVALID"\)/u);
  assert.match(source, /readFileSync\(verifiedModelPath, "utf8"\)/u);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/u);
  assert.match(source, /PRAGMA query_only=ON/u);
});

test("T-5 historical market forward keeps configured private paths out of errors and reports", () => {
  assert.match(source, /T5_HISTORICAL_MARKET_DB_MISSING/u);
  assert.match(source, /T5_HISTORICAL_MARKET_MODEL_MISSING/u);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/u);
  assert.doesNotMatch(source, /model artifact not found: \$\{MODEL_PATH\}/u);
  assert.doesNotMatch(source, /artifact: MODEL_PATH/u);
  assert.match(source, /artifact: "historical-ranking-model"/u);
});
