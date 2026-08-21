import assert from "node:assert/strict";
import test from "node:test";

import { semanticPayloadHash, validateTypedPayload } from "./domain";

function settlementPayload(candidateCount: number) {
  return {
    canonicalRaceKey: "2026-08-05:11:R1",
    sourceKind: "official_archive" as const,
    parseStatus: "success" as const,
    candidateCount,
    diagnosticCodes: [] as string[],
  };
}

test("settlement typed payload rejects unsafe candidate counts", () => {
  assert.throws(
    () => validateTypedPayload(
      "settlement_result",
      settlementPayload(Number.MAX_SAFE_INTEGER + 1),
    ),
    /invalid settlement candidate count/,
  );
  assert.throws(
    () => semanticPayloadHash(
      "settlement_parse_diagnostic",
      settlementPayload(Number.MAX_SAFE_INTEGER + 1),
    ),
    /invalid settlement candidate count/,
  );
});

test("settlement typed payload keeps safe non-negative candidate counts", () => {
  const payload = settlementPayload(Number.MAX_SAFE_INTEGER);
  assert.equal(
    validateTypedPayload("settlement_result", payload).candidateCount,
    Number.MAX_SAFE_INTEGER,
  );
  assert.match(semanticPayloadHash("settlement_result", payload), /^[0-9a-f]{64}$/u);
});
