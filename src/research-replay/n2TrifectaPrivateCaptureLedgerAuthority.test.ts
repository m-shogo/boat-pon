import assert from "node:assert/strict";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical.js";
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
    approvalId: "APR-N2-TRI-ODDS-ledger-authority-0001",
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

test("hardlinked attempt ledger cannot suppress an unexecuted checkpoint", async () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-attempt-ledger-authority-"));
  try {
    const capturePlan = plan();
    const entry = capturePlan.entries[0];
    assert.ok(entry);
    const checkpointKey = canonicalHash({
      manifestDigest: capturePlan.manifestDigest,
      raceIdentity: entry.raceIdentity,
      checkpointLabel: entry.checkpointLabel,
      targetCaptureAt: entry.targetCaptureAt,
      sourceUrl: entry.sourceUrl,
    });
    const ledgerPath = join(
      root,
      "data/raw/research/trifecta-market/ledgers",
      `${capturePlan.manifestDigest}.jsonl`,
    );
    const aliasPath = join(root, "attempt-ledger-alias.jsonl");
    mkdirSync(dirname(ledgerPath), { recursive: true });
    writeFileSync(aliasPath, `${JSON.stringify({
      ledgerVersion: "n2-trifecta-private-capture-ledger-v1",
      event: "ATTEMPT_STARTED",
      attemptId: "attempt-forged",
      checkpointKey,
      manifestDigest: capturePlan.manifestDigest,
      raceIdentity: entry.raceIdentity,
      checkpointLabel: entry.checkpointLabel,
      sourceUrl: entry.sourceUrl,
      at: "2026-08-06T00:35:00.000Z",
    })}\n`, "utf8");
    chmodSync(aliasPath, 0o600);
    linkSync(aliasPath, ledgerPath);

    await assert.rejects(
      () => executeN2TrifectaPrivateCapture({
        plan: capturePlan,
        approval: approvalFor(capturePlan),
        rootDir: root,
        now: "2026-08-06T00:35:30.000Z",
        executionMode: "execute",
        fetcher: async () => {
          throw new Error("network must not be reached for invalid ledger authority");
        },
      }),
      /ATTEMPT_LEDGER_FILE_AUTHORITY_INVALID/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
