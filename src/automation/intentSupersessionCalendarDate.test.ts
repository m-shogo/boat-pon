import assert from "node:assert/strict";
import test from "node:test";
import {
  INTENT_SUPERSESSION_SCHEMA_VERSION,
  validateIntentSupersession,
} from "./intentSupersession";

function supersession(createdAt: string) {
  return {
    supersessionSchemaVersion: INTENT_SUPERSESSION_SCHEMA_VERSION,
    supersessionId: "SUPERSESSION-20260813-calendar-contract1",
    taskId: "TASK-N2-010",
    replacementIntentId: "INTENT-20260813-replacement1",
    supersededIntents: [{
      intentId: "INTENT-20260812-superseded1",
      expectedAuthoritySha: "aaaaaaa",
      reason: "AUTHORITY_SHA_MISMATCH",
    }],
    observedAuthoritySha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    createdAt,
    requestedBy: "test",
  };
}

test("supersession createdAt rejects impossible Gregorian calendar dates", () => {
  for (const createdAt of [
    "2026-02-29T00:00:00Z",
    "2026-02-30T00:00:00Z",
    "2026-04-31T12:34:56+09:00",
  ]) {
    const result = validateIntentSupersession(supersession(createdAt));
    assert.equal(result.valid, false, createdAt);
    assert.match(result.errors.join("\n"), /invalid createdAt/);
  }
});

test("supersession createdAt accepts a valid leap day with an offset", () => {
  const result = validateIntentSupersession(supersession("2028-02-29T12:34:56+09:00"));
  assert.equal(result.valid, true, result.errors.join("; "));
});
