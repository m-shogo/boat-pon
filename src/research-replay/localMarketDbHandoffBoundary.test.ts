import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-local-market-anomalies.ts", "utf8");
const raw = readFileSync("scripts/analyze-local-market-anomalies-raw.ts", "utf8");

test("local market entrypoint revalidates DB identity after settlement preflight before internal analysis", () => {
  const close = entrypoint.indexOf("db.close()");
  const handoff = entrypoint.indexOf("LOCAL_MARKET_DB_HANDOFF_IDENTITY_INVALID");
  const internalImport = entrypoint.indexOf('await import("./analyze-local-market-anomalies-internal")');

  assert.ok(close >= 0);
  assert.ok(handoff > close, "DB identity must be revalidated after exacta settlement preflight closes the DB");
  assert.ok(internalImport > handoff, "internal analyzer must load only after DB handoff revalidation");
  assert.match(entrypoint, /process\.env\.BOAT_PON_DB_PATH = handoffDbPath/);
  assert.doesNotMatch(entrypoint, /analyze-local-market-anomalies-raw/);
});

test("local market guarded raw module cannot bypass canonical settlement preflight", () => {
  assert.match(raw, /LOCAL_MARKET_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/analyze-local-market-anomalies"\)/);
  assert.doesNotMatch(raw, /analyze-local-market-anomalies-internal/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(raw, /DatabaseSync/);
});
