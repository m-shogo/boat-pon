import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readN2T5DecisionCutoffMetadata } from "./n2T5DecisionCutoffMetadata";

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-t5-cutoff-metadata-"));
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function writeMetadata(root: string, options: {
  cutoff?: string;
  envelopeRelativePath?: string;
} = {}): void {
  const base = "data/raw/research/trifecta-market/2026-08-07/05/01/T-5";
  const dir = join(root, base);
  mkdirSync(dir, { recursive: true });
  const envelopeRelativePath = options.envelopeRelativePath ?? `${base}/fixture.envelope.json`;
  writeFileSync(join(dir, "accepted.json"), `${JSON.stringify({
    markerVersion: "n2-trifecta-private-capture-accepted-v1",
    raceIdentity: "20260807-05-01",
    checkpointLabel: "T-5",
    envelopeRelativePath,
  }, null, 2)}\n`, "utf8");
  if (envelopeRelativePath.startsWith(base)) {
    writeFileSync(join(root, envelopeRelativePath), `${JSON.stringify({
      envelopeVersion: "n2-trifecta-private-capture-envelope-v1",
      status: "PASS",
      blockers: [],
      entry: {
        raceIdentity: "20260807-05-01",
        checkpointLabel: "T-5",
        decisionCutoff: options.cutoff ?? "2026-08-07T03:30:00.000Z",
      },
      publicPublishAuthorized: false,
      productionApplyExecuted: false,
    }, null, 2)}\n`, "utf8");
  }
}

test("reader extracts only T-5 cutoff metadata without raw odds access", () => {
  withRoot((root) => {
    writeMetadata(root);
    const read = readN2T5DecisionCutoffMetadata({
      dataRoot: root,
      raceKeys: ["2026-08-07:05:R1"],
    });
    assert.equal(read.status, "PASS");
    assert.deepEqual(read.blockers, []);
    assert.deepEqual(read.decisionCutoffByRaceKey, {
      "2026-08-07:05:R1": "2026-08-07T03:30:00.000Z",
    });
    assert.equal(read.privateEnvelopeMetadataReadCount, 1);
    assert.equal(read.rawOddsValuesRead, false);
    assert.equal(read.networkRequestCount, 0);
    assert.equal(read.databaseReadCount, 0);
    assert.equal(read.databaseWriteCount, 0);
    assert.equal(read.publicPublishAuthorized, false);
    assert.equal(read.productionApplyExecuted, false);
  });
});

test("reader blocks a cutoff outside the race's JST date", () => {
  withRoot((root) => {
    writeMetadata(root, { cutoff: "2026-08-06T03:30:00.000Z" });
    const read = readN2T5DecisionCutoffMetadata({
      dataRoot: root,
      raceKeys: ["2026-08-07:05:R1"],
    });
    assert.equal(read.status, "BLOCKED");
    assert.ok(read.blockers.includes("2026-08-07:05:R1:DECISION_CUTOFF_INVALID"));
    assert.deepEqual(read.decisionCutoffByRaceKey, {});
  });
});

test("reader rejects envelope paths outside the expected private T-5 directory", () => {
  withRoot((root) => {
    writeMetadata(root, { envelopeRelativePath: "data/raw/research/other.envelope.json" });
    const read = readN2T5DecisionCutoffMetadata({
      dataRoot: root,
      raceKeys: ["2026-08-07:05:R1"],
    });
    assert.equal(read.status, "BLOCKED");
    assert.ok(read.blockers.includes("2026-08-07:05:R1:ENVELOPE_PATH_INVALID"));
    assert.equal(read.privateEnvelopeMetadataReadCount, 0);
  });
});
