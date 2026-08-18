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

test("feature loader rejects invalid private capture times before private raw read", () => {
  for (const timing of [
    {
      fetchedAt: "2026-02-30T01:25:30.000Z",
      availableAt: "2026-08-07T01:25:00.000Z",
      expectedBlocker: "T-5_PRIVATE_FETCHED_AT_INVALID",
    },
    {
      fetchedAt: "2026-08-07T01:25:30.000Z",
      availableAt: "2026-08-07T24:00:00.000Z",
      expectedBlocker: "T-5_PRIVATE_AVAILABLE_AT_INVALID",
    },
    {
      fetchedAt: "2026-08-07T01:25:30.000Z",
      availableAt: "2026-08-07T01:26:00.000Z",
      expectedBlocker: "T-5_PRIVATE_AVAILABLE_AT_AFTER_FETCHED_AT",
    },
  ]) {
    const root = mkdtempSync(join(tmpdir(), "boat-pon-feature-time-preflight-"));
    try {
      const date = "2026-08-07";
      const venueCode = "05";
      const raceNo = "01";
      const checkpointLabel = "T-5";
      const raceIdentity = "20260807-05-01";
      const directory = `data/raw/research/trifecta-market/${date}/${venueCode}/${raceNo}/${checkpointLabel}`;
      const absoluteDirectory = join(root, directory);
      mkdirSync(absoluteDirectory, { recursive: true });

      const expectedRaw = Buffer.from("expected synthetic private raw fixture", "utf8");
      const rawSha256 = sha256(expectedRaw);
      const rawRelativePath = `${directory}/fixture.html`;
      const envelopeRelativePath = `${directory}/fixture.envelope.json`;
      writeFileSync(join(root, rawRelativePath), Buffer.from("tampered synthetic private raw fixture", "utf8"));

      const manifestDigest = "a".repeat(64);
      const checkpointKey = "b".repeat(64);
      const rawDocumentId = "raw-fixture";
      writeFileSync(join(root, envelopeRelativePath), `${JSON.stringify({
        envelopeVersion: "n2-trifecta-private-capture-envelope-v1",
        status: "PASS",
        blockers: [],
        manifestDigest,
        checkpointKey,
        entry: { raceIdentity, checkpointLabel },
        response: {
          statusCode: 200,
          contentType: "text/html",
          fetchedAt: timing.fetchedAt,
          rawByteLength: expectedRaw.length,
          rawSha256,
          headers: {},
        },
        sourceDisplayedUpdate: { status: "PASS", availableAt: timing.availableAt },
        parserVersion: "n2-trifecta-raw-parser-v1",
        parsedSelectionCount: 120,
        unavailableSelectionCount: 0,
        rawDocumentId,
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
        manifestDigest,
        checkpointKey,
        raceIdentity,
        checkpointLabel,
        rawDocumentId,
        rawSha256,
        rawRelativePath,
        envelopeRelativePath,
        acceptedAt: "2026-08-07T01:25:30.000Z",
        databaseWriteAuthorized: false,
        productionApplyExecuted: false,
      }, null, 2)}\n`);

      const report = loadN2TrifectaPrivateMarketFeatures({ rootDir: root, date, venueCode, raceNo: 1 });
      assert.equal(report.status, "BLOCKED", timing.expectedBlocker);
      assert.ok(report.blockers.includes(timing.expectedBlocker), timing.expectedBlocker);
      assert.equal(report.blockers.some((blocker) => blocker.includes("PRIVATE_RAW_SHA256_MISMATCH")), false);
      assert.equal(report.loadedSnapshotCount, 0);
      assert.equal(report.rawValuesReadPrivately, false);
      assert.equal(report.rawValuesPublished, false);
      assert.equal(report.networkRequestCount, 0);
      assert.equal(report.databaseReadCount, 0);
      assert.equal(report.databaseWriteCount, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("feature loader preserves explicit-offset private capture times", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-feature-time-offset-"));
  try {
    const date = "2026-08-07";
    const venueCode = "05";
    const raceNo = "01";
    const checkpointLabel = "T-5";
    const raceIdentity = "20260807-05-01";
    const directory = `data/raw/research/trifecta-market/${date}/${venueCode}/${raceNo}/${checkpointLabel}`;
    const absoluteDirectory = join(root, directory);
    mkdirSync(absoluteDirectory, { recursive: true });
    const raw = Buffer.from("not parsed because lineage fixture only", "utf8");
    const rawSha256 = sha256(raw);
    const rawRelativePath = `${directory}/fixture.html`;
    const envelopeRelativePath = `${directory}/fixture.envelope.json`;
    writeFileSync(join(root, rawRelativePath), raw);
    const manifestDigest = "a".repeat(64);
    const checkpointKey = "b".repeat(64);
    writeFileSync(join(root, envelopeRelativePath), `${JSON.stringify({
      envelopeVersion: "n2-trifecta-private-capture-envelope-v1",
      status: "PASS",
      blockers: [],
      manifestDigest,
      checkpointKey,
      entry: { raceIdentity, checkpointLabel },
      response: { statusCode: 200, contentType: "text/html", fetchedAt: "2026-08-07T10:25:30+09:00", rawByteLength: raw.length, rawSha256, headers: {} },
      sourceDisplayedUpdate: { status: "PASS", availableAt: "2026-08-07T10:25:00+09:00" },
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
    })}\n`);
    writeFileSync(join(absoluteDirectory, "accepted.json"), `${JSON.stringify({
      markerVersion: "n2-trifecta-private-capture-accepted-v1",
      manifestDigest,
      checkpointKey,
      raceIdentity,
      checkpointLabel,
      rawDocumentId: "raw-fixture",
      rawSha256,
      rawRelativePath,
      envelopeRelativePath,
      acceptedAt: "2026-08-07T01:25:30.000Z",
      databaseWriteAuthorized: false,
      productionApplyExecuted: false,
    })}\n`);

    const report = loadN2TrifectaPrivateMarketFeatures({ rootDir: root, date, venueCode, raceNo: 1 });
    assert.equal(report.blockers.includes("T-5_PRIVATE_FETCHED_AT_INVALID"), false);
    assert.equal(report.blockers.includes("T-5_PRIVATE_AVAILABLE_AT_INVALID"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
