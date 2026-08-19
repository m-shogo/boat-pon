import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical";
import { buildBoatRaceOfficialSourceUrl } from "./n2ExternalSourceCaptureContract";
import { readN2T5DecisionCutoffMetadata } from "./n2T5DecisionCutoffMetadata";

const MANIFEST_DIGEST = "a".repeat(64);
const RACE_IDENTITY = "20260807-05-01";
const DECISION_CUTOFF = "2026-08-07T03:30:00.000Z";
const CHECKPOINT_KEY = canonicalHash({
  manifestDigest: MANIFEST_DIGEST,
  raceIdentity: RACE_IDENTITY,
  checkpointLabel: "T-5",
  targetCaptureAt: "2026-08-07T03:25:00.000Z",
  sourceUrl: buildBoatRaceOfficialSourceUrl(
    "boatrace_official_trifecta_odds_html",
    { date: "20260807", venueCode: "05", raceNo: 1 },
  ),
});

function withMarker(acceptedAt: string, fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-t5-marker-race-date-"));
  const base = "data/raw/research/trifecta-market/2026-08-07/05/01/T-5";
  const dir = join(root, base);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "accepted.json"), `${JSON.stringify({
      markerVersion: "n2-trifecta-private-capture-accepted-v1",
      manifestDigest: MANIFEST_DIGEST,
      checkpointKey: CHECKPOINT_KEY,
      raceIdentity: RACE_IDENTITY,
      checkpointLabel: "T-5",
      envelopeRelativePath: `${base}/fixture.envelope.json`,
      acceptedAt,
      databaseWriteAuthorized: false,
      productionApplyExecuted: false,
    })}\n`, "utf8");
    writeFileSync(join(dir, "fixture.envelope.json"), "NOT_VALID_JSON\n", "utf8");
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("T-5 cutoff metadata rejects a canonical accepted marker from another race date before envelope read", () => {
  withMarker("2026-08-06T03:31:00.000Z", (root) => {
    const read = readN2T5DecisionCutoffMetadata({ dataRoot: root, raceKeys: ["2026-08-07:05:R1"] });
    assert.equal(read.status, "BLOCKED");
    assert.deepEqual(read.blockers, ["2026-08-07:05:R1:ACCEPTED_MARKER_ACCEPTED_AT_INVALID"]);
    assert.deepEqual(read.decisionCutoffByRaceKey, {});
    assert.equal(read.privateEnvelopeMetadataReadCount, 0);
    assert.equal(read.rawOddsValuesRead, false);
    assert.equal(read.databaseReadCount, 0);
    assert.equal(read.networkRequestCount, 0);
  });
});

test("T-5 cutoff metadata accepts a canonical marker inside the JST race date", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-t5-marker-race-date-valid-"));
  const base = "data/raw/research/trifecta-market/2026-08-07/05/01/T-5";
  const dir = join(root, base);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "accepted.json"), `${JSON.stringify({
      markerVersion: "n2-trifecta-private-capture-accepted-v1",
      manifestDigest: MANIFEST_DIGEST,
      checkpointKey: CHECKPOINT_KEY,
      raceIdentity: RACE_IDENTITY,
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
      manifestDigest: MANIFEST_DIGEST,
      checkpointKey: CHECKPOINT_KEY,
      entry: {
        raceIdentity: RACE_IDENTITY,
        checkpointLabel: "T-5",
        decisionCutoff: DECISION_CUTOFF,
      },
      databaseWriteAuthorized: false,
      currentBuyConnectionAuthorized: false,
      lineConnectionAuthorized: false,
      publicPublishAuthorized: false,
      productionApplyExecuted: false,
    })}\n`, "utf8");

    const read = readN2T5DecisionCutoffMetadata({ dataRoot: root, raceKeys: ["2026-08-07:05:R1"] });
    assert.equal(read.status, "PASS");
    assert.deepEqual(read.blockers, []);
    assert.deepEqual(read.decisionCutoffByRaceKey, { "2026-08-07:05:R1": DECISION_CUTOFF });
    assert.equal(read.privateEnvelopeMetadataReadCount, 1);
    assert.equal(read.rawOddsValuesRead, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
