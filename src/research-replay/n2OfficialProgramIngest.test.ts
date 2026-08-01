import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readOfficialProgramCoverageEvents } from "./n2FeatureCoverageReader";
import { ingestOfficialProgramObservation } from "./n2OfficialProgramObservation";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { initializeSidecarSchema, openSidecarDatabase } from "./schema";

const canonicalRaceKey = "2004-01-01:01:R1";
const observedAt = "2004-01-01T01:02:00Z";

function programRaw(): string {
  return JSON.stringify({
    boats: Array.from({ length: 6 }, (_, index) => ({
      course: index + 1,
      registrationNo: String(4000 + index),
      className: index === 0 ? "A1" : "B1",
      nationalWinRate: 6.1 + index / 10,
      nationalTop2Rate: 40 + index,
      localWinRate: 5.1 + index / 10,
      localTop2Rate: 35 + index,
      motorTop2Rate: 30 + index,
      boatTop2Rate: 28 + index,
    })),
  });
}

function createPrimary(path: string, rawJson: string): void {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE official_programs (
      race_id TEXT PRIMARY KEY, date TEXT NOT NULL, venue TEXT NOT NULL,
      race_no INTEGER NOT NULL, source_file TEXT NOT NULL,
      raw_json TEXT NOT NULL, imported_at TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO official_programs VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "20040101-01-01", "2004-01-01", "01", 1, "program-2004.txt", rawJson, "2004-01-01T01:04:00Z",
  );
  db.close();
}

test("exact primary raw bytes survive F0 ingest and produce verified coverage", () => {
  const dir = mkdtempSync(join(tmpdir(), "n2-program-ingest-"));
  const primaryPath = join(dir, "primary.sqlite");
  const sidecarPath = join(dir, "sidecar.sqlite");
  const rawRoot = join(dir, "raw");
  const rawJson = programRaw();
  try {
    createPrimary(primaryPath, rawJson);
    const db = openSidecarDatabase(sidecarPath);
    initializeSidecarSchema(db, "2004-01-01T01:05:00Z");
    const repository = new ResearchReplayRepository(db, new RawStore(rawRoot), undefined, () => "2004-01-01T01:05:00Z");
    const result = ingestOfficialProgramObservation({
      repository,
      rawJson,
      canonicalRaceKey,
      sourcePublishedAt: "2004-01-01T01:00:00Z",
      sourceObservedAt: observedAt,
      firstSeenAt: "2004-01-01T01:03:00Z",
      rawDocumentId: "raw-program",
      parseRunId: "parse-program",
      observationId: "obs-program",
    });
    assert.equal(result.parse.status, "success");
    assert.equal(result.parse.observationId, "obs-program");
    assert.equal(readFileSync(join(rawRoot, result.relativePath), "utf8"), rawJson);
    assert.deepEqual(repository.loadTypedPayload("obs-program").type, "official_program");
    db.close();

    const events = readOfficialProgramCoverageEvents({
      primaryDbPath: primaryPath,
      sidecarDbPath: sidecarPath,
      dateFrom: "2004-01-01",
      dateTo: "2004-01-01",
    });
    assert.equal(events.length, 42);
    assert.ok(events.every((event) => event.status === "verified"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid official raw records an error parse run without partial observation", () => {
  const dir = mkdtempSync(join(tmpdir(), "n2-program-ingest-error-"));
  try {
    const db = openSidecarDatabase(join(dir, "sidecar.sqlite"));
    initializeSidecarSchema(db, "2004-01-01T01:05:00Z");
    const repository = new ResearchReplayRepository(db, new RawStore(join(dir, "raw")), undefined, () => "2004-01-01T01:05:00Z");
    const result = ingestOfficialProgramObservation({
      repository,
      rawJson: "{invalid-json",
      canonicalRaceKey,
      sourcePublishedAt: null,
      sourceObservedAt: observedAt,
      firstSeenAt: "2004-01-01T01:03:00Z",
      rawDocumentId: "raw-invalid",
      parseRunId: "parse-invalid",
      observationId: "obs-must-not-exist",
    });
    assert.equal(result.parse.status, "error");
    assert.equal(result.parse.errorCode, "PARSE_OR_VALIDATION_ERROR");
    assert.equal(result.parse.observationId, null);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM parse_runs").get() as { n: number }).n, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM domain_observations").get() as { n: number }).n, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM typed_observation_payloads").get() as { n: number }).n, 0);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
