import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadN2TrifectaPrivateMarketFeatures } from "./n2TrifectaPrivateMarketFeatureLoader";

test("private market loader rejects normalized raw traversal before private raw reads", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-private-market-containment-"));
  try {
    const directory = "data/raw/research/trifecta-market/2026-08-07/05/01/T-5";
    const dir = join(root, directory);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "accepted.json"), `${JSON.stringify({
      markerVersion: "n2-trifecta-private-capture-accepted-v1",
      manifestDigest: "0".repeat(64),
      checkpointKey: "1".repeat(64),
      raceIdentity: "20260807-05-01",
      checkpointLabel: "T-5",
      rawDocumentId: "rr-raw-fixture",
      rawSha256: "2".repeat(64),
      rawRelativePath: `${directory}/../../foreign.html`,
      envelopeRelativePath: `${directory}/fixture.envelope.json`,
      acceptedAt: "2026-08-07T03:31:00.000Z",
      databaseWriteAuthorized: false,
      productionApplyExecuted: false,
    }, null, 2)}\n`, "utf8");

    const read = loadN2TrifectaPrivateMarketFeatures({
      rootDir: root,
      date: "2026-08-07",
      venueCode: "05",
      raceNo: 1,
    });

    assert.equal(read.status, "BLOCKED");
    assert.ok(read.blockers.includes("T-5_ACCEPTED_RAW_PATH_INVALID"));
    assert.equal(read.blockers.includes("T-5_PRIVATE_RAW_FILE_MISSING"), false);
    assert.equal(read.loadedSnapshotCount, 0);
    assert.equal(read.rawValuesReadPrivately, false);
    assert.equal(read.rawValuesPublished, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
