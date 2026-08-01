import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { buildN2FeatureCoverageProfile } from "./n2FeatureCoverage";
import { readOfficialProgramCoverageEvents } from "./n2FeatureCoverageReader";

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

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function createFixture(): { dir: string; primaryPath: string; sidecarPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "n2-feature-coverage-reader-"));
  const primaryPath = join(dir, "primary.sqlite");
  const sidecarPath = join(dir, "sidecar.sqlite");
  const primary = new DatabaseSync(primaryPath);
  primary.exec(`
    CREATE TABLE official_programs (
      race_id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      venue TEXT NOT NULL,
      race_no INTEGER NOT NULL,
      source_file TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      imported_at TEXT NOT NULL
    );
  `);
  const insertProgram = primary.prepare(`
    INSERT INTO official_programs
      (race_id, date, venue, race_no, source_file, raw_json, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertProgram.run("20040101-01-01", "2004-01-01", "01", 1, "program-2004.txt", programRaw(), "2004-01-01T01:04:00Z");
  insertProgram.run("20260520-01-01", "2026-05-20", "01", 1, "program-2026.txt", programRaw(), "2026-05-20T01:04:00Z");
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
      raw_document_id TEXT NOT NULL,
      parse_run_id TEXT NOT NULL,
      source_published_at TEXT,
      source_observed_at TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      timing_quality TEXT NOT NULL,
      source_quality TEXT NOT NULL
    );
  `);
  sidecar.prepare("INSERT INTO raw_documents VALUES (?, ?, ?, ?)")
    .run("raw-program-2004", "verified", "passed", 1);
  sidecar.prepare("INSERT INTO parse_runs VALUES (?, ?, ?)")
    .run("parse-program-2004", "raw-program-2004", "success");
  sidecar.prepare(`INSERT INTO domain_observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "obs-program-2004", "2004-01-01:01:R1", "official_program", "raw-program-2004", "parse-program-2004",
    "2004-01-01T01:00:00Z", "2004-01-01T01:02:00Z", "2004-01-01T01:03:00Z", "source_exact", "official_public",
  );
  sidecar.close();
  return { dir, primaryPath, sidecarPath };
}

test("immutable dual-DB reader produces verified and explicit excluded year buckets", () => {
  const fixture = createFixture();
  try {
    const beforePrimary = sha256(fixture.primaryPath);
    const beforeSidecar = sha256(fixture.sidecarPath);
    const events = readOfficialProgramCoverageEvents({
      primaryDbPath: fixture.primaryPath,
      sidecarDbPath: fixture.sidecarPath,
      dateFrom: "2004-01-01",
      dateTo: "2026-12-31",
    });
    assert.equal(events.length, 84);
    assert.equal(events.filter((event) => event.status === "verified").length, 42);
    assert.equal(events.filter((event) => event.exclusionReason === "excluded_lineage_not_found").length, 42);

    const profile = buildN2FeatureCoverageProfile({ inputKind: "real", events });
    assert.equal(profile.dataStatus, "REAL_DATA");
    assert.equal(profile.totalRaces, 2);
    assert.deepEqual(profile.byYear.map((bucket) => ({
      year: bucket.key,
      expected: bucket.expected,
      verified: bucket.verified,
      coveragePct: bucket.coveragePct,
    })), [
      { year: "2004", expected: 42, verified: 42, coveragePct: 100 },
      { year: "2026", expected: 42, verified: 0, coveragePct: 0 },
    ]);
    assert.equal(sha256(fixture.primaryPath), beforePrimary);
    assert.equal(sha256(fixture.sidecarPath), beforeSidecar);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("multiple official_program evidence rows fail closed as ambiguous", () => {
  const fixture = createFixture();
  try {
    const sidecar = new DatabaseSync(fixture.sidecarPath);
    sidecar.prepare("INSERT INTO raw_documents VALUES (?, ?, ?, ?)")
      .run("raw-program-2004-b", "verified", "passed", 1);
    sidecar.prepare("INSERT INTO parse_runs VALUES (?, ?, ?)")
      .run("parse-program-2004-b", "raw-program-2004-b", "success");
    sidecar.prepare(`INSERT INTO domain_observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      "obs-program-2004-b", "2004-01-01:01:R1", "official_program", "raw-program-2004-b", "parse-program-2004-b",
      "2004-01-01T01:00:00Z", "2004-01-01T01:02:00Z", "2004-01-01T01:03:00Z", "source_exact", "official_public",
    );
    sidecar.close();
    const events = readOfficialProgramCoverageEvents({
      primaryDbPath: fixture.primaryPath,
      sidecarDbPath: fixture.sidecarPath,
      dateFrom: "2004-01-01",
      dateTo: "2004-01-01",
    });
    assert.equal(events.length, 42);
    assert.ok(events.every((event) => event.exclusionReason === "excluded_lineage_ambiguous_match"));
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("primary race identity mismatch is rejected instead of inferred", () => {
  const fixture = createFixture();
  try {
    const primary = new DatabaseSync(fixture.primaryPath);
    primary.exec("UPDATE official_programs SET race_id = '20040101-1-01' WHERE date = '2004-01-01'");
    primary.close();
    assert.throws(() => readOfficialProgramCoverageEvents({
      primaryDbPath: fixture.primaryPath,
      sidecarDbPath: fixture.sidecarPath,
      dateFrom: "2004-01-01",
      dateTo: "2004-01-01",
    }), /N2_COVERAGE_PROGRAM_RACE_ID_MISMATCH/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});
