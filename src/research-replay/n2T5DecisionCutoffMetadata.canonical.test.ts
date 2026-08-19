import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import { buildBoatRaceOfficialSourceUrl } from "./n2ExternalSourceCaptureContract";
import { readN2T5DecisionCutoffMetadata } from "./n2T5DecisionCutoffMetadata";

function withMetadata(cutoff: string, fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-t5-cutoff-canonical-"));
  const base = "data/raw/research/trifecta-market/2026-08-07/05/01/T-5";
  const dir = join(root, base);
  const manifestDigest = "a".repeat(64);
  const raceIdentity = "20260807-05-01";
  const canonicalCutoff = canonicalUtcTimestamp(cutoff);
  const checkpointKey = canonicalHash({
    manifestDigest,
    raceIdentity,
    checkpointLabel: "T-5",
    targetCaptureAt: new Date(Date.parse(canonicalCutoff) - 5 * 60_000).toISOString(),
    sourceUrl: buildBoatRaceOfficialSourceUrl(
      "boatrace_official_trifecta_odds_html",
      { date: "20260807", venueCode: "05", raceNo: 1 },
    ),
  });
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "accepted.json"), `${JSON.stringify({
      markerVersion: "n2-trifecta-private-capture-accepted-v1",
      manifestDigest,
      checkpointKey,
      raceIdentity,
      checkpointLabel: "T-5",
      envelopeRelativePath: `${base}/fixture.envelope.json`,
      acceptedAt: "2026-08-07T03:31:00.000Z",
      databaseWriteAuthorized: false,
      productionApplyExecuted: false,
    })}\n`, "utf8");
    writeFileSync(join(dir, "fixture.envelope.json"), `${JSON.stringify({
      envelopeVersion: "n2-trifecta-private-capture-envelope-v1",
      status: "PASS",
      blockers: [],
      manifestDigest,
      checkpointKey,
      entry: {
        raceIdentity,
        checkpointLabel: "T-5",
        decisionCutoff: cutoff,
      },
      response: {
        fetchedAt: "2026-08-07T03:25:30.000Z",
      },
      sourceDisplayedUpdate: {
        availableAt: "2026-08-07T03:24:00.000Z",
      },
      databaseWriteAuthorized: false,
      currentBuyConnectionAuthorized: false,
      lineConnectionAuthorized: false,
      publicPublishAuthorized: false,
      productionApplyExecuted: false,
    })}\n`, "utf8");
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("strict T-5 producer mode rejects noncanonical aliases for the same instant", () => {
  withMetadata("2026-08-07T12:30:00+09:00", (root) => {
    const read = readN2T5DecisionCutoffMetadata({
      dataRoot: root,
      raceKeys: ["2026-08-07:05:R1"],
      timestampMode: "producer-canonical",
    });
    assert.equal(read.status, "BLOCKED");
    assert.deepEqual(read.blockers, ["2026-08-07:05:R1:DECISION_CUTOFF_INVALID"]);
    assert.deepEqual(read.decisionCutoffByRaceKey, {});
    assert.equal(read.privateEnvelopeMetadataReadCount, 1);
    assert.equal(read.rawOddsValuesRead, false);
  });
});

test("T-5 cutoff metadata canonicalizes valid explicit-zone aliases for cohort consumers", () => {
  withMetadata("2026-08-07T12:30:00+09:00", (root) => {
    const read = readN2T5DecisionCutoffMetadata({ dataRoot: root, raceKeys: ["2026-08-07:05:R1"] });
    assert.equal(read.status, "PASS");
    assert.deepEqual(read.decisionCutoffByRaceKey, { "2026-08-07:05:R1": "2026-08-07T03:30:00.000Z" });
    assert.equal(read.rawOddsValuesRead, false);
  });
});

test("T-5 cutoff metadata preserves producer-canonical ISO instants", () => {
  withMetadata("2026-08-07T03:30:00.000Z", (root) => {
    const read = readN2T5DecisionCutoffMetadata({ dataRoot: root, raceKeys: ["2026-08-07:05:R1"] });
    assert.equal(read.status, "PASS");
    assert.deepEqual(read.decisionCutoffByRaceKey, { "2026-08-07:05:R1": "2026-08-07T03:30:00.000Z" });
    assert.equal(read.rawOddsValuesRead, false);
  });
});
