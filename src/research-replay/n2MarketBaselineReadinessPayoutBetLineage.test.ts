import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { canonicalHash } from "./canonical";
import { buildBoatRaceOfficialSourceUrl } from "./n2ExternalSourceCaptureContract";
import { readN2MarketBaselineReadiness } from "./n2MarketBaselineReadinessReader";

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-market-readiness-lineage-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeAcceptedT5(root: string): void {
  const date = "2026-08-07";
  const venue = "10";
  const raceNo = 1;
  const raceDir = "01";
  const raceIdentity = "20260807-10-01";
  const directory = join(root, "data/raw/research/trifecta-market", date, venue, raceDir, "T-5");
  const relativeDirectory = "data/raw/research/trifecta-market/2026-08-07/10/01/T-5";
  const rawRelativePath = `${relativeDirectory}/capture.html`;
  const envelopeRelativePath = `${relativeDirectory}/capture.envelope.json`;
  const manifestDigest = "c".repeat(64);
  const decisionCutoff = `${date}T03:30:00.000Z`;
  const targetCaptureAt = new Date(Date.parse(decisionCutoff) - 5 * 60_000).toISOString();
  const sourceUrl = buildBoatRaceOfficialSourceUrl(
    "boatrace_official_trifecta_odds_html",
    { date: "20260807", venueCode: venue, raceNo },
  );
  const checkpointKey = canonicalHash({
    manifestDigest,
    raceIdentity,
    checkpointLabel: "T-5",
    targetCaptureAt,
    sourceUrl,
  });
  mkdirSync(directory, { recursive: true });
  mkdirSync(dirname(join(root, rawRelativePath)), { recursive: true });
  writeFileSync(join(root, rawRelativePath), "private raw fixture\n", "utf8");
  writeFileSync(join(root, envelopeRelativePath), `${JSON.stringify({
    envelopeVersion: "n2-trifecta-private-capture-envelope-v1",
    status: "PASS",
    blockers: [],
    manifestDigest,
    checkpointKey,
    entry: { raceIdentity, checkpointLabel: "T-5", decisionCutoff },
    response: { fetchedAt: `${date}T03:25:30.000Z` },
    sourceDisplayedUpdate: { availableAt: `${date}T03:24:00.000Z` },
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    publicPublishAuthorized: false,
    productionApplyExecuted: false,
  }, null, 2)}\n`, "utf8");
  writeFileSync(join(directory, "accepted.json"), `${JSON.stringify({
    markerVersion: "n2-trifecta-private-capture-accepted-v1",
    manifestDigest,
    checkpointKey,
    raceIdentity,
    checkpointLabel: "T-5",
    rawDocumentId: "raw-private-marker",
    rawSha256: "b".repeat(64),
    rawRelativePath,
    envelopeRelativePath,
    acceptedAt: `${date}T03:00:00.000Z`,
    databaseWriteAuthorized: false,
    productionApplyExecuted: false,
  }, null, 2)}\n`, "utf8");
}

function createSidecar(root: string): string {
  const path = join(root, "data/research-replay.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
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
      selection_raw TEXT NOT NULL,
      selection_normalized TEXT NOT NULL,
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
  db.prepare("INSERT INTO raw_documents VALUES ('raw-a','verified','passed',1)").run();
  db.prepare("INSERT INTO parse_runs VALUES ('parse-a','raw-a','success')").run();
  db.prepare(`INSERT INTO domain_observations
    VALUES ('obs-a','2026-08-07:10:R1','settlement_result','settlement_result','raw-a','parse-a')`).run();
  db.prepare(`INSERT INTO settlement_candidates_v2
    VALUES ('a','2026-08-07:10:R1','trifecta','settled','normal','resolved','obs-a','parse-a','raw-a',NULL)`).run();
  db.prepare(`INSERT INTO race_payout_lines_v2
    VALUES ('normal-a','a','trifecta','1-2-3','1-2-3','1-2-3','payout')`).run();
  db.prepare(`INSERT INTO race_payout_lines_v2
    VALUES ('forged-special-a','a','exacta','1-2','1-2','1-2','special_payout')`).run();
  db.close();
  return path;
}

test("mismatched payout bet lineage cannot hide special-payout evidence from market readiness", () => {
  withRoot((root) => {
    writeAcceptedT5(root);
    createSidecar(root);

    const result = readN2MarketBaselineReadiness({ dataRoot: root });
    assert.deepEqual(result.settledRaceKeys, []);
    assert.deepEqual(result.integrityBlockedRaceKeys, ["2026-08-07:10:R1"]);
    assert.equal(result.settlementEligibleRaceCount, 0);
    assert.equal(result.databaseWriteCount, 0);
    assert.equal(result.rawOddsValuesRead, false);
  });
});