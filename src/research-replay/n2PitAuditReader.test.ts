import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { buildN2PitAuditSummary } from "./n2PitAudit";
import {
  decisionCutoffFromProgram,
  programIdentityMatchesCanonicalKey,
  raceIdFromCanonicalN2Key,
  readN2PitAuditObservations,
} from "./n2PitAuditReader";

type PrimaryIdentity = "venue_label" | "venue_code" | "both";

function createPrimary(path: string, includeProgram = true, identity: PrimaryIdentity = "venue_label"): void {
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
    if (includeProgram) {
      const insert = db.prepare(`INSERT INTO official_programs(race_id,date,venue,race_no,close_at) VALUES(?,?,?,?,?)`);
      if (identity === "venue_label" || identity === "both") {
        insert.run("20240601-桐生-01", "2024-06-01", "桐生", 1, "10:00");
      }
      if (identity === "venue_code" || identity === "both") {
        insert.run("20240601-01-01", "2024-06-01", "01", 1, "10:00");
      }
    }
  } finally {
    db.close();
  }
}

function createSidecar(path: string, observationCount = 2): void {
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
        raw_document_id TEXT NOT NULL,
        parse_run_id TEXT NOT NULL,
        source_published_at TEXT,
        source_observed_at TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        timing_quality TEXT NOT NULL,
        source_quality TEXT NOT NULL
      );
    `);
    const insertRaw = db.prepare(`INSERT INTO raw_documents VALUES(?,?,?,?)`);
    const insertParse = db.prepare(`INSERT INTO parse_runs VALUES(?,?,?)`);
    const insertObservation = db.prepare(`INSERT INTO domain_observations VALUES(?,?,?,?,?,?,?,?,?,?)`);
    for (let index = 0; index < observationCount; index += 1) {
      const id = index + 1;
      const raw = `raw-${id}`;
      const parse = `parse-${id}`;
      const type = index % 2 === 0 ? "official_program" : "trifecta_market";
      insertRaw.run(raw, "verified", "passed", 1);
      insertParse.run(parse, raw, "success");
      insertObservation.run(
        `obs-${id}`,
        "2024-06-01:01:R1",
        type,
        raw,
        parse,
        type === "official_program" ? "2024-06-01T00:00:00.000Z" : null,
        type === "official_program" ? "2024-06-01T00:01:00.000Z" : "2024-06-01T00:55:00.000Z",
        type === "official_program" ? "2024-06-01T00:02:00.000Z" : "2024-06-01T00:55:01.000Z",
        type === "official_program" ? "source_exact" : "observed_only",
        "official_public",
      );
    }
  } finally {
    db.close();
  }
}

test("canonical key converts to legacy code-form primary race id", () => {
  assert.equal(raceIdFromCanonicalN2Key("2024-06-01:01:R1"), "20240601-01-01");
  assert.equal(raceIdFromCanonicalN2Key("2024-06-01:24:R12"), "20240601-24-12");
  assert.equal(raceIdFromCanonicalN2Key("invalid"), null);
  assert.equal(raceIdFromCanonicalN2Key("2024-06-01:25:R1"), null);
  assert.equal(raceIdFromCanonicalN2Key("2024-06-01:01:R13"), null);
});

test("program identity accepts exact venue-label and venue-code encodings only", () => {
  const label = { raceId: "20240601-桐生-01", date: "2024-06-01", venue: "桐生", raceNo: 1, closeAt: "10:00" };
  const code = { raceId: "20240601-01-01", date: "2024-06-01", venue: "01", raceNo: 1, closeAt: "10:00" };
  assert.equal(programIdentityMatchesCanonicalKey(label, "2024-06-01:01:R1"), true);
  assert.equal(programIdentityMatchesCanonicalKey(code, "2024-06-01:01:R1"), true);
  assert.equal(programIdentityMatchesCanonicalKey({ ...label, raceId: "20240601-01-01" }, "2024-06-01:01:R1"), true);
  assert.equal(programIdentityMatchesCanonicalKey({ ...label, venue: "戸田" }, "2024-06-01:01:R1"), false);
  assert.equal(programIdentityMatchesCanonicalKey({ ...label, raceId: "wrong" }, "2024-06-01:01:R1"), false);
});

test("program close time is normalized from JST for both primary identity encodings", () => {
  const label = { raceId: "20240601-桐生-01", date: "2024-06-01", venue: "桐生", raceNo: 1, closeAt: "10:00" };
  const code = { raceId: "20240601-01-01", date: "2024-06-01", venue: "01", raceNo: 1, closeAt: "10:00" };
  assert.equal(decisionCutoffFromProgram(label, "2024-06-01:01:R1"), "2024-06-01T01:00:00.000Z");
  assert.equal(decisionCutoffFromProgram(code, "2024-06-01:01:R1"), "2024-06-01T01:00:00.000Z");
  assert.equal(decisionCutoffFromProgram({ ...label, raceId: "wrong" }, "2024-06-01:01:R1"), null);
  assert.equal(decisionCutoffFromProgram({ ...label, closeAt: "bad" }, "2024-06-01:01:R1"), null);
});

test("reader resolves the real primary venue-label identity read-only", () => {
  const dir = mkdtempSync(join(tmpdir(), "n2-pit-reader-"));
  try {
    const primary = join(dir, "boat.sqlite");
    const sidecar = join(dir, "research-replay.sqlite");
    createPrimary(primary, true, "venue_label");
    createSidecar(sidecar);
    const result = readN2PitAuditObservations({ primaryDbPath: primary, sidecarDbPath: sidecar });
    assert.equal(result.readOnly, true);
    assert.equal(result.queryOnly, true);
    assert.equal(result.truncated, false);
    assert.equal(result.returnedObservationCount, 2);
    assert.deepEqual(result.sourceTypes, ["official_program", "trifecta_market"]);
    assert.equal(result.observations.every((item) => item.decisionCutoff === "2024-06-01T01:00:00.000Z"), true);
    const summary = buildN2PitAuditSummary(result.observations);
    assert.equal(summary.status, "PASS");
    assert.equal(summary.checkedFeatureCount, 1);
    assert.equal(summary.checkedOddsCount, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reader preserves support for legacy venue-code primary identities", () => {
  const dir = mkdtempSync(join(tmpdir(), "n2-pit-reader-"));
  try {
    const primary = join(dir, "boat.sqlite");
    const sidecar = join(dir, "research-replay.sqlite");
    createPrimary(primary, true, "venue_code");
    createSidecar(sidecar, 1);
    const result = readN2PitAuditObservations({ primaryDbPath: primary, sidecarDbPath: sidecar });
    assert.equal(result.observations[0].decisionCutoff, "2024-06-01T01:00:00.000Z");
    assert.equal(buildN2PitAuditSummary(result.observations).status, "PASS");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("multiple matching primary identities fail closed as ambiguous", () => {
  const dir = mkdtempSync(join(tmpdir(), "n2-pit-reader-"));
  try {
    const primary = join(dir, "boat.sqlite");
    const sidecar = join(dir, "research-replay.sqlite");
    createPrimary(primary, true, "both");
    createSidecar(sidecar, 1);
    const result = readN2PitAuditObservations({ primaryDbPath: primary, sidecarDbPath: sidecar });
    assert.equal(result.observations[0].decisionCutoff, null);
    const summary = buildN2PitAuditSummary(result.observations);
    assert.equal(summary.status, "CONDITIONAL");
    assert.equal(summary.ambiguousTimingCount, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing primary program becomes ambiguous rather than using race date", () => {
  const dir = mkdtempSync(join(tmpdir(), "n2-pit-reader-"));
  try {
    const primary = join(dir, "boat.sqlite");
    const sidecar = join(dir, "research-replay.sqlite");
    createPrimary(primary, false);
    createSidecar(sidecar, 1);
    const result = readN2PitAuditObservations({ primaryDbPath: primary, sidecarDbPath: sidecar });
    assert.equal(result.observations[0].decisionCutoff, null);
    const summary = buildN2PitAuditSummary(result.observations);
    assert.equal(summary.status, "CONDITIONAL");
    assert.equal(summary.ambiguousTimingCount, 1);
    assert.deepEqual(summary.reasonCounts, { decision_cutoff_missing_or_invalid: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("limit+1 detects truncation deterministically", () => {
  const dir = mkdtempSync(join(tmpdir(), "n2-pit-reader-"));
  try {
    const primary = join(dir, "boat.sqlite");
    const sidecar = join(dir, "research-replay.sqlite");
    createPrimary(primary);
    createSidecar(sidecar, 3);
    const result = readN2PitAuditObservations({ primaryDbPath: primary, sidecarDbPath: sidecar, limit: 2 });
    assert.equal(result.returnedObservationCount, 2);
    assert.equal(result.truncated, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reader rejects unbounded or invalid limits", () => {
  assert.throws(() => readN2PitAuditObservations({
    primaryDbPath: "missing", sidecarDbPath: "missing", limit: 0,
  }), /N2_PIT_AUDIT_INVALID_LIMIT/);
  assert.throws(() => readN2PitAuditObservations({
    primaryDbPath: "missing", sidecarDbPath: "missing", limit: 100_001,
  }), /N2_PIT_AUDIT_INVALID_LIMIT/);
});
