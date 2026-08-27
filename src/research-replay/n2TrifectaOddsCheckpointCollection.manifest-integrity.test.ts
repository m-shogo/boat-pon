import assert from "node:assert/strict";
import test from "node:test";

import {
  N2_TRIFECTA_ODDS_CAPTURE_APPROVAL_SCOPE,
  auditN2TrifectaOddsCaptureApproval,
  buildN2TrifectaOddsCheckpointPlan,
  type N2TrifectaOddsCaptureApproval,
} from "./n2TrifectaOddsCheckpointCollection.js";

test("private capture approval rejects a plan mutated after manifest review", () => {
  const plan = buildN2TrifectaOddsCheckpointPlan({
    stage: "ONE_VENUE_REVIEW",
    races: [{
      date: "2026-08-06",
      venueCode: "05",
      raceNo: 1,
      closeAt: "10:05",
    }],
  });
  assert.equal(plan.status, "READY_FOR_PRIVATE_REVIEW");
  assert.equal(plan.entries.length, 4);

  const approval: N2TrifectaOddsCaptureApproval = {
    approvalVersion: "n2-trifecta-odds-capture-approval-v1",
    approvalId: "APR-N2-TRI-ODDS-review-manifest-0001",
    scope: N2_TRIFECTA_ODDS_CAPTURE_APPROVAL_SCOPE,
    stage: plan.stage,
    manifestDigest: plan.manifestDigest,
    issuedAt: "2026-08-05T23:59:00.000Z",
    expiresAt: "2026-08-06T23:59:00.000Z",
    maxRequests: plan.requestBudget,
    privateResearchOnly: true,
    publicRedistributionAuthorized: false,
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
  };

  const mutated = {
    ...plan,
    entries: plan.entries.map((entry, index) => index === 0
      ? { ...entry, sourceUrl: `${entry.sourceUrl}&unexpected=1` }
      : entry),
  };
  const audit = auditN2TrifectaOddsCaptureApproval({
    plan: mutated,
    approval,
    now: "2026-08-06T00:00:00.000Z",
  });

  assert.equal(audit.status, "BLOCKED");
  assert.equal(audit.networkExecutionAuthorized, false);
  assert.equal(audit.rawPersistenceAuthorized, false);
  assert.ok(audit.blockers.includes("PLAN_MANIFEST_DIGEST_MISMATCH"));
});
