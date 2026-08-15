import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readOfficialProgramCoverageEvents } from "./n2FeatureCoverageReader";

test("missing typed program payload is rejected before primary raw projection is touched", () => {
  const dir = mkdtempSync(join(tmpdir(), "n2-feature-missing-payload-preflight-"));
  const primaryPath = join(dir, "primary.sqlite");
  const sidecarPath = join(dir, "sidecar.sqlite");
  try {
    const primary = new DatabaseSync(primaryPath);
    primary.exec(`
      CREATE TABLE official_programs (
        race_id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        venue TEXT NOT NULL,
        race_no INTEGER NOT NULL
      );
    `);
    primary.prepare("INSERT INTO official_programs VALUES (?, ?, ?, ?)").run(
      "20040101-01-01",
      "2004-01-01",
      "01",
      1,
    );
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
    sidecar.prepare("INSERT INTO raw_documents VALUES (?, ?, ?, ?)").run(
      "raw-program-2004",
      "verified",
      "passed",
      1,
    );
    sidecar.prepare("INSERT INTO parse_runs VALUES (?, ?, ?)").run(
      "parse-program-2004",
      "raw-program-2004",
      "success",
    );
    sidecar.prepare("INSERT INTO domain_observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "obs-program-2004",
      "2004-01-01:01:R1",
      "official_program",
      "official_program",
      "research-replay-payload-v1",
      "a".repeat(64),
      "raw-program-2004",
      "parse-program-2004",
      "2004-01-01T01:00:00Z",
      "2004-01-01T01:02:00Z",
      "2004-01-01T01:03:00Z",
      "source_exact",
      "official_public",
    );
    sidecar.close();

    const events = readOfficialProgramCoverageEvents({
      primaryDbPath: primaryPath,
      sidecarDbPath: sidecarPath,
      dateFrom: "2004-01-01",
      dateTo: "2004-01-01",
    });

    assert.equal(events.length, 42);
    assert.ok(events.every((event) => event.status === "excluded"));
    assert.ok(events.every((event) => event.exclusionReason === "excluded_program_typed_payload_missing"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
