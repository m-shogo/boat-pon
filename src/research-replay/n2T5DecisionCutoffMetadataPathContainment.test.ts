import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readN2T5DecisionCutoffMetadata } from "./n2T5DecisionCutoffMetadata";

test("reader rejects normalized envelope traversal before private envelope metadata reads", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-t5-cutoff-containment-"));
  try {
    const base = "data/raw/research/trifecta-market/2026-08-07/05/01/T-5";
    const baseDir = join(root, base);
    mkdirSync(baseDir, { recursive: true });

    const traversingPath = `${base}/../../other.envelope.json`;
    writeFileSync(join(baseDir, "accepted.json"), `${JSON.stringify({
      markerVersion: "n2-trifecta-private-capture-accepted-v1",
      raceIdentity: "20260807-05-01",
      checkpointLabel: "T-5",
      envelopeRelativePath: traversingPath,
      acceptedAt: "2026-08-07T03:31:00.000Z",
    }, null, 2)}\n`, "utf8");

    const escapedEnvelope = join(root, "data/raw/research/trifecta-market/2026-08-07/05/other.envelope.json");
    mkdirSync(join(root, "data/raw/research/trifecta-market/2026-08-07/05"), { recursive: true });
    writeFileSync(escapedEnvelope, `${JSON.stringify({
      envelopeVersion: "n2-trifecta-private-capture-envelope-v1",
      status: "PASS",
      blockers: [],
      entry: {
        raceIdentity: "20260807-05-01",
        checkpointLabel: "T-5",
        decisionCutoff: "2026-08-07T03:30:00.000Z",
      },
      publicPublishAuthorized: false,
      productionApplyExecuted: false,
    }, null, 2)}\n`, "utf8");

    const read = readN2T5DecisionCutoffMetadata({
      dataRoot: root,
      raceKeys: ["2026-08-07:05:R1"],
    });

    assert.equal(read.status, "BLOCKED");
    assert.deepEqual(read.blockers, ["2026-08-07:05:R1:ENVELOPE_PATH_INVALID"]);
    assert.deepEqual(read.decisionCutoffByRaceKey, {});
    assert.equal(read.privateEnvelopeMetadataReadCount, 0);
    assert.equal(read.rawOddsValuesRead, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
