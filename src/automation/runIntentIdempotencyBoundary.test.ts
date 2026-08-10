import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("runner preserves the first idempotency record when a key is reused", () => {
  const source = readFileSync("scripts/run-intent-task.ts", "utf8");

  assert.match(
    source,
    /if \(!\(idempotencyKey in reqs\.idempotencyKeys\)\) \{\s*reqs\.idempotencyKeys\[idempotencyKey\] = \{ requestId, result, evidencePath, recordedAt: nowIso\(\) \};\s*\}/,
    "an existing idempotency key must keep its canonical first-writer provenance",
  );
});

test("runner validates both durable replay ledgers before appending either one", () => {
  const source = readFileSync("scripts/run-intent-task.ts", "utf8");
  const append = source.slice(source.indexOf("function appendLedgers("));

  assert.doesNotMatch(append, /readJson\(PROCESSED_(?:INT|REQ)\)\s*\?\?/, "missing ledgers must not be recreated as empty history");
  assert.match(append, /if \(!intents\) throw new Error\("missing processed intent ledger during append"\)/);
  assert.match(append, /if \(!reqs\) throw new Error\("missing processed request ledger during append"\)/);
  assert.ok(append.indexOf("isIntentProcessed(intents, intentId)") < append.indexOf("writeJsonAtomic(PROCESSED_INT, intents)"));
  assert.ok(append.indexOf("isRequestReplay(reqs, requestId)") < append.indexOf("writeJsonAtomic(PROCESSED_INT, intents)"));
  assert.ok(append.indexOf("findIdempotentSuccess(reqs, idempotencyKey)") < append.indexOf("writeJsonAtomic(PROCESSED_INT, intents)"));
});
