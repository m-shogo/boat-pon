import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { canonicalHash } from "./canonical";
import { buildBoatRaceOfficialSourceUrl } from "./n2ExternalSourceCaptureContract";
import { readN2MarketBaselineReadiness } from "./n2MarketBaselineReadinessReader";

const DATE = "2026-08-07";
const VENUE = "10";
const RACE_NO = 1;
const RACE_KEY = `${DATE}:${VENUE}:R${RACE_NO}`;

function writeAcceptedT5(root: string): void {
  const raceDir = String(RACE_NO).padStart(2, "0");
  const raceIdentity = `${DATE.replaceAll("-", "")}-${VENUE}-${raceDir}`;
  const relativeDirectory = ["data", "raw", "research", "trifecta-market", DATE, VENUE, raceDir, "T-5"].join("/");
  const rawRelativePath = `${relativeDirectory}/capture.html`;
  const envelopeRelativePath = `${relativeDirectory}/capture.envelope.json`;
  const rawPath = join(root, rawRelativePath);
  const envelopePath = join(root, envelopeRelativePath);
  const manifestDigest = "c".repeat(64);
  const decisionCutoff = `${DATE}T03:30:00.000Z`;
  const targetCaptureAt = new Date(Date.parse(decisionCutoff) - 5 * 60_000).toISOString();
  const sourceUrl = buildBoatRaceOfficialSourceUrl(
    "boatrace_official_trifecta_odds_html",
    { date: DATE.replaceAll("-", ""), venueCode: VENUE, raceNo: RACE_NO },
  );
  const checkpointKey = canonicalHash({
    manifestDigest,
    raceIdentity,
    checkpointLabel: "T-5",
    targetCaptureAt,
    sourceUrl,
  });

  mkdirSync(dirname(rawPath), { recursive: true });
  writeFileSync(rawPath, "private raw fixture\n", "utf8");
  writeFileSync(envelopePath, `${JSON.stringify({
    envelopeVersion: "n2-trifecta-private-capture-envelope-v1",
    status: "PASS",
    blockers: [],
    manifestDigest,
    checkpointKey,
    entry: { raceIdentity, checkpointLabel: "T-5", decisionCutoff },
    response: { fetchedAt: `${DATE}T03:25:30.000Z` },
    sourceDisplayedUpdate: { availableAt: `${DATE}T03:24:00.000Z` },
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    publicPublishAuthorized: false,
    productionApplyExecuted: false,
  }, null, 2)}\n`, "utf8");
  writeFileSync(join(root, relativeDirectory, "accepted.json"), `${JSON.stringify({
    markerVersion: "n2-trifecta-private-capture-accepted-v1",
    manifestDigest,
    checkpointKey,
    raceIdentity,
    checkpointLabel: "T-5",
    rawDocumentId: "raw-private-capture",
    rawSha256: "b".repeat(64),
    rawRelativePath,
    envelopeRelativePath,
    acceptedAt: `${DATE}T03:00:00.000Z`,
    databaseWriteAuthorized: false,
    productionApplyExecuted: false,
  }, null, 2)}\n`, "utf8");
}

function createCurrentSidecar(root: string): string {
  const path = join(root, "data/research-replay.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE raw_documents (
        raw_document_id TEXT PRIMARY KEY,
        integrity_status TEXT NOT NULL,
        security_scan_status TEXT NOT NULL,
        parser_replay_eligible INTEGER NOT NULL
      );
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
        parse_run_id TEXT NOT NULL,
        supersedes_id TEXT,
        correction_kind TEXT,
        correction_reason TEXT
      );
      CREATE TABLE settlement_candidates_v2 (
        candidate_id TEXT PRIMARY KEY,
        canonical_race_key TEXT NOT NULL,
        bet_type TEXT NOT NULL,
        settlement_status TEXT NOT NULL,
        result_kind TEXT NOT NULL,
        revision_kind TEXT NOT NULL,
        resolution_status TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_schema_version TEXT NOT NULL,
        observation_id TEXT NOT NULL,
        parse_run_id TEXT NOT NULL,
        raw_document_id TEXT NOT NULL,
        semantic_hash TEXT NOT NULL,
        supersedes_candidate_id TEXT,
        correction_reason TEXT,
        observed_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE race_payout_lines_v2 (
        payout_line_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        bet_type TEXT NOT NULL,
        selection_raw TEXT NOT NULL,
        selection_normalized TEXT NOT NULL,
        selection_canonical TEXT,
        payout_yen INTEGER NOT NULL,
        popularity INTEGER,
        line_kind TEXT NOT NULL
      );
      CREATE TABLE race_refund_lines_v2 (
        refund_line_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        bet_type TEXT NOT NULL,
        selection_raw TEXT,
        selection_normalized TEXT,
        selection_canonical TEXT,
        refund_scope TEXT NOT NULL,
        refund_yen_per_100 INTEGER,
        reason_code TEXT NOT NULL
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

    const observationId = "obs-candidate";
    const parseRunId = "parse-candidate";
    const rawDocumentId = "raw-candidate";
    db.prepare("INSERT INTO raw_documents VALUES (?, 'verified', 'passed', 1)").run(rawDocumentId);
    db.prepare("INSERT INTO parse_runs VALUES (?, ?, 'success')").run(parseRunId, rawDocumentId);
    db.prepare(`
      INSERT INTO domain_observations VALUES (?, ?, 'settlement_result', 'settlement_result', ?, ?, NULL, NULL, NULL)
    `).run(observationId, RACE_KEY, rawDocumentId, parseRunId);
    db.prepare(`
      INSERT INTO settlement_candidates_v2 VALUES (
        ?, ?, 'trifecta', 'settled', 'normal', 'initial', 'resolved',
        'official_result', 'n1-settlement.0.1', ?, ?, ?, ?, NULL, NULL, ?, ?
      )
    `).run(
      "candidate",
      RACE_KEY,
      observationId,
      parseRunId,
      rawDocumentId,
      "0".repeat(64),
      `${DATE}T04:00:00.000Z`,
      `${DATE}T04:00:00.000Z`,
    );
    db.prepare(`
      INSERT INTO race_payout_lines_v2 VALUES (?, ?, 1, 'trifecta', '1-2-3', '1-2-3', '1-2-3', 1000, 1, 'payout')
    `).run("payout-candidate", "candidate");
  } finally {
    db.close();
  }
  return path;
}

test("market readiness rejects a current active settlement with a tampered semantic hash", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-market-readiness-semantic-hash-"));
  try {
    writeAcceptedT5(root);
    createCurrentSidecar(root);

    const result = readN2MarketBaselineReadiness({ dataRoot: root });

    assert.deepEqual(result.acceptedT5RaceKeys, [RACE_KEY]);
    assert.deepEqual(result.settledRaceKeys, []);
    assert.deepEqual(result.integrityBlockedRaceKeys, [RACE_KEY]);
    assert.equal(result.settlementEligibleRaceCount, 0);
    assert.equal(result.rawOddsValuesRead, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
