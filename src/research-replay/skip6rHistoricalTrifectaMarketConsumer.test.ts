import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const internal = readFileSync("scripts/analyze-skip6r-switch-historical-closing-odds-internal.ts", "utf8");
const raw = readFileSync("scripts/analyze-skip6r-switch-historical-closing-odds-raw.ts", "utf8");

test("skip6R historical switch uses the shared canonical trifecta market authority", () => {
  assert.match(internal, /historicalTrifectaCanonicalSourcePredicate\("h"\)/);
  assert.match(internal, /historicalTrifectaCompleteMarketPredicate\("h\.race_id"\)/);
  assert.match(internal, /h\.bet_type = 'trifecta'/);
  assert.doesNotMatch(internal, /WHERE source_quality = 'historical_closing_odds'/);
});

test("skip6R historical switch raw path cannot bypass canonical settlement preflight", () => {
  assert.match(raw, /SKIP6R_SWITCH_HISTORICAL_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /invokedPath === rawEntrypointPath/);
  assert.match(raw, /await import\("\.\/analyze-skip6r-switch-historical-closing-odds-internal"\)/);
});
