import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical";
import { buildBoatRaceOfficialSourceUrl } from "./n2ExternalSourceCaptureContract";
import { readN2T5DecisionCutoffMetadata } from "./n2T5DecisionCutoffMetadata";

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-t5-cutoff-metadata-"));
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function writeMetadata(root: string, options: {
  cutoff?: string;
  checkpointCutoff?: string;
  envelopeRelativePath?: string;
  acceptedAt?: string;
  markerCheckpointKey?: string;
  envelopeManifestDigest?: string;
  envelopeCheckpointKey?: string;
} = {}): void {
  const base = "data/raw/research/trifecta-market/2026-08-07/05/01/T-5";
  const dir = join(root, base);
  mkdirSync(dir, { recursive: true });
  const manifestDigest = "a".repeat(64);
  const raceIdentity = "20260807-05-01";
  const cutoff = options.cutoff ?? "2026-08-07T03:30:00.000Z";
  const checkpointCutoff = options.checkpointCutoff ?? cutoff;
  const targetCaptureAt = new Date(Date.parse(checkpointCutoff) - 5 * 60_000).toISOString();
  const sourceUrl = buildBoatRaceOfficialSourceUrl(
    "boatrace_official_trifecta_odds_html",
    { date: "20260807", venueCode: "05", raceNo: 1 },
  );
  const producerCheckpointKey = canonicalHash({
    manifestDigest,
    raceIdentity,
    checkpointLabel: "T-5",
    targetCaptureAt,
    sourceUrl,
  });
  const markerCheckpointKey = options.markerCheckpointKey ?? producerCheckpointKey;
  const envelopeRelativePath = options.envelopeRelativePath ?? `${base}/fixture.envelope.json`;
  writeFileSync(join(dir, "accepted.json"), `${JSON.stringify({
    markerVersion: "n2-trifecta-private-capture-accepted-v1",
    manifestDigest,
    checkpointKey: markerCheckpointKey,
    raceIdentity,
    checkpointLabel: "T-5",
    envelopeRelativePath,
    acceptedAt: options.acceptedAt ?? "2026-08-07T03:25:30.000Z",
    databaseWriteAuthorized: false,
    productionApplyExecuted: false,
  }, null, 2)}\n`, "utf8");
  if (envelopeRelativePath.startsWith(base)) {
    writeFileSync(join(root, envelopeRelativePath), `${JSON.stringify({
      envelopeVersion: "n2-trifecta-private-capture-envelope-v1",
      status: "PASS",
      blockers: [],
      manifestDigest: options.envelopeManifestDigest ?? manifestDigest,
      checkpointKey: options.envelopeCheckpointKey ?? markerCheckpointKey,
      entry: {
        raceIdentity,
        checkpointLabel: "T-5",
        decisionCutoff: cutoff,
      },
      databaseWriteAuthorized: false,
      currentBuyConnectionAuthorized: false,
      lineConnectionAuthorized: false,
      publicPublishAuthorized: false,
      productionApplyExecuted: false,
    }, null, 2)}\n`, "utf8");
  }
}

test("reader extracts only T-5 cutoff metadata without raw odds access", () => {
  withRoot((root) => {
    writeMetadata(root);
    const read = readN2T5DecisionCutoffMetadata({ dataRoot: root, raceKeys: ["2026-08-07:05:R1"] });
    assert.equal(read.status, "PASS");
    assert.deepEqual(read.blockers, []);
    assert.deepEqual(read.decisionCutoffByRaceKey, { "2026-08-07:05:R1": "2026-08-07T03:30:00.000Z" });
    assert.equal(read.privateEnvelopeMetadataReadCount, 1);
    assert.equal(read.rawOddsValuesRead, false);
    assert.equal(read.networkRequestCount, 0);
    assert.equal(read.databaseReadCount, 0);
    assert.equal(read.databaseWriteCount, 0);
    assert.equal(read.publicPublishAuthorized, false);
    assert.equal(read.productionApplyExecuted, false);
  });
});

test("reader reports an attempted envelope metadata read even when JSON is invalid", () => {
  withRoot((root) => {
    writeMetadata(root);
    const envelopePath = join(
      root,
      "data/raw/research/trifecta-market/2026-08-07/05/01/T-5/fixture.envelope.json",
    );
    writeFileSync(envelopePath, "{not-json\n", "utf8");
    const read = readN2T5DecisionCutoffMetadata({ dataRoot: root, raceKeys: ["2026-08-07:05:R1"] });
    assert.equal(read.status, "BLOCKED");
    assert.ok(read.blockers.some((blocker) => blocker.startsWith("2026-08-07:05:R1:ENVELOPE_")));
    assert.deepEqual(read.decisionCutoffByRaceKey, {});
    assert.equal(read.privateEnvelopeMetadataReadCount, 1);
    assert.equal(read.rawOddsValuesRead, false);
  });
});

test("reader rejects an envelope from a different accepted capture lineage", () => {
  for (const options of [
    { envelopeManifestDigest: "c".repeat(64) },
    { envelopeCheckpointKey: "d".repeat(64) },
  ]) {
    withRoot((root) => {
      writeMetadata(root, options);
      const read = readN2T5DecisionCutoffMetadata({ dataRoot: root, raceKeys: ["2026-08-07:05:R1"] });
      assert.equal(read.status, "BLOCKED");
      assert.ok(read.blockers.includes("2026-08-07:05:R1:ENVELOPE_LINEAGE_MISMATCH"));
      assert.deepEqual(read.decisionCutoffByRaceKey, {});
      assert.equal(read.privateEnvelopeMetadataReadCount, 1);
      assert.equal(read.rawOddsValuesRead, false);
    });
  }
});

test("reader rejects a cutoff that no longer matches the accepted checkpoint identity", () => {
  withRoot((root) => {
    writeMetadata(root, {
      cutoff: "2026-08-07T04:30:00.000Z",
      checkpointCutoff: "2026-08-07T03:30:00.000Z",
    });
    const read = readN2T5DecisionCutoffMetadata({ dataRoot: root, raceKeys: ["2026-08-07:05:R1"] });
    assert.equal(read.status, "BLOCKED");
    assert.ok(read.blockers.includes("2026-08-07:05:R1:CHECKPOINT_KEY_INVALID"));
    assert.deepEqual(read.decisionCutoffByRaceKey, {});
    assert.equal(read.rawOddsValuesRead, false);
  });
});

test("reader rejects matching marker/envelope checkpoint keys that were not producer-derived", () => {
  withRoot((root) => {
    const bogusCheckpointKey = "b".repeat(64);
    writeMetadata(root, {
      markerCheckpointKey: bogusCheckpointKey,
      envelopeCheckpointKey: bogusCheckpointKey,
    });
    const read = readN2T5DecisionCutoffMetadata({ dataRoot: root, raceKeys: ["2026-08-07:05:R1"] });
    assert.equal(read.status, "BLOCKED");
    assert.ok(read.blockers.includes("2026-08-07:05:R1:CHECKPOINT_KEY_INVALID"));
    assert.deepEqual(read.decisionCutoffByRaceKey, {});
  });
});

test("reader blocks a cutoff outside the race's JST date", () => {
  withRoot((root) => {
    writeMetadata(root, { cutoff: "2026-08-06T03:30:00.000Z" });
    const read = readN2T5DecisionCutoffMetadata({ dataRoot: root, raceKeys: ["2026-08-07:05:R1"] });
    assert.equal(read.status, "BLOCKED");
    assert.ok(read.blockers.includes("2026-08-07:05:R1:DECISION_CUTOFF_INVALID"));
    assert.deepEqual(read.decisionCutoffByRaceKey, {});
  });
});

test("reader rejects impossible race-key calendar dates before private metadata reads", () => {
  withRoot((root) => {
    const read = readN2T5DecisionCutoffMetadata({ dataRoot: root, raceKeys: ["2026-02-30:05:R1"] });
    assert.equal(read.status, "BLOCKED");
    assert.deepEqual(read.blockers, ["2026-02-30:05:R1:RACE_KEY_INVALID"]);
    assert.deepEqual(read.decisionCutoffByRaceKey, {});
    assert.equal(read.privateEnvelopeMetadataReadCount, 0);
    assert.equal(read.rawOddsValuesRead, false);
  });
});

test("reader rejects invalid accepted marker timestamps before envelope reads", () => {
  withRoot((root) => {
    writeMetadata(root, { acceptedAt: "2026-02-30T03:31:00.000Z" });
    const read = readN2T5DecisionCutoffMetadata({ dataRoot: root, raceKeys: ["2026-08-07:05:R1"] });
    assert.equal(read.status, "BLOCKED");
    assert.deepEqual(read.blockers, ["2026-08-07:05:R1:ACCEPTED_MARKER_ACCEPTED_AT_INVALID"]);
    assert.deepEqual(read.decisionCutoffByRaceKey, {});
    assert.equal(read.privateEnvelopeMetadataReadCount, 0);
    assert.equal(read.rawOddsValuesRead, false);
  });
});

test("reader rejects envelope paths outside the expected private T-5 directory", () => {
  withRoot((root) => {
    writeMetadata(root, { envelopeRelativePath: "data/raw/research/other.envelope.json" });
    const read = readN2T5DecisionCutoffMetadata({ dataRoot: root, raceKeys: ["2026-08-07:05:R1"] });
    assert.equal(read.status, "BLOCKED");
    assert.ok(read.blockers.includes("2026-08-07:05:R1:ENVELOPE_PATH_INVALID"));
    assert.equal(read.privateEnvelopeMetadataReadCount, 0);
  });
});
