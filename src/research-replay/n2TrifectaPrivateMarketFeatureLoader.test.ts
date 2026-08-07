import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadN2TrifectaPrivateMarketFeatures,
} from "./n2TrifectaPrivateMarketFeatureLoader";
import type { N2TrifectaMarketCheckpointLabel } from "./n2TrifectaMarketFeatureEngineering";

function html(multiplier = 1): string {
  const pairsByFirst = new Map<number, Array<[number, number]>>();
  for (let first = 1; first <= 6; first += 1) {
    const pairs: Array<[number, number]> = [];
    for (let second = 1; second <= 6; second += 1) {
      if (second === first) continue;
      for (let third = 1; third <= 6; third += 1) {
        if (third === first || third === second) continue;
        pairs.push([second, third]);
      }
    }
    pairsByFirst.set(first, pairs);
  }
  const header = Array.from({ length: 6 }, (_, index) =>
    `<th colspan="3">${index + 1}</th>`).join("");
  const rows = Array.from({ length: 20 }, (_, rowIndex) => {
    const cells: string[] = [];
    for (let first = 1; first <= 6; first += 1) {
      const pair = pairsByFirst.get(first)?.[rowIndex];
      if (!pair) throw new Error("fixture pair missing");
      const odds = ((first * 100 + pair[0] * 10 + pair[1]) / 10) * multiplier;
      cells.push(`<td>${pair[0]}</td><td>${pair[1]}</td><td class="oddsPoint">${odds.toFixed(1)}</td>`);
    }
    return `<tr>${cells.join("")}</tr>`;
  }).join("");
  return `<!doctype html><html><body><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function writeAcceptedCheckpoint(
  root: string,
  checkpointLabel: N2TrifectaMarketCheckpointLabel,
  options: { multiplier?: number; corruptMarkerSha?: boolean; fetchedAt?: string } = {},
): void {
  const date = "2026-08-07";
  const venueCode = "05";
  const raceNo = "01";
  const raceIdentity = "20260807-05-01";
  const dirRelative = `data/raw/research/trifecta-market/${date}/${venueCode}/${raceNo}/${checkpointLabel}`;
  const dir = join(root, dirRelative);
  mkdirSync(dir, { recursive: true });
  const raw = Buffer.from(html(options.multiplier ?? 1), "utf8");
  const digest = sha256(raw);
  const rawRelativePath = `${dirRelative}/fixture-${checkpointLabel}.html`;
  const envelopeRelativePath = `${dirRelative}/fixture-${checkpointLabel}.envelope.json`;
  const fetchedAt = options.fetchedAt ?? "2026-08-07T01:00:30.000Z";
  writeFileSync(join(root, rawRelativePath), raw);
  writeFileSync(join(root, envelopeRelativePath), `${JSON.stringify({
    envelopeVersion: "n2-trifecta-private-capture-envelope-v1",
    status: "PASS",
    blockers: [],
    manifestDigest: "a".repeat(64),
    checkpointKey: "b".repeat(64),
    entry: {
      raceIdentity,
      checkpointLabel,
    },
    response: {
      statusCode: 200,
      contentType: "text/html",
      fetchedAt,
      rawByteLength: raw.length,
      rawSha256: digest,
      headers: {},
    },
    sourceDisplayedUpdate: {
      status: "PASS",
      availableAt: "2026-08-07T01:00:00.000Z",
    },
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
    acceptedMarkerRelativePath: `${dirRelative}/accepted.json`,
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    publicPublishAuthorized: false,
    productionApplyExecuted: false,
  }, null, 2)}\n`);
  writeFileSync(join(dir, "accepted.json"), `${JSON.stringify({
    markerVersion: "n2-trifecta-private-capture-accepted-v1",
    manifestDigest: "a".repeat(64),
    checkpointKey: "b".repeat(64),
    raceIdentity,
    checkpointLabel,
    rawDocumentId: "raw-fixture",
    rawSha256: options.corruptMarkerSha ? "0".repeat(64) : digest,
    rawRelativePath,
    envelopeRelativePath,
    acceptedAt: fetchedAt,
    databaseWriteAuthorized: false,
    productionApplyExecuted: false,
  }, null, 2)}\n`);
}

function withTempRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-market-features-"));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("loader returns NO_DATA without touching network or database", () => {
  withTempRoot((root) => {
    const report = loadN2TrifectaPrivateMarketFeatures({
      rootDir: root,
      date: "2026-08-07",
      venueCode: "05",
      raceNo: 1,
    });
    assert.equal(report.status, "NO_DATA");
    assert.equal(report.acceptedMarkerCount, 0);
    assert.equal(report.loadedSnapshotCount, 0);
    assert.equal(report.networkRequestCount, 0);
    assert.equal(report.databaseReadCount, 0);
    assert.equal(report.databaseWriteCount, 0);
    assert.equal(report.rawValuesReadPrivately, false);
    assert.equal(report.rawValuesPublished, false);
  });
});

test("one accepted checkpoint loads as a private PARTIAL feature sequence", () => {
  withTempRoot((root) => {
    writeAcceptedCheckpoint(root, "T-30");
    const report = loadN2TrifectaPrivateMarketFeatures({
      rootDir: root,
      date: "2026-08-07",
      venueCode: "05",
      raceNo: 1,
    });
    assert.equal(report.status, "PARTIAL");
    assert.deepEqual(report.blockers, []);
    assert.equal(report.acceptedMarkerCount, 1);
    assert.equal(report.loadedSnapshotCount, 1);
    assert.deepEqual(report.sequence.availableCheckpoints, ["T-30"]);
    assert.deepEqual(report.sequence.missingCheckpoints, ["T-20", "T-10", "T-5"]);
    assert.equal(report.sequence.snapshots[0].selectionCount, 120);
    assert.equal(report.rawValuesReadPrivately, true);
    assert.equal(report.rawValuesPublished, false);
    assert.equal(report.publicPublishAuthorized, false);
  });
});

test("four accepted checkpoints produce a complete sequence with three transitions", () => {
  withTempRoot((root) => {
    writeAcceptedCheckpoint(root, "T-30", { multiplier: 1, fetchedAt: "2026-08-07T01:00:30.000Z" });
    writeAcceptedCheckpoint(root, "T-20", { multiplier: 0.98, fetchedAt: "2026-08-07T01:10:30.000Z" });
    writeAcceptedCheckpoint(root, "T-10", { multiplier: 1.02, fetchedAt: "2026-08-07T01:20:30.000Z" });
    writeAcceptedCheckpoint(root, "T-5", { multiplier: 0.95, fetchedAt: "2026-08-07T01:25:30.000Z" });
    const report = loadN2TrifectaPrivateMarketFeatures({
      rootDir: root,
      date: "2026-08-07",
      venueCode: "05",
      raceNo: 1,
    });
    assert.equal(report.status, "PASS");
    assert.equal(report.acceptedMarkerCount, 4);
    assert.equal(report.loadedSnapshotCount, 4);
    assert.equal(report.sequence.snapshots.length, 4);
    assert.equal(report.sequence.transitions.length, 3);
    assert.deepEqual(report.sequence.missingCheckpoints, []);
    assert.match(report.outputDigest, /^[0-9a-f]{64}$/u);
  });
});

test("loader fails closed on accepted-marker/raw digest mismatch", () => {
  withTempRoot((root) => {
    writeAcceptedCheckpoint(root, "T-30", { corruptMarkerSha: true });
    const report = loadN2TrifectaPrivateMarketFeatures({
      rootDir: root,
      date: "2026-08-07",
      venueCode: "05",
      raceNo: 1,
    });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.some((blocker) => blocker.includes("PRIVATE_RAW_SHA256_MISMATCH")));
    assert.equal(report.sequence.snapshots.length, 0);
    assert.equal(report.networkRequestCount, 0);
    assert.equal(report.databaseWriteCount, 0);
  });
});

test("loader rejects unsafe identity before private file access", () => {
  withTempRoot((root) => {
    const report = loadN2TrifectaPrivateMarketFeatures({
      rootDir: root,
      date: "2026/08/07",
      venueCode: "99",
      raceNo: 13,
    });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes("DATE_INVALID"));
    assert.ok(report.blockers.includes("VENUE_CODE_INVALID"));
    assert.ok(report.blockers.includes("RACE_NO_INVALID"));
    assert.equal(report.rawValuesReadPrivately, false);
  });
});
