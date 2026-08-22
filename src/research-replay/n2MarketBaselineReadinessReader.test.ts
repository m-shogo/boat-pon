import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readN2MarketBaselineReadiness } from "./n2MarketBaselineReadinessReader";

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-market-readiness-reader-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeAcceptedT5(root: string, input: {
  date: string;
  venue: string;
  raceNo: number;
  malformed?: boolean;
}): void {
  const raceDir = String(input.raceNo).padStart(2, "0");
  const directory = join(
    root,
    "data/raw/research/trifecta-market",
    input.date,
    input.venue,
    raceDir,
    "T-5",
  );
  mkdirSync(directory, { recursive: true });
  const rawRelativePath = [
    "data", "raw", "research", "trifecta-market",
    input.date, input.venue, raceDir, "T-5", "capture.html",
  ].join("/");
  const envelopeRelativePath = [
    "data", "raw", "research", "trifecta-market",
    input.date, input.venue, raceDir, "T-5", "capture.envelope.json",
  ].join("/");
  const rawPath = join(root, rawRelativePath);
  const envelopePath = join(root, envelopeRelativePath);
  mkdirSync(dirname(rawPath), { recursive: true });
  writeFileSync(rawPath, "private raw fixture\n", "utf8");
  writeFileSync(envelopePath, "{}\n", "utf8");
  writeFileSync(join(directory, "accepted.json"), `${JSON.stringify({
    markerVersion: input.malformed
      ? "wrong-version"
      : "n2-trifecta-private-capture-accepted-v1",
    checkpointKey: "a".repeat(64),
    raceIdentity: `${input.date.replaceAll("-", "")}-${input.venue}-${raceDir}`,
    checkpointLabel: "T-5",
    rawDocumentId: `raw-${input.date}-${input.venue}-${raceDir}`,
    rawSha256: "b".repeat(64),
    rawRelativePath,
    envelopeRelativePath,
    acceptedAt: `${input.date}T03:00:00.000Z`,
    databaseWriteAuthorized: false,
    productionApplyExecuted: false,
  }, null, 2)}\n`, "utf8");
}

function createSidecar(root: string): string {
  const path = join(root, "data/research-replay.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE parse_runs (
      parse_run_id TEXT PRIMARY KEY,
      raw_document_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE domain_observations (
      observation_id TEXT PRIMARY KEY,
      canonical_race_key TEXT NOT NULL,
      observation_type TEXT NOT NULL,
      payload_type TEXT NOT NULL,
      raw_document_id TEXT NOT NULL,
      parse_run_id TEXT NOT NULL
    );
    CREATE TABLE settlement_candidates_v2 (
      candidate_id TEXT PRIMARY KEY,
      canonical_race_key TEXT NOT NULL,
      bet_type TEXT NOT NULL,
      settlement_status TEXT NOT NULL,
      result_kind TEXT NOT NULL,
      resolution_status TEXT NOT NULL,
      observation_id TEXT NOT NULL,
      parse_run_id TEXT NOT NULL,
      raw_document_id TEXT NOT NULL,
      supersedes_candidate_id TEXT
    );
    CREATE TABLE race_payout_lines_v2 (
      payout_line_id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      bet_type TEXT NOT NULL,
      selection_canonical TEXT,
      line_kind TEXT NOT NULL
    );
    CREATE TABLE settlement_source_duplicate_resolutions_v2 (
      resolution_id TEXT PRIMARY KEY,
      duplicate_observation_id TEXT NOT NULL,
      canonical_observation_id TEXT NOT NULL,
      canonical_race_key TEXT NOT NULL,
      raw_document_id TEXT NOT NULL,
      source_archive_file TEXT NOT NULL,
      resolution_kind TEXT NOT NULL,
      detection_reason TEXT NOT NULL,
      duplicate_semantic_digest TEXT NOT NULL,
      resolver_version TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      schema_version TEXT NOT NULL
    );
  `);
  db.close();
  return path;
}

function insertCandidate(path: string, input: {
  raceKey: string;
  candidateId: string;
  status: string;
  resultKind?: string;
  resolutionStatus?: string;
  payoutSelection?: string | null;
  specialPayout?: boolean;
}): void {
  const db = new DatabaseSync(path);
  try {
    const observationId = `obs-${input.candidateId}`;
    const parseRunId = `parse-${input.candidateId}`;
    const rawDocumentId = `raw-${input.candidateId}`;
    db.prepare("INSERT INTO parse_runs VALUES (?, ?, 'success')").run(parseRunId, rawDocumentId);
    db.prepare(`
      INSERT INTO domain_observations (
        observation_id, canonical_race_key, observation_type, payload_type,
        raw_document_id, parse_run_id
      ) VALUES (?, ?, 'settlement_result', 'settlement_result', ?, ?)
    `).run(observationId, input.raceKey, rawDocumentId, parseRunId);
    db.prepare(`
      INSERT INTO settlement_candidates_v2 (
        candidate_id, canonical_race_key, bet_type, settlement_status,
        result_kind, resolution_status, observation_id, parse_run_id,
        raw_document_id, supersedes_candidate_id
      ) VALUES (?, ?, 'trifecta', ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      input.candidateId,
      input.raceKey,
      input.status,
      input.resultKind ?? "normal",
      input.resolutionStatus ?? "resolved",
      observationId,
      parseRunId,
      rawDocumentId,
    );
    if (input.payoutSelection !== undefined) {
      db.prepare(`
        INSERT INTO race_payout_lines_v2 (
          payout_line_id, candidate_id, bet_type, selection_canonical, line_kind
        ) VALUES (?, ?, 'trifecta', ?, ?)
      `).run(
        `payout-${input.candidateId}`,
        input.candidateId,
        input.payoutSelection,
        input.specialPayout ? "special_payout" : "payout",
      );
    }
  } finally {
    db.close();
  }
}

test("reader intersects accepted T-5 races with clean trifecta settlements", () => {
  withRoot((root) => {
    writeAcceptedT5(root, { date: "2026-08-07", venue: "10", raceNo: 1 });
    writeAcceptedT5(root, { date: "2026-08-07", venue: "10", raceNo: 2 });
    const sidecar = createSidecar(root);
    insertCandidate(sidecar, {
      raceKey: "2026-08-07:10:R1",
      candidateId: "c1",
      status: "settled",
      payoutSelection: "1-2-3",
    });
    insertCandidate(sidecar, {
      raceKey: "2026-08-07:10:R2",
      candidateId: "c2",
      status: "pending",
    });

    const result = readN2MarketBaselineReadiness({ dataRoot: root });
    assert.deepEqual(result.acceptedT5RaceKeys, [
      "2026-08-07:10:R1",
      "2026-08-07:10:R2",
    ]);
    assert.deepEqual(result.settledRaceKeys, ["2026-08-07:10:R1"]);
    assert.deepEqual(result.integrityBlockedRaceKeys, []);
    assert.deepEqual(result.sourceBlockers, []);
    assert.equal(result.acceptedMarkerCount, 2);
    assert.equal(result.invalidAcceptedMarkerCount, 0);
    assert.equal(result.settlementEligibleRaceCount, 1);
    assert.equal(result.settlementIneligibleRaceCount, 1);
    assert.equal(result.databaseReadCount, 1);
    assert.equal(result.databaseWriteCount, 0);
    assert.equal(result.rawOddsValuesRead, false);
  });
});

test("malformed accepted marker is retained as integrity-blocked evidence", () => {
  withRoot((root) => {
    writeAcceptedT5(root, {
      date: "2026-08-07",
      venue: "10",
      raceNo: 1,
      malformed: true,
    });
    createSidecar(root);

    const result = readN2MarketBaselineReadiness({ dataRoot: root });
    assert.deepEqual(result.acceptedT5RaceKeys, []);
    assert.deepEqual(result.settledRaceKeys, []);
    assert.deepEqual(result.integrityBlockedRaceKeys, ["2026-08-07:10:R1"]);
    assert.equal(result.invalidAcceptedMarkerCount, 1);
    assert.equal(result.databaseReadCount, 0);
    assert.equal(result.rawOddsValuesRead, false);
  });
});

test("duplicate active settlement candidates fail closed for that race", () => {
  withRoot((root) => {
    writeAcceptedT5(root, { date: "2026-08-07", venue: "10", raceNo: 1 });
    const sidecar = createSidecar(root);
    insertCandidate(sidecar, {
      raceKey: "2026-08-07:10:R1",
      candidateId: "c1",
      status: "settled",
      payoutSelection: "1-2-3",
    });
    insertCandidate(sidecar, {
      raceKey: "2026-08-07:10:R1",
      candidateId: "c2",
      status: "settled",
      payoutSelection: "1-3-2",
    });

    const result = readN2MarketBaselineReadiness({ dataRoot: root });
    assert.deepEqual(result.settledRaceKeys, []);
    assert.deepEqual(result.integrityBlockedRaceKeys, ["2026-08-07:10:R1"]);
  });
});

test("settlement lineage drift blocks readiness for the affected race", () => {
  withRoot((root) => {
    writeAcceptedT5(root, { date: "2026-08-07", venue: "10", raceNo: 1 });
    const sidecar = createSidecar(root);
    insertCandidate(sidecar, {
      raceKey: "2026-08-07:10:R1",
      candidateId: "c1",
      status: "settled",
      payoutSelection: "1-2-3",
    });
    const db = new DatabaseSync(sidecar);
    try {
      db.prepare("UPDATE domain_observations SET canonical_race_key=? WHERE observation_id=?")
        .run("2026-08-07:10:R2", "obs-c1");
    } finally {
      db.close();
    }

    const result = readN2MarketBaselineReadiness({ dataRoot: root });
    assert.deepEqual(result.settledRaceKeys, []);
    assert.deepEqual(result.integrityBlockedRaceKeys, ["2026-08-07:10:R1"]);
    assert.equal(result.settlementEligibleRaceCount, 0);
    assert.equal(result.rawOddsValuesRead, false);
  });
});

test("stale source-duplicate evidence blocks settlement readiness", () => {
  withRoot((root) => {
    writeAcceptedT5(root, { date: "2026-08-07", venue: "10", raceNo: 1 });
    const sidecar = createSidecar(root);
    insertCandidate(sidecar, {
      raceKey: "2026-08-07:10:R1",
      candidateId: "c1",
      status: "settled",
      payoutSelection: "1-2-3",
    });
    const db = new DatabaseSync(sidecar);
    try {
      db.prepare(`INSERT INTO settlement_source_duplicate_resolutions_v2
        VALUES ('stale','obs-c1','missing-observation','2026-08-07:10:R1','raw-c1','k260807.lzh','source_duplicate','stale','deadbeef','stale','stale','stale')`).run();
    } finally {
      db.close();
    }

    const result = readN2MarketBaselineReadiness({ dataRoot: root });
    assert.deepEqual(result.settledRaceKeys, []);
    assert.deepEqual(result.sourceBlockers, ["SOURCE_DUPLICATE_RESOLUTION_EVIDENCE_INVALID"]);
    assert.equal(result.settlementEligibleRaceCount, 0);
    assert.equal(result.databaseReadCount, 0);
    assert.equal(result.rawOddsValuesRead, false);
  });
});

test("active sidecar WAL blocks settlement readiness without retry", () => {
  withRoot((root) => {
    writeAcceptedT5(root, { date: "2026-08-07", venue: "10", raceNo: 1 });
    const sidecar = createSidecar(root);
    writeFileSync(`${sidecar}-wal`, "active wal\n", "utf8");

    const result = readN2MarketBaselineReadiness({ dataRoot: root });
    assert.deepEqual(result.settledRaceKeys, []);
    assert.deepEqual(result.sourceBlockers, ["SIDECAR_ACTIVE_WAL"]);
    assert.equal(result.databaseReadCount, 0);
  });
});
