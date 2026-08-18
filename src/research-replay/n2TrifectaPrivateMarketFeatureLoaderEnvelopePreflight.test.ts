import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadN2TrifectaPrivateMarketFeatures } from "./n2TrifectaPrivateMarketFeatureLoader";

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function withTempRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-feature-envelope-preflight-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("feature loader rejects envelope identity before raw SHA validation", () => {
  withTempRoot((root) => {
    const date = "2026-08-07";
    const venueCode = "05";
    const raceNo = "01";
    const checkpointLabel = "T-5";
    const raceIdentity = "20260807-05-01";
    const directory = `data/raw/research/trifecta-market/${date}/${venueCode}/${raceNo}/${checkpointLabel}`;
    const absoluteDirectory = join(root, directory);
    mkdirSync(absoluteDirectory, { recursive: true });

    const originalRaw = Buffer.from("original synthetic private raw fixture", "utf8");
    const rawSha256 = sha256(originalRaw);
    const rawRelativePath = `${directory}/fixture.html`;
    const envelopeRelativePath = `${directory}/fixture.envelope.json`;

    writeFileSync(join(root, rawRelativePath), Buffer.from("tampered synthetic private raw fixture", "utf8"));
    writeFileSync(join(root, envelopeRelativePath), `${JSON.stringify({
      envelopeVersion: "n2-trifecta-private-capture-envelope-v1",
      status: "PASS",
      blockers: [],
      manifestDigest: "a".repeat(64),
      checkpointKey: "b".repeat(64),
      entry: {
        raceIdentity: "20260808-05-01",
        checkpointLabel,
      },
      response: {
        statusCode: 200,
        contentType: "text/html",
        fetchedAt: "2026-08-07T01:25:30.000Z",
        rawByteLength: originalRaw.length,
        rawSha256,
        headers: {},
      },
      sourceDisplayedUpdate: {
        status: "PASS",
        availableAt: "2026-08-07T01:25:00.000Z",
      },
      parserVersion: "n2-trifecta-raw-parser-v1",
      parsedSelectionCount: 120,
      unavailableSelectionCount: 0,
      rawDocumentId: "raw-fixture",
      parseRunId: "parse-fixture",
      proposedObservationId: "obs-fixture",
      snapshotCandidate: {},
      snapshotAudit: { status: "PASS", blockers: [] },
      rawRelativePath,
      envelopeRelativePath,
      acceptedMarkerRelativePath: `${directory}/accepted.json`,
      databaseWriteAuthorized: false,
      currentBuyConnectionAuthorized: false,
      lineConnectionAuthorized: false,
      publicPublishAuthorized: false,
      productionApplyExecuted: false,
    }, null, 2)}\n`);

    writeFileSync(join(absoluteDirectory, "accepted.json"), `${JSON.stringify({
      markerVersion: "n2-trifecta-private-capture-accepted-v1",
      manifestDigest: "a".repeat(64),
      checkpointKey: "b".repeat(64),
      raceIdentity,
      checkpointLabel,
      rawDocumentId: "raw-fixture",
      rawSha256,
      rawRelativePath,
      envelopeRelativePath,
      acceptedAt: "2026-08-07T01:25:30.000Z",
      databaseWriteAuthorized: false,
      productionApplyExecuted: false,
    }, null, 2)}\n`);

    const report = loadN2TrifectaPrivateMarketFeatures({
      rootDir: root,
      date,
      venueCode,
      raceNo: 1,
    });

    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes("T-5_PRIVATE_ENVELOPE_RACE_MISMATCH"));
    assert.equal(report.blockers.some((blocker) => blocker.includes("PRIVATE_RAW_SHA256_MISMATCH")), false);
    assert.equal(report.loadedSnapshotCount, 0);
    assert.equal(report.rawValuesReadPrivately, false);
    assert.equal(report.rawValuesPublished, false);
    assert.equal(report.networkRequestCount, 0);
    assert.equal(report.databaseWriteCount, 0);
  });
});