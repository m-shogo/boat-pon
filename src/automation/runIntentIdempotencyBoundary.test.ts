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
