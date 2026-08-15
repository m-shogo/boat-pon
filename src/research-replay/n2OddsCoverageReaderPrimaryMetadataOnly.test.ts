import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readTrifectaMarketCoverageEvents } from "./n2OddsCoverageReader";

test("odds coverage needs only primary race metadata, not primary raw program payloads", () => {
  const dir = mkdtempSync(join(tmpdir(), "boat-pon-n2-odds-metadata-only-"));
  const primaryPath = join(dir, "primary.sqlite");
  const sidecarPath = join(dir, "sidecar.sqlite");

  const primary = new DatabaseSync(primaryPath);
  primary.exec(`
    CREATE TABLE official_programs (
      race_id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      venue TEXT NOT NULL,
      race_no INTEGER NOT NULL
    );
    INSERT INTO official_programs VALUES ('20260520-01-01', '2026-05-20', '01', 1);
  `);
  primary.close();

  const sidecar = new DatabaseSync(sidecarPath);
  sidecar.exec(`
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
      payload_schema_version TEXT NOT NULL,
      semantic_payload_hash TEXT NOT NULL,
      raw_document_id TEXT NOT NULL,
      parse_run_id TEXT NOT NULL,
      source_published_at TEXT,
      source_observed_at TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      timing_quality TEXT NOT NULL,
      source_quality TEXT NOT NULL
    );
    CREATE TABLE typed_observation_payloads (
      observation_id TEXT PRIMARY KEY,
      payload_type TEXT NOT NULL,
      payload_schema_version TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL
    );
  `);
  sidecar.close();

  try {
    const events = readTrifectaMarketCoverageEvents({
      primaryDbPath: primaryPath,
      sidecarDbPath: sidecarPath,
      dateFrom: "2026-05-20",
      dateTo: "2026-05-20",
      checkpoint: "T-5",
    });
    assert.equal(events.length, 120);
    assert.ok(events.every((event) => event.exclusionReason === "excluded_market_checkpoint_not_found"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
