import assert from "node:assert/strict";
import test from "node:test";
import {
  INTENT_SUPERSESSION_SCHEMA_VERSION,
  validateIntentSupersession,
} from "./intentSupersession";

function supersession(createdAt: string) {
  return {
    supersessionSchemaVersion: INTENT_SUPERSESSION_SCHEMA_VERSION,
    supersessionId: "SUPERSESSION-20260811-createdat-contract1",
    taskId: "TASK-N2-010",
    replacementIntentId: "INTENT-20260811-replacement2",
    supersededIntents: [{
      intentId: "INTENT-20260810-superseded2",
      expectedAuthoritySha: "aaaaaaa",
      reason: "AUTHORITY_SHA_MISMATCH",
    }],
    observedAuthoritySha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    createdAt,
    requestedBy: "test",
  };
}

test("supersession createdAt accepts an RFC3339 date-time", () => {
  const result = validateIntentSupersession(supersession("2026-08-11T00:00:00.000Z"));
  assert.equal(result.valid, true, result.errors.join("; "));
});

test("supersession createdAt rejects date-only strings accepted by Date.parse", () => {
  const result = validateIntentSupersession(supersession("2026-08-11"));
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /invalid createdAt/);
});
