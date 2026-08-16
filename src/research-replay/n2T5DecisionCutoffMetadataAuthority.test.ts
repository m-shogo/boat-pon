import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readN2T5DecisionCutoffMetadata } from "./n2T5DecisionCutoffMetadata";

const RACE_KEY = "2026-08-06:01:R1";
const RACE_IDENTITY = "20260806-01-01";
const DIRECTORY = "data/raw/research/trifecta-market/2026-08-06/01/01/T-5";
const ENVELOPE_RELATIVE_PATH = `${DIRECTORY}/authority-test.envelope.json`;

function writeFixture(root: string, widenedField: "databaseWriteAuthorized" | "currentBuyConnectionAuthorized" | "lineConnectionAuthorized") {
  const directory = join(root, DIRECTORY);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "accepted.json"), JSON.stringify({
    markerVersion: "n2-trifecta-private-capture-accepted-v1",
    raceIdentity: RACE_IDENTITY,
    checkpointLabel: "T-5",
    envelopeRelativePath: ENVELOPE_RELATIVE_PATH,
    acceptedAt: "2026-08-06T03:00:00.000Z",
  }));
  writeFileSync(join(root, ENVELOPE_RELATIVE_PATH), JSON.stringify({
    envelopeVersion: "n2-trifecta-private-capture-envelope-v1",
    status: "PASS",
    blockers: [],
    entry: {
      raceIdentity: RACE_IDENTITY,
      checkpointLabel: "T-5",
      decisionCutoff: "2026-08-06T03:10:00.000Z",
    },
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    publicPublishAuthorized: false,
    productionApplyExecuted: false,
    [widenedField]: true,
  }));
}

test("T-5 cutoff metadata rejects every private-capture authority widening", () => {
  for (const widenedField of [
    "databaseWriteAuthorized",
    "currentBuyConnectionAuthorized",
    "lineConnectionAuthorized",
  ] as const) {
    const root = mkdtempSync(join(tmpdir(), "boat-pon-t5-cutoff-authority-"));
    try {
      writeFixture(root, widenedField);
      const result = readN2T5DecisionCutoffMetadata({ dataRoot: root, raceKeys: [RACE_KEY] });
      assert.equal(result.status, "BLOCKED", widenedField);
      assert.deepEqual(result.decisionCutoffByRaceKey, {}, widenedField);
      assert.ok(result.blockers.includes(`${RACE_KEY}:ENVELOPE_AUTHORITY_WIDENED`), widenedField);
      assert.equal(result.privateEnvelopeMetadataReadCount, 1, widenedField);
      assert.equal(result.rawOddsValuesRead, false, widenedField);
      assert.equal(result.databaseReadCount, 0, widenedField);
      assert.equal(result.databaseWriteCount, 0, widenedField);
      assert.equal(result.publicPublishAuthorized, false, widenedField);
      assert.equal(result.productionApplyExecuted, false, widenedField);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
