import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-local-market-anomalies.ts", "utf8");
const raw = readFileSync("scripts/analyze-local-market-anomalies-raw.ts", "utf8");

test("local market entrypoint revalidates DB identity after settlement preflight before guarded raw import", () => {
  const close = entrypoint.indexOf("db.close()");
  const handoff = entrypoint.indexOf("LOCAL_MARKET_DB_HANDOFF_IDENTITY_INVALID");
  const rawImport = entrypoint.indexOf('await import("./analyze-local-market-anomalies-raw")');

  assert.ok(close >= 0);
  assert.ok(handoff > close, "DB identity must be revalidated after exacta settlement preflight closes the DB");
  assert.ok(rawImport > handoff, "guarded raw module must load only after DB handoff revalidation");
  assert.match(entrypoint, /process\.env\.BOAT_PON_DB_PATH = handoffDbPath/);
});

test("local market guarded raw module verifies canonical DB identity before internal analysis", () => {
  const identity = raw.indexOf("LOCAL_MARKET_DB_IDENTITY_INVALID");
  const internal = raw.indexOf('await import("./analyze-local-market-anomalies-internal")');

  assert.ok(identity >= 0);
  assert.ok(internal > identity, "internal analyzer must load only after canonical DB identity verification");
  assert.match(raw, /LOCAL_MARKET_DB_MISSING/);
  assert.match(raw, /process\.env\.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile/);
});
