import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  N2_TRIFECTA_ODDS_CAPTURE_APPROVAL_SCOPE,
  buildN2TrifectaOddsCheckpointPlan,
  type N2TrifectaOddsCaptureApproval,
} from "./n2TrifectaOddsCheckpointCollection";
import {
  N2_TRIFECTA_PRIVATE_CAPTURE_EARLY_WINDOW_SECONDS,
  executeN2TrifectaPrivateCapture,
} from "./n2TrifectaPrivateCaptureExecutor";

function plan() {
  return buildN2TrifectaOddsCheckpointPlan({
    stage: "ONE_VENUE_REVIEW",
    races: [{
      date: "2026-08-06",
      venueCode: "05",
      raceNo: 1,
      closeAt: "10:05",
    }],
  });
}

function approval(capturePlan: ReturnType<typeof plan>): N2TrifectaOddsCaptureApproval {
  return {
    approvalVersion: "n2-trifecta-odds-capture-approval-v1",
    approvalId: "APR-N2-TRI-ODDS-no-early-capture-test",
    scope: N2_TRIFECTA_ODDS_CAPTURE_APPROVAL_SCOPE,
    stage: capturePlan.stage,
    manifestDigest: capturePlan.manifestDigest,
    issuedAt: "2026-08-06T00:00:00.000Z",
    expiresAt: "2026-08-06T02:00:00.000Z",
    maxRequests: 1,
    privateResearchOnly: true,
    publicRedistributionAuthorized: false,
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
  };
}

test("checkpoint capture has zero early execution allowance", () => {
  assert.equal(N2_TRIFECTA_PRIVATE_CAPTURE_EARLY_WINDOW_SECONDS, 0);
});

test("one second before T-30 never reaches network", async () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-no-early-checkpoint-"));
  try {
    const capturePlan = plan();
    let fetchCount = 0;
    const report = await executeN2TrifectaPrivateCapture({
      plan: capturePlan,
      approval: approval(capturePlan),
      rootDir: root,
      now: "2026-08-06T00:34:59.000Z",
      executionMode: "execute",
      fetcher: async () => {
        fetchCount += 1;
        throw new Error("network must not start before checkpoint target");
      },
    });
    assert.equal(report.status, "NO_CHANGE");
    assert.equal(report.dueEntryCount, 0);
    assert.equal(report.networkRequestCount, 0);
    assert.equal(fetchCount, 0);
    assert.ok(report.entryResults.some((entry) => entry.result === "NOT_DUE"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("exact T-30 target becomes due without needing an early window", async () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-exact-checkpoint-"));
  try {
    const capturePlan = plan();
    const report = await executeN2TrifectaPrivateCapture({
      plan: capturePlan,
      approval: approval(capturePlan),
      rootDir: root,
      now: "2026-08-06T00:35:00.000Z",
      executionMode: "dry-run",
    });
    assert.equal(report.status, "DRY_RUN");
    assert.equal(report.dueEntryCount, 1);
    assert.equal(report.networkRequestCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
