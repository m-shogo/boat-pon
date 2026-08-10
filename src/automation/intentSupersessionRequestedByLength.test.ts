import assert from "node:assert/strict";
import test from "node:test";
import {
  INTENT_SUPERSESSION_SCHEMA_VERSION,
  validateIntentSupersession,
} from "./intentSupersession";

function supersession(requestedBy: string) {
  return {
    supersessionSchemaVersion: INTENT_SUPERSESSION_SCHEMA_VERSION,
    supersessionId: "SUPERSESSION-20260811-requester-bound1",
    taskId: "TASK-N2-010",
    replacementIntentId: "INTENT-20260811-replacement1",
    supersededIntents: [{
      intentId: "INTENT-20260810-superseded1",
      expectedAuthoritySha: "aaaaaaa",
      reason: "AUTHORITY_SHA_MISMATCH",
    }],
    observedAuthoritySha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    createdAt: "2026-08-11T00:00:00.000Z",
    requestedBy,
  };
}

test("supersession requestedBy accepts the schema maximum", () => {
  const result = validateIntentSupersession(supersession("x".repeat(128)));
  assert.equal(result.valid, true, result.errors.join("; "));
});

test("supersession requestedBy rejects values longer than the schema maximum", () => {
  const result = validateIntentSupersession(supersession("x".repeat(129)));
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /invalid requestedBy/);
});
