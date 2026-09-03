import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  N2_TRIFECTA_ODDS_CAPTURE_APPROVAL_SCOPE,
  buildN2TrifectaOddsCheckpointPlan,
  type N2TrifectaOddsCaptureApproval,
} from "./n2TrifectaOddsCheckpointCollection.js";
import { executeN2TrifectaPrivateCapture } from "./n2TrifectaPrivateCaptureExecutor.js";

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

function approvalFor(capturePlan: ReturnType<typeof plan>): N2TrifectaOddsCaptureApproval {
  return {
    approvalVersion: "n2-trifecta-odds-capture-approval-v1",
    approvalId: "APR-N2-TRI-ODDS-marker-authority-0001",
    scope: N2_TRIFECTA_ODDS_CAPTURE_APPROVAL_SCOPE,
    stage: capturePlan.stage,
    manifestDigest: capturePlan.manifestDigest,
    issuedAt: "2026-08-06T00:00:00.000Z",
    expiresAt: "2026-08-06T02:00:00.000Z",
    maxRequests: capturePlan.requestBudget,
    privateResearchOnly: true,
    publicRedistributionAuthorized: false,
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
  };
}

test("an unverified accepted marker cannot suppress an unexecuted checkpoint", async () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-accepted-marker-authority-"));
  try {
    const capturePlan = plan();
    const entry = capturePlan.entries[0];
    assert.ok(entry);
    const markerPath = join(
      root,
      "data/raw/research/trifecta-market",
      entry.date,
      entry.venueCode,
      String(entry.raceNo).padStart(2, "0"),
      entry.checkpointLabel,
      "accepted.json",
    );
    mkdirSync(dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, "{}\n", "utf8");
    chmodSync(markerPath, 0o600);

    await assert.rejects(
      () => executeN2TrifectaPrivateCapture({
        plan: capturePlan,
        approval: approvalFor(capturePlan),
        rootDir: root,
        now: "2026-08-06T00:35:30.000Z",
        executionMode: "execute",
        fetcher: async () => {
          throw new Error("network must not be reached for invalid accepted marker authority");
        },
      }),
      /ACCEPTED_MARKER_AUTHORITY_INVALID/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
