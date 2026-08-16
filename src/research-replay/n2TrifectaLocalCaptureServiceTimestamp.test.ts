import assert from "node:assert/strict";
import test from "node:test";

import {
  N2_TRIFECTA_LOCAL_CAPTURE_AUTHORIZATION_VERSION,
  auditN2TrifectaLocalCaptureAuthorization,
  type N2TrifectaLocalCaptureAuthorization,
} from "./n2TrifectaLocalCaptureService.js";

function authorization(
  overrides: Partial<N2TrifectaLocalCaptureAuthorization> = {},
): N2TrifectaLocalCaptureAuthorization {
  return {
    authorizationVersion: N2_TRIFECTA_LOCAL_CAPTURE_AUTHORIZATION_VERSION,
    authorizationId: "AUTH-N2-TRI-LOCAL-private-research-0001",
    issuedAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    stage: "ONE_VENUE_REVIEW",
    maxRequestsPerDay: 48,
    checkpointLabels: ["T-30", "T-20", "T-10", "T-5"],
    minInterRequestMs: 10_000,
    privateResearchOnly: true,
    publicRedistributionAuthorized: false,
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    automatedBettingAuthorized: false,
    ...overrides,
  };
}

test("local capture authorization rejects JavaScript-normalized timestamps", () => {
  const invalidNow = auditN2TrifectaLocalCaptureAuthorization({
    authorization: authorization(),
    now: "2026-08-05T24:00:00.000Z",
  });
  assert.equal(invalidNow.status, "BLOCKED");
  assert.ok(invalidNow.blockers.includes("NOW_INVALID"));
  assert.equal(invalidNow.networkExecutionAuthorized, false);

  const invalidIssuedAt = auditN2TrifectaLocalCaptureAuthorization({
    authorization: authorization({ issuedAt: "2026-02-30T00:00:00.000Z" }),
    now: "2026-08-06T00:35:00.000Z",
  });
  assert.equal(invalidIssuedAt.status, "BLOCKED");
  assert.ok(invalidIssuedAt.blockers.includes("ISSUED_AT_INVALID"));
  assert.equal(invalidIssuedAt.networkExecutionAuthorized, false);

  const timezoneLessExpiry = auditN2TrifectaLocalCaptureAuthorization({
    authorization: authorization({ expiresAt: "2026-09-01T00:00:00.000" }),
    now: "2026-08-06T00:35:00.000Z",
  });
  assert.equal(timezoneLessExpiry.status, "BLOCKED");
  assert.ok(timezoneLessExpiry.blockers.includes("EXPIRES_AT_INVALID"));
  assert.equal(timezoneLessExpiry.networkExecutionAuthorized, false);
});

test("local capture authorization keeps valid leap-day and explicit-offset timestamps", () => {
  const valid = auditN2TrifectaLocalCaptureAuthorization({
    authorization: authorization({
      issuedAt: "2028-02-29T09:00:00+09:00",
      expiresAt: "2028-03-01T09:00:00+09:00",
    }),
    now: "2028-02-29T12:00:00+09:00",
  });
  assert.deepEqual(valid, {
    status: "PASS",
    blockers: [],
    localServiceAuthorized: true,
    networkExecutionAuthorized: true,
    databaseWriteAuthorized: false,
    publicPublishAuthorized: false,
    automatedBettingAuthorized: false,
  });
});
