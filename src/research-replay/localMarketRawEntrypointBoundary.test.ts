import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const raw = readFileSync("scripts/analyze-local-market-anomalies-raw.ts", "utf8");
const internal = readFileSync("scripts/analyze-local-market-anomalies-internal.ts", "utf8");

test("local market raw compatibility module cannot be invoked directly", () => {
  assert.match(raw, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(raw, /process\.argv\[1\]/);
  assert.match(raw, /LOCAL_MARKET_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/analyze-local-market-anomalies-internal"\)/);
});

test("isolated local market implementation remains research-only and read-only", () => {
  assert.match(internal, /historical_alternative_odds/);
  assert.match(internal, /new DatabaseSync/);
  assert.match(internal, /readOnly: true/);
  assert.match(internal, /PRAGMA query_only=ON/);
  assert.doesNotMatch(internal, /db\.(?:exec|prepare)\(\s*[`\"']\s*(?:INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
});
