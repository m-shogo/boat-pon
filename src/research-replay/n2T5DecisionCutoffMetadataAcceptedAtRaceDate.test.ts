import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readN2T5DecisionCutoffMetadata } from "./n2T5DecisionCutoffMetadata";

function withMarker(acceptedAt: string, fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-t5-marker-race-date-"));
  const base = "data/raw/research/trifecta-market/2026-08-07/05/01/T-5";
  const dir = join(root, base);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "accepted.json"), `${JSON.stringify({
      markerVersion: "n2-trifecta-private-capture-accepted-v1",
      raceIdentity: "20260807-05-01",
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
      raceIdentity: "20260807-05-01",
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
      entry: {
        raceIdentity: "20260807-05-01",
        checkpointLabel: "T-5",
        decisionCutoff: "2026-08-07T03:30:00.000Z",
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
    assert.deepEqual(read.decisionCutoffByRaceKey, { "2026-08-07:05:R1": "2026-08-07T03:30:00.000Z" });
    assert.equal(read.privateEnvelopeMetadataReadCount, 1);
    assert.equal(read.rawOddsValuesRead, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
