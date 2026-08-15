import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readN2T5DecisionCutoffMetadata } from "./n2T5DecisionCutoffMetadata";

function withMetadata(cutoff: string, fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-t5-cutoff-canonical-"));
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
    })}\n`, "utf8");
    writeFileSync(join(dir, "fixture.envelope.json"), `${JSON.stringify({
      envelopeVersion: "n2-trifecta-private-capture-envelope-v1",
      status: "PASS",
      blockers: [],
      entry: {
        raceIdentity: "20260807-05-01",
        checkpointLabel: "T-5",
        decisionCutoff: cutoff,
      },
      publicPublishAuthorized: false,
      productionApplyExecuted: false,
    })}\n`, "utf8");
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("T-5 cutoff metadata rejects noncanonical aliases for the same instant", () => {
  withMetadata("2026-08-07T12:30:00+09:00", (root) => {
    const read = readN2T5DecisionCutoffMetadata({
      dataRoot: root,
      raceKeys: ["2026-08-07:05:R1"],
    });
    assert.equal(read.status, "BLOCKED");
    assert.deepEqual(read.blockers, ["2026-08-07:05:R1:DECISION_CUTOFF_INVALID"]);
    assert.deepEqual(read.decisionCutoffByRaceKey, {});
    assert.equal(read.privateEnvelopeMetadataReadCount, 1);
    assert.equal(read.rawOddsValuesRead, false);
  });
});

test("T-5 cutoff metadata preserves producer-canonical ISO instants", () => {
  withMetadata("2026-08-07T03:30:00.000Z", (root) => {
    const read = readN2T5DecisionCutoffMetadata({
      dataRoot: root,
      raceKeys: ["2026-08-07:05:R1"],
    });
    assert.equal(read.status, "PASS");
    assert.deepEqual(read.decisionCutoffByRaceKey, {
      "2026-08-07:05:R1": "2026-08-07T03:30:00.000Z",
    });
    assert.equal(read.rawOddsValuesRead, false);
  });
});
