import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { PAYLOAD_SCHEMA_VERSION, semanticPayloadHash } from "./domain";
import { readN2PitAuditObservations } from "./n2PitAuditReader";

function createPrimary(path: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE official_programs (
        race_id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        venue TEXT NOT NULL,
        race_no INTEGER NOT NULL,
        close_at TEXT
      );
    `);
  } finally {
    db.close();
  }
}

function createSidecar(path: string): void {
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
    const insertRaw = db.prepare(`INSERT INTO raw_documents VALUES(?,?,?,?)`);
    const insertParse = db.prepare(`INSERT INTO parse_runs VALUES(?,?,?)`);
    const insertObservation = db.prepare(`INSERT INTO domain_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertPayload = db.prepare(`INSERT INTO typed_observation_payloads VALUES(?,?,?,?,?)`);
    for (const raceNo of [10, 2, 1]) {
      const raw = `raw-${raceNo}`;
      const parse = `parse-${raceNo}`;
      const raceKey = `2024-06-01:01:R${raceNo}`;
      const payload = {
        canonicalRaceKey: raceKey,
        observedAt: "2024-06-01T00:01:00.000Z",
        boats: [{
          course: 1, registrationNo: null, className: null,
          nationalWinRate: null, nationalTop2Rate: null, localWinRate: null, localTop2Rate: null,
          motorTop2Rate: null, boatTop2Rate: null,
        }],
      };
      const hash = semanticPayloadHash("official_program", payload);
      insertRaw.run(raw, "verified", "passed", 1);
      insertParse.run(parse, raw, "success");
      insertObservation.run(
        `obs-${raceNo}`,
        raceKey,
        "official_program",
        "official_program",
        PAYLOAD_SCHEMA_VERSION,
        hash,
        raw,
        parse,
        "2024-06-01T00:00:00.000Z",
        "2024-06-01T00:01:00.000Z",
        "2024-06-01T00:02:00.000Z",
        "source_exact",
        "official_public",
      );
      insertPayload.run(`obs-${raceNo}`, "official_program", PAYLOAD_SCHEMA_VERSION, JSON.stringify(payload), hash);
    }
  } finally {
    db.close();
  }
}

test("PIT audit truncates after numeric race ordering rather than lexical race-key ordering", () => {
  const dir = mkdtempSync(join(tmpdir(), "n2-pit-order-"));
  try {
    const primaryDbPath = join(dir, "boat.sqlite");
    const sidecarDbPath = join(dir, "research-replay.sqlite");
    createPrimary(primaryDbPath);
    createSidecar(sidecarDbPath);

    const result = readN2PitAuditObservations({ primaryDbPath, sidecarDbPath, limit: 2 });

    assert.equal(result.truncated, true);
    assert.deepEqual(
      result.observations.map((observation) => observation.canonicalRaceKey),
      ["2024-06-01:01:R1", "2024-06-01:01:R2"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
