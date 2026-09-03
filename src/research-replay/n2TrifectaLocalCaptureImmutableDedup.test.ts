import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  N2_TRIFECTA_LOCAL_CAPTURE_AUTHORIZATION_VERSION,
  runN2TrifectaLocalCaptureTick,
  type N2TrifectaLocalCaptureAuthorization,
} from "./n2TrifectaLocalCaptureService.js";

function authorization(): N2TrifectaLocalCaptureAuthorization {
  return {
    authorizationVersion: N2_TRIFECTA_LOCAL_CAPTURE_AUTHORIZATION_VERSION,
    authorizationId: "AUTH-N2-TRI-LOCAL-dedup-test",
    issuedAt: "2026-08-01T00:00:00Z",
    expiresAt: "2026-08-02T00:00:00Z",
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

test("mutable latest alone cannot suppress a new append-only local-capture report", async () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-local-capture-dedup-"));
  try {
    const sourceRoot = join(root, "source");
    const targetRoot = join(root, "target");
    const now = "2026-09-03T00:00:00Z";
    const first = await runN2TrifectaLocalCaptureTick({
      dataRoot: sourceRoot,
      primaryDbPath: join(root, "unused.sqlite"),
      authorization: authorization(),
      now,
    });
    assert.equal(first.status, "BLOCKED");
    assert.equal(first.eventChanged, true);
    assert.ok(first.reportRelativePath);

    const sourceLatestPath = join(sourceRoot, first.latestStatusRelativePath);
    const targetLatestPath = join(targetRoot, first.latestStatusRelativePath);
    mkdirSync(dirname(targetLatestPath), { recursive: true });
    writeFileSync(targetLatestPath, readFileSync(sourceLatestPath, "utf8"), "utf8");
    assert.equal(existsSync(join(targetRoot, first.reportRelativePath)), false);

    const second = await runN2TrifectaLocalCaptureTick({
      dataRoot: targetRoot,
      primaryDbPath: join(root, "unused.sqlite"),
      authorization: authorization(),
      now,
    });
    assert.equal(second.status, "BLOCKED");
    assert.equal(second.eventDigest, first.eventDigest);
    assert.equal(second.eventChanged, true);
    assert.equal(second.reportRelativePath, first.reportRelativePath);
    assert.equal(existsSync(join(targetRoot, second.reportRelativePath!)), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
