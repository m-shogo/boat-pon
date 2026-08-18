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

test("feature loader rejects marker/envelope lineage mismatch before private raw read", () => {
  for (const markerOverride of [
    { manifestDigest: "c".repeat(64), expectedBlocker: "T-5_PRIVATE_ENVELOPE_MANIFEST_DIGEST_MISMATCH" },
    { checkpointKey: "d".repeat(64), expectedBlocker: "T-5_PRIVATE_ENVELOPE_CHECKPOINT_KEY_MISMATCH" },
    { rawDocumentId: "raw-other", expectedBlocker: "T-5_PRIVATE_ENVELOPE_RAW_DOCUMENT_ID_MISMATCH" },
  ]) {
    const root = mkdtempSync(join(tmpdir(), "boat-pon-feature-marker-lineage-"));
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

      const envelope = {
        envelopeVersion: "n2-trifecta-private-capture-envelope-v1",
        status: "PASS",
        blockers: [],
        manifestDigest: "a".repeat(64),
        checkpointKey: "b".repeat(64),
        entry: { raceIdentity, checkpointLabel },
        response: {
          statusCode: 200,
          contentType: "text/html",
          fetchedAt: "2026-08-07T01:25:30.000Z",
          rawByteLength: expectedRaw.length,
          rawSha256,
          headers: {},
        },
        sourceDisplayedUpdate: { status: "PASS", availableAt: "2026-08-07T01:25:00.000Z" },
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
      };
      writeFileSync(join(root, envelopeRelativePath), `${JSON.stringify(envelope, null, 2)}\n`);

      const { expectedBlocker, ...lineageOverride } = markerOverride;
      const marker = {
        markerVersion: "n2-trifecta-private-capture-accepted-v1",
        manifestDigest: envelope.manifestDigest,
        checkpointKey: envelope.checkpointKey,
        raceIdentity,
        checkpointLabel,
        rawDocumentId: envelope.rawDocumentId,
        rawSha256,
        rawRelativePath,
        envelopeRelativePath,
        acceptedAt: "2026-08-07T01:25:30.000Z",
        databaseWriteAuthorized: false,
        productionApplyExecuted: false,
        ...lineageOverride,
      };
      writeFileSync(join(absoluteDirectory, "accepted.json"), `${JSON.stringify(marker, null, 2)}\n`);

      const report = loadN2TrifectaPrivateMarketFeatures({
        rootDir: root,
        date,
        venueCode,
        raceNo: 1,
      });

      assert.equal(report.status, "BLOCKED", expectedBlocker);
      assert.ok(report.blockers.includes(expectedBlocker), expectedBlocker);
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
