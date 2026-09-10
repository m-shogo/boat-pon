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

test("skip6R historical switch raw path revalidates the DB after canonical settlement preflight", () => {
  assert.match(raw, /SKIP6R_SWITCH_HISTORICAL_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /invokedPath === rawEntrypointPath/);
  assert.match(raw, /SKIP6R_SWITCH_HISTORICAL_RAW_DB_MISSING/);
  assert.match(raw, /SKIP6R_SWITCH_HISTORICAL_RAW_DB_IDENTITY_INVALID/);
  assert.match(raw, /assertCanonicalSingleLinkRegularFile/);
  assert.match(raw, /process\.env\.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile/);
  assert.match(raw, /await import\("\.\/analyze-skip6r-switch-historical-closing-odds-internal"\)/);
  assert.doesNotMatch(raw, /DB not found: \$\{/);

  const guard = raw.indexOf("SKIP6R_SWITCH_HISTORICAL_RAW_DIRECT_EXECUTION_FORBIDDEN");
  const identity = raw.indexOf("SKIP6R_SWITCH_HISTORICAL_RAW_DB_IDENTITY_INVALID");
  const internalImport = raw.indexOf('await import("./analyze-skip6r-switch-historical-closing-odds-internal")');
  assert.ok(guard >= 0 && identity > guard && internalImport > identity);
});