import assert from "node:assert/strict";
import test from "node:test";

import {
  N2_TRIFECTA_ODDS_BASE_CHECKPOINTS,
  N2_TRIFECTA_ODDS_CAPTURE_APPROVAL_SCOPE,
  auditN2TrifectaOddsCaptureApproval,
  buildN2TrifectaOddsCheckpointPlan,
  buildN2TrifectaRawRelativePath,
  estimateBlindFiveMinutePollingRequests,
  type N2TrifectaOddsCaptureApproval,
  type N2TrifectaOddsRaceInput,
} from "./n2TrifectaOddsCheckpointCollection.js";

function races(venueCode = "05", count = 12, date = "2026-08-06"): N2TrifectaOddsRaceInput[] {
  return Array.from({ length: count }, (_, index) => ({
    date,
    venueCode,
    raceNo: index + 1,
    closeAt: `${String(10 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 === 0 ? "05" : "35"}`,
  }));
}

test("all races retain T-30/T-20/T-10/T-5 and all 120 selections per request", () => {
  const plan = buildN2TrifectaOddsCheckpointPlan({
    stage: "ONE_VENUE_REVIEW",
    races: races(),
  });

  assert.equal(plan.status, "READY_FOR_PRIVATE_REVIEW");
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.raceCount, 12);
  assert.equal(plan.venueDayCount, 1);
  assert.equal(plan.checkpointCountPerRace, 4);
  assert.equal(plan.requestBudget, 48);
  assert.equal(plan.entries.length, 48);
  assert.equal(plan.allSelectionsPerRequest, 120);
  assert.equal(plan.concurrency, 1);
  assert.equal(plan.minInterRequestMs, 10_000);
  assert.equal(plan.immediateRetryAuthorized, false);
  assert.equal(plan.blindFiveMinutePollingAuthorized, false);
  assert.equal(plan.databaseWriteAuthorized, false);
  assert.equal(plan.currentBuyConnectionAuthorized, false);
  assert.equal(plan.lineConnectionAuthorized, false);
  assert.equal(plan.publicPublishAuthorized, false);

  for (const raceNo of Array.from({ length: 12 }, (_, index) => index + 1)) {
    const checkpoints = plan.entries
      .filter((entry) => entry.raceNo === raceNo)
      .map((entry) => entry.checkpointMinutes)
      .sort((a, b) => b - a);
    assert.deepEqual(checkpoints, [...N2_TRIFECTA_ODDS_BASE_CHECKPOINTS]);
  }
});

test("checkpoint plan rejects impossible race dates instead of normalizing them", () => {
  const impossible = buildN2TrifectaOddsCheckpointPlan({
    stage: "ONE_VENUE_REVIEW",
    races: races("05", 1, "2026-02-30"),
  });
  assert.equal(impossible.status, "BLOCKED");
  assert.equal(impossible.entries.length, 0);
  assert.ok(impossible.blockers.includes("INVALID_RACE_DATE"));

  const leapDay = buildN2TrifectaOddsCheckpointPlan({
    stage: "ONE_VENUE_REVIEW",
    races: races("05", 1, "2028-02-29"),
  });
  assert.equal(leapDay.status, "READY_FOR_PRIVATE_REVIEW");
  assert.deepEqual(leapDay.blockers, []);
  assert.equal(leapDay.entries.length, 4);
  assert.equal(leapDay.entries[0]?.date, "2028-02-29");
});

test("one-venue review blocks accidental multi-venue expansion", () => {
  const plan = buildN2TrifectaOddsCheckpointPlan({
    stage: "ONE_VENUE_REVIEW",
    races: [...races("05", 1), ...races("12", 1)],
  });
  assert.equal(plan.status, "BLOCKED");
  assert.deepEqual(plan.entries, []);
  assert.ok(plan.blockers.includes("VENUE_DAY_LIMIT_EXCEEDED"));
});

test("all-active-venues review remains hard bounded", () => {
  const selected = Array.from({ length: 12 }, (_, venueIndex) =>
    races(String(venueIndex + 1).padStart(2, "0"), 12),
  ).flat();
  const plan = buildN2TrifectaOddsCheckpointPlan({
    stage: "ALL_ACTIVE_VENUES_REVIEW",
    races: selected,
  });
  assert.equal(plan.status, "READY_FOR_PRIVATE_REVIEW");
  assert.equal(plan.raceCount, 144);
  assert.equal(plan.venueDayCount, 12);
  assert.equal(plan.requestBudget, 576);

  const overflow = buildN2TrifectaOddsCheckpointPlan({
    stage: "ALL_ACTIVE_VENUES_REVIEW",
    races: [...selected, { ...selected[0], venueCode: "13" }],
  });
  assert.equal(overflow.status, "BLOCKED");
  assert.ok(overflow.blockers.includes("RACE_LIMIT_EXCEEDED"));
  assert.ok(overflow.blockers.includes("VENUE_DAY_LIMIT_EXCEEDED"));
});

test("raw path is append-only identity material and cannot accept invalid digest or normalized fetchedAt", () => {
  const plan = buildN2TrifectaOddsCheckpointPlan({
    stage: "ONE_VENUE_REVIEW",
    races: races("05", 1),
  });
  const entry = plan.entries.find((candidate) => candidate.checkpointLabel === "T-10");
  assert.ok(entry);
  const path = buildN2TrifectaRawRelativePath({
    entry,
    fetchedAt: "2026-08-06T00:55:12.345Z",
    rawSha256: "a".repeat(64),
  });
  assert.equal(
    path,
    "data/raw/research/trifecta-market/2026-08-06/05/01/T-10/2026-08-06T00-55-12.345Z-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.html",
  );
  assert.throws(
    () => buildN2TrifectaRawRelativePath({
      entry,
      fetchedAt: "2026-08-06T00:55:12.345Z",
      rawSha256: "bad",
    }),
    /INVALID_RAW_SHA256/,
  );
  assert.throws(
    () => buildN2TrifectaRawRelativePath({
      entry,
      fetchedAt: "2026-08-06T24:00:00Z",
      rawSha256: "a".repeat(64),
    }),
    /INVALID_FETCHED_AT/,
  );
});

test("network and raw persistence require an exact digest-bound temporary approval", () => {
  const plan = buildN2TrifectaOddsCheckpointPlan({
    stage: "ONE_VENUE_REVIEW",
    races: races(),
  });
  const missing = auditN2TrifectaOddsCaptureApproval({
    plan,
    approval: null,
    now: "2026-08-06T00:00:00.000Z",
  });
  assert.equal(missing.status, "BLOCKED");
  assert.equal(missing.networkExecutionAuthorized, false);
  assert.ok(missing.blockers.includes("SOURCE_SPECIFIC_APPROVAL_MISSING"));

  const approval: N2TrifectaOddsCaptureApproval = {
    approvalVersion: "n2-trifecta-odds-capture-approval-v1",
    approvalId: "APR-N2-TRI-ODDS-review-0001",
    scope: N2_TRIFECTA_ODDS_CAPTURE_APPROVAL_SCOPE,
    stage: "ONE_VENUE_REVIEW",
    manifestDigest: plan.manifestDigest,
    issuedAt: "2026-08-05T23:59:00.000Z",
    expiresAt: "2026-08-06T23:59:00.000Z",
    maxRequests: 48,
    privateResearchOnly: true,
    publicRedistributionAuthorized: false,
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
  };
  const allowed = auditN2TrifectaOddsCaptureApproval({
    plan,
    approval,
    now: "2026-08-06T00:00:00.000Z",
  });
  assert.deepEqual(allowed, {
    status: "PASS",
    blockers: [],
    networkExecutionAuthorized: true,
    rawPersistenceAuthorized: true,
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    publicPublishAuthorized: false,
  });

  const drifted = auditN2TrifectaOddsCaptureApproval({
    plan,
    approval: { ...approval, manifestDigest: "b".repeat(64) },
    now: "2026-08-06T00:00:00.000Z",
  });
  assert.equal(drifted.status, "BLOCKED");
  assert.ok(drifted.blockers.includes("APPROVAL_MANIFEST_MISMATCH"));

  const normalizedIssuedAt = auditN2TrifectaOddsCaptureApproval({
    plan,
    approval: { ...approval, issuedAt: "2026-08-05T24:00:00Z" },
    now: "2026-08-06T00:00:00.000Z",
  });
  assert.equal(normalizedIssuedAt.status, "BLOCKED");
  assert.equal(normalizedIssuedAt.networkExecutionAuthorized, false);
  assert.ok(normalizedIssuedAt.blockers.includes("APPROVAL_ISSUED_AT_INVALID"));

  const normalizedAuditTime = auditN2TrifectaOddsCaptureApproval({
    plan,
    approval,
    now: "2026-08-05T24:00:00Z",
  });
  assert.equal(normalizedAuditTime.status, "BLOCKED");
  assert.equal(normalizedAuditTime.networkExecutionAuthorized, false);
  assert.ok(normalizedAuditTime.blockers.includes("INVALID_AUDIT_TIME"));
});

test("fixed checkpoints preserve market information with fewer requests than blind polling", () => {
  const fixed = 72 * N2_TRIFECTA_ODDS_BASE_CHECKPOINTS.length;
  const blind = estimateBlindFiveMinutePollingRequests({
    raceCount: 72,
    pollingWindowMinutes: 120,
  });
  assert.equal(fixed, 288);
  assert.equal(blind, 1_800);
  assert.ok(fixed < blind);
});
