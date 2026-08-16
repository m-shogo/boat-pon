import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  N2_TRIFECTA_LOCAL_CAPTURE_AUTHORIZATION_VERSION,
  runN2TrifectaLocalCaptureTick,
  type N2TrifectaLocalCaptureAuthorization,
} from "./n2TrifectaLocalCaptureService.js";
import type { N2TrifectaPrivateFetcher } from "./n2TrifectaPrivateCaptureExecutor.js";

function authorization(): N2TrifectaLocalCaptureAuthorization {
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
  };
}

test("invalid local capture time blocks before primary DB or network access", async () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-local-capture-isolation-"));
  let fetchCount = 0;
  const fetcher: N2TrifectaPrivateFetcher = async () => {
    fetchCount += 1;
    throw new Error("network must stay unreachable for invalid service time");
  };

  try {
    const report = await runN2TrifectaLocalCaptureTick({
      dataRoot: root,
      primaryDbPath: join(root, "missing-primary.sqlite"),
      authorization: authorization(),
      now: "2026-08-05T24:00:00.000Z",
      fetcher,
    });

    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes("AUTH_NOW_INVALID"));
    assert.ok(report.blockers.includes("INVALID_NOW"));
    assert.equal(report.blockers.some((blocker) => blocker.includes("PRIMARY_DB")), false);
    assert.equal(report.selectedVenueCode, null);
    assert.equal(report.selectedEntry, null);
    assert.equal(report.executorReport, null);
    assert.equal(report.databaseWriteCount, 0);
    assert.equal(report.primaryDbWriteCount, 0);
    assert.equal(report.currentBuyChanged, false);
    assert.equal(report.lineChanged, false);
    assert.equal(report.publicPublished, false);
    assert.equal(report.automatedBettingChanged, false);
    assert.equal(fetchCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
