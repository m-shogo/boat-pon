import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readN2HistoricalOnlyBaselineSources } from "./n2HistoricalOnlyBaselineSource";

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-historical-baseline-source-"));
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function isoDate(base: string, offsetDays: number): string {
  const value = new Date(`${base}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function createSidecar(root: string): string {
  const path = join(root, "data/research-replay.sqlite");
  mkdirSync(join(root, "data"), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE settlement_candidates_v2 (
      candidate_id TEXT PRIMARY KEY,
      canonical_race_key TEXT NOT NULL,
      bet_type TEXT NOT NULL,
      settlement_status TEXT NOT NULL,
      result_kind TEXT NOT NULL,
      resolution_status TEXT NOT NULL,
      observation_id TEXT NOT NULL,
      supersedes_candidate_id TEXT
    );
    CREATE TABLE race_payout_lines_v2 (
      payout_line_id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      bet_type TEXT NOT NULL,
      selection_canonical TEXT,
      line_kind TEXT NOT NULL
    );
    CREATE TABLE settlement_source_duplicate_resolutions_v2 (
      duplicate_observation_id TEXT PRIMARY KEY
    );
  `);
  db.close();
  return path;
}

function insertWinner(path: string, input: {
  raceKey: string;
  candidateId: string;
  selection: string;
}): void {
  const db = new DatabaseSync(path);
  try {
    db.prepare(`
      INSERT INTO settlement_candidates_v2 (
        candidate_id, canonical_race_key, bet_type, settlement_status,
        result_kind, resolution_status, observation_id, supersedes_candidate_id
      ) VALUES (?, ?, 'trifecta', 'settled', 'normal', 'resolved', ?, NULL)
    `).run(input.candidateId, input.raceKey, `obs-${input.candidateId}`);
    db.prepare(`
      INSERT INTO race_payout_lines_v2 (
        payout_line_id, candidate_id, line_no, bet_type, selection_canonical, line_kind
      ) VALUES (?, ?, 1, 'trifecta', ?, 'payout')
    `).run(`payout-${input.candidateId}`, input.candidateId, input.selection);
  } finally {
    db.close();
  }
}

function writeAcceptedT5(root: string, input: {
  date: string;
  venue: string;
  raceNo: number;
  decisionCutoff?: string;
}): void {
  const raceDir = String(input.raceNo).padStart(2, "0");
  const raceIdentity = `${input.date.replaceAll("-", "")}-${input.venue}-${raceDir}`;
  const base = `data/raw/research/trifecta-market/${input.date}/${input.venue}/${raceDir}/T-5`;
  const dir = join(root, base);
  mkdirSync(dir, { recursive: true });
  const rawRelativePath = `${base}/fixture.html`;
  const envelopeRelativePath = `${base}/fixture.envelope.json`;
  const manifestDigest = "a".repeat(64);
  const checkpointKey = "b".repeat(64);
  const decisionCutoff = input.decisionCutoff ?? `${input.date}T03:30:00.000Z`;
  writeFileSync(join(root, rawRelativePath), "private odds fixture placeholder\n", "utf8");
  writeFileSync(join(root, envelopeRelativePath), `${JSON.stringify({
    envelopeVersion: "n2-trifecta-private-capture-envelope-v1",
    status: "PASS",
    blockers: [],
    manifestDigest,
    checkpointKey,
    entry: { raceIdentity, checkpointLabel: "T-5", decisionCutoff },
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    publicPublishAuthorized: false,
    productionApplyExecuted: false,
  }, null, 2)}\n`, "utf8");
  writeFileSync(join(dir, "accepted.json"), `${JSON.stringify({
    markerVersion: "n2-trifecta-private-capture-accepted-v1",
    manifestDigest,
    checkpointKey,
    raceIdentity,
    checkpointLabel: "T-5",
    rawDocumentId: `raw-${input.date}-${input.venue}-${raceDir}`,
    rawSha256: "a".repeat(64),
    rawRelativePath,
    envelopeRelativePath,
    acceptedAt: `${input.date}T03:00:00.000Z`,
    databaseWriteAuthorized: false,
    productionApplyExecuted: false,
  }, null, 2)}\n`, "utf8");
}

function evaluationSpec(index: number): { date: string; venue: string; raceNo: number; raceKey: string } {
  const date = index < 12 ? "2026-08-07" : "2026-08-08";
  const raceNo = index < 12 ? index + 1 : index - 11;
  return { date, venue: "05", raceNo, raceKey: `${date}:05:R${raceNo}` };
}

function prepare(root: string, acceptedCount = 20): string {
  const sidecar = createSidecar(root);
  for (let offset = -175; offset <= -1; offset += 1) {
    const date = isoDate("2026-08-07", offset);
    insertWinner(sidecar, {
      raceKey: `${date}:05:R1`,
      candidateId: `train-${Math.abs(offset)}`,
      selection: offset % 2 === 0 ? "1-2-3" : "2-1-3",
    });
  }
  for (let index = 0; index < 20; index += 1) {
    const spec = evaluationSpec(index);
    insertWinner(sidecar, {
      raceKey: spec.raceKey,
      candidateId: `eval-${index}`,
      selection: index % 2 === 0 ? "1-2-3" : "2-1-3",
    });
    if (index < acceptedCount) writeAcceptedT5(root, spec);
  }
  return sidecar;
}

test("source reader selects the same 20 accepted T-5 cohort without reading odds values", () => {
  withRoot((root) => {
    prepare(root);
    const read = readN2HistoricalOnlyBaselineSources({ dataRoot: root });
    assert.equal(read.status, "PASS");
    assert.deepEqual(read.blockers, []);
    assert.equal(read.readinessStatus, "READY_FOR_N2_020");
    assert.equal(read.selectedCohortRaceCount, 20);
    assert.equal(read.evaluationRaces.length, 20);
    assert.ok(read.historicalTrainingRaceCount >= 195);
    assert.equal(read.trainingFromDateInclusive, "2026-02-08");
    assert.equal(read.trainingToDateInclusive, "2026-08-08");
    assert.equal(read.databaseReadCount, 2);
    assert.equal(read.databaseWriteCount, 0);
    assert.equal(read.networkRequestCount, 0);
    assert.equal(read.rawOddsValuesRead, false);
    assert.equal(read.liveOnlyFeatureReadCount, 0);
    assert.equal(read.publicPublishAuthorized, false);
    assert.equal(read.productionApplyExecuted, false);
  });
});

test("historical cohort follows verified T-5 cutoff time across venues", () => {
  withRoot((root) => {
    const sidecar = prepare(root);
    const lateRace = { date: "2026-08-07", venue: "01", raceNo: 1, raceKey: "2026-08-07:01:R1" };
    const earlyRace = { date: "2026-08-07", venue: "24", raceNo: 1, raceKey: "2026-08-07:24:R1" };
    for (const [spec, cutoff, id] of [
      [lateRace, "2026-08-07T08:00:00.000Z", "late"],
      [earlyRace, "2026-08-07T01:00:00.000Z", "early"],
    ] as const) {
      insertWinner(sidecar, { raceKey: spec.raceKey, candidateId: `extra-${id}`, selection: "1-2-3" });
      writeAcceptedT5(root, { ...spec, decisionCutoff: cutoff });
    }
    const read = readN2HistoricalOnlyBaselineSources({ dataRoot: root });
    assert.equal(read.status, "PASS");
    assert.equal(read.evaluationRaces.some((race) => race.canonicalRaceKey === earlyRace.raceKey), true);
    assert.equal(read.evaluationRaces.some((race) => race.canonicalRaceKey === lateRace.raceKey), false);
    assert.equal(read.rawOddsValuesRead, false);
  });
});

test("source reader remains blocked before the shared 20-race cohort is ready", () => {
  withRoot((root) => {
    prepare(root, 19);
    const read = readN2HistoricalOnlyBaselineSources({ dataRoot: root });
    assert.equal(read.status, "BLOCKED");
    assert.ok(read.blockers.includes("READINESS_ACCUMULATING"));
    assert.equal(read.training.length, 0);
    assert.equal(read.evaluationRaces.length, 0);
    assert.equal(read.rawOddsValuesRead, false);
  });
});

test("source reader fails closed if immutable sidecar WAL becomes active", () => {
  withRoot((root) => {
    const sidecar = prepare(root);
    writeFileSync(`${sidecar}-wal`, "active wal\n", "utf8");
    const read = readN2HistoricalOnlyBaselineSources({ dataRoot: root });
    assert.equal(read.status, "BLOCKED");
    assert.ok(read.blockers.includes("READINESS_BLOCKED") || read.blockers.includes("SIDECAR_ACTIVE_WAL"));
    assert.equal(read.databaseWriteCount, 0);
  });
});

test("ambiguous active historical winner blocks training rather than being silently chosen", () => {
  withRoot((root) => {
    const sidecar = prepare(root);
    insertWinner(sidecar, {
      raceKey: "2026-07-01:05:R1",
      candidateId: "duplicate-history",
      selection: "3-1-2",
    });
    const read = readN2HistoricalOnlyBaselineSources({ dataRoot: root });
    assert.equal(read.status, "BLOCKED");
    assert.ok(read.blockers.some((blocker) => blocker.includes("2026-07-01:05:R1:ACTIVE_WINNER_COUNT_2")));
    assert.equal(read.training.length, 0);
    assert.equal(read.evaluationRaces.length, 0);
  });
});
