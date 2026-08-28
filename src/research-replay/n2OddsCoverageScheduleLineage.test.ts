import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { semanticPayloadHash } from "./domain";
import { enumerateBetSelections } from "./n2DatasetContract";
import { readTrifectaMarketCoverageEvents } from "./n2OddsCoverageReader";

const RACE_KEY = "2026-05-20:01:R1";
const OBSERVED_AT = "2026-05-20T02:55:00Z";

function createFixture(): { dir: string; primaryPath: string; sidecarPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "n2-odds-schedule-lineage-"));
  const primaryPath = join(dir, "primary.sqlite");
  const sidecarPath = join(dir, "sidecar.sqlite");

  const primary = new DatabaseSync(primaryPath);
  primary.exec(`
    CREATE TABLE official_programs (
      race_id TEXT PRIMARY KEY, date TEXT NOT NULL, venue TEXT NOT NULL, race_no INTEGER NOT NULL,
      source_file TEXT NOT NULL, raw_json TEXT NOT NULL, imported_at TEXT NOT NULL
    );
    INSERT INTO official_programs VALUES
      ('20260520-01-01','2026-05-20','01',1,'program-a','{}','2026-05-20T00:00:00Z');
  `);
  primary.close();

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
  `);

  const schedulePayload = {
    canonicalRaceKey: RACE_KEY,
    scheduledCloseAt: "2026-05-20T03:00:00Z",
    scheduledCloseOriginalOffset: "+09:00",
    scheduleStatus: "scheduled",
  };
  const scheduleHash = semanticPayloadHash("race_schedule", schedulePayload);
  sidecar.prepare("INSERT INTO raw_documents VALUES ('raw-schedule', 'failed', 'passed', 1)").run();
  sidecar.prepare("INSERT INTO parse_runs VALUES ('parse-schedule', 'raw-schedule', 'success')").run();
  sidecar.prepare(`INSERT INTO domain_observations VALUES (
    'schedule-1', ?, 'race_schedule', 'race_schedule', 'rr-payload-v1', ?,
    'raw-schedule', 'parse-schedule', '2026-05-20T02:00:00Z', '2026-05-20T02:00:00Z',
    '2026-05-20T02:00:01Z', 'source_exact', 'official_public'
  )`).run(RACE_KEY, scheduleHash);
  sidecar.prepare("INSERT INTO typed_observation_payloads VALUES ('schedule-1', 'race_schedule', 'rr-payload-v1', ?, ?)")
    .run(JSON.stringify(schedulePayload), scheduleHash);

  const marketPayload = {
    selections: enumerateBetSelections("trifecta").map((selection, index) => ({ selection, odds: 10 + index / 10 })),
    scheduledCloseObservationId: "schedule-1",
    scheduledCloseAtSeen: "2026-05-20T03:00:00Z",
    observedAt: OBSERVED_AT,
    minutesBeforeCloseAtCapture: 5,
    checkpointLabelAtCapture: "T-5",
    checkpointPolicyVersion: "t-minus-nearest-v1",
    marketKind: "live_checkpoint",
  };
  const marketHash = semanticPayloadHash("trifecta_market", marketPayload);
  sidecar.prepare("INSERT INTO raw_documents VALUES ('raw-market', 'verified', 'passed', 1)").run();
  sidecar.prepare("INSERT INTO parse_runs VALUES ('parse-market', 'raw-market', 'success')").run();
  sidecar.prepare(`INSERT INTO domain_observations VALUES (
    'market-1', ?, 'trifecta_market', 'trifecta_market', 'rr-payload-v1', ?,
    'raw-market', 'parse-market', NULL, ?, ?, 'observed_only', 'official_public'
  )`).run(RACE_KEY, marketHash, OBSERVED_AT, OBSERVED_AT);
  sidecar.prepare("INSERT INTO typed_observation_payloads VALUES ('market-1', 'trifecta_market', 'rr-payload-v1', ?, ?)")
    .run(JSON.stringify(marketPayload), marketHash);
  sidecar.close();

  return { dir, primaryPath, sidecarPath };
}

test("odds coverage rejects a market whose referenced schedule raw evidence is not replay eligible", () => {
  const fixture = createFixture();
  try {
    const events = readTrifectaMarketCoverageEvents({
      primaryDbPath: fixture.primaryPath,
      sidecarDbPath: fixture.sidecarPath,
      dateFrom: "2026-05-20",
      dateTo: "2026-05-20",
      checkpoint: "T-5",
    });
    assert.equal(events.length, 120);
    assert.equal(events.filter((event) => event.status === "verified").length, 0);
    assert.ok(events.every((event) => event.exclusionReason === "excluded_invalid_market_payload"));
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});
