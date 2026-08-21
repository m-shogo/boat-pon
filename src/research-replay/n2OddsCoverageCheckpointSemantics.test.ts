import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { semanticPayloadHash } from "./domain";
import { enumerateBetSelections } from "./n2DatasetContract";
import { readTrifectaMarketCoverageEvents } from "./n2OddsCoverageReader";

test("coverage rejects rehashed market payload whose checkpoint label contradicts its timestamps", () => {
  const dir = mkdtempSync(join(tmpdir(), "n2-odds-checkpoint-semantics-"));
  try {
    const primaryPath = join(dir, "primary.sqlite");
    const sidecarPath = join(dir, "sidecar.sqlite");
    const primary = new DatabaseSync(primaryPath);
    primary.exec(`
      CREATE TABLE official_programs (
        race_id TEXT PRIMARY KEY, date TEXT NOT NULL, venue TEXT NOT NULL, race_no INTEGER NOT NULL
      );
      INSERT INTO official_programs VALUES ('20260520-01-01','2026-05-20','01',1);
    `);
    primary.close();

    const payload = {
      selections: enumerateBetSelections("trifecta").map((selection, index) => ({ selection, odds: 10 + index / 10 })),
      scheduledCloseObservationId: "schedule-1",
      scheduledCloseAtSeen: "2026-05-20T03:00:00.000Z",
      observedAt: "2026-05-20T02:55:00.000Z",
      minutesBeforeCloseAtCapture: 5,
      checkpointLabelAtCapture: "T-30",
      checkpointPolicyVersion: "t-minus-nearest-v1",
      marketKind: "live_checkpoint",
    };
    const hash = semanticPayloadHash("trifecta_market", payload);
    const sidecar = new DatabaseSync(sidecarPath);
    sidecar.exec(`
      CREATE TABLE raw_documents (
        raw_document_id TEXT PRIMARY KEY, integrity_status TEXT NOT NULL,
        security_scan_status TEXT NOT NULL, parser_replay_eligible INTEGER NOT NULL
      );
      CREATE TABLE parse_runs (
        parse_run_id TEXT PRIMARY KEY, raw_document_id TEXT NOT NULL, status TEXT NOT NULL
      );
      CREATE TABLE domain_observations (
        observation_id TEXT PRIMARY KEY, canonical_race_key TEXT NOT NULL, observation_type TEXT NOT NULL,
        payload_type TEXT NOT NULL, payload_schema_version TEXT NOT NULL, semantic_payload_hash TEXT NOT NULL,
        raw_document_id TEXT NOT NULL, parse_run_id TEXT NOT NULL, source_published_at TEXT,
        source_observed_at TEXT NOT NULL, first_seen_at TEXT NOT NULL,
        timing_quality TEXT NOT NULL, source_quality TEXT NOT NULL
      );
      CREATE TABLE typed_observation_payloads (
        observation_id TEXT PRIMARY KEY, payload_type TEXT NOT NULL,
        payload_schema_version TEXT NOT NULL, payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL
      );
      INSERT INTO raw_documents VALUES ('raw-1','verified','passed',1);
      INSERT INTO parse_runs VALUES ('parse-1','raw-1','success');
    `);
    sidecar.prepare(`INSERT INTO domain_observations VALUES (
      'obs-1','2026-05-20:01:R1','trifecta_market','trifecta_market','rr-payload-v1',?,
      'raw-1','parse-1',NULL,'2026-05-20T02:55:00.000Z','2026-05-20T02:55:01.000Z',
      'observed_only','official_public'
    )`).run(hash);
    sidecar.prepare(`INSERT INTO typed_observation_payloads VALUES (
      'obs-1','trifecta_market','rr-payload-v1',?,?
    )`).run(JSON.stringify(payload), hash);
    sidecar.close();

    const events = readTrifectaMarketCoverageEvents({
      primaryDbPath: primaryPath,
      sidecarDbPath: sidecarPath,
      dateFrom: "2026-05-20",
      dateTo: "2026-05-20",
      checkpoint: "T-30",
    });
    assert.equal(events.length, 120);
    assert.ok(events.every((event) => event.status === "excluded"));
    assert.ok(events.every((event) => event.exclusionReason === "excluded_invalid_market_payload"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
