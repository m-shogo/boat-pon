import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { readN2ObservationIngestReadiness } from "./n2ObservationIngestReadinessReader";

function trifectaSelections(): string[] {
  const selections: string[] = [];
  for (let first = 1; first <= 6; first += 1) {
    for (let second = 1; second <= 6; second += 1) {
      if (second === first) continue;
      for (let third = 1; third <= 6; third += 1) {
        if (third === first || third === second) continue;
        selections.push(`${first}${second}${third}`);
      }
    }
  }
  return selections;
}

function createPrimary(path: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE official_programs (
        race_id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        venue TEXT NOT NULL,
        race_no INTEGER NOT NULL,
        close_at TEXT,
        source_file TEXT,
        raw_json TEXT,
        imported_at TEXT
      );
      CREATE TABLE odds_timeseries_snapshots (
        race_id TEXT NOT NULL,
        bet_type TEXT NOT NULL,
        bet_selection TEXT NOT NULL,
        odds REAL NOT NULL,
        captured_at TEXT NOT NULL,
        checkpoint_label TEXT,
        source TEXT
      );
    `);
    const program = db.prepare("INSERT INTO official_programs VALUES(?,?,?,?,?,?,?,?)");
    for (const [index, date] of ["2026-07-30", "2026-08-01", "2026-08-05"].entries()) {
      program.run(
        `${date.replaceAll("-", "")}-01-0${index + 1}`,
        date,
        "01",
        index + 1,
        `1${index}:00`,
        `program-${index}.json`,
        JSON.stringify({ race: index + 1 }),
        `${date}T00:00:00.000Z`,
      );
    }
    const odds = db.prepare("INSERT INTO odds_timeseries_snapshots VALUES(?,?,?,?,?,?,?)");
    for (const selection of trifectaSelections()) {
      odds.run("20260805-01-01", "trifecta", selection, 10.5, "2026-08-05T00:30:00.000Z", "T-30", "official");
    }
    // Incomplete snapshot must not count as a complete checkpoint.
    for (const selection of trifectaSelections().slice(0, 119)) {
      odds.run("20260805-01-02", "trifecta", selection, 11.5, "2026-08-05T00:31:00.000Z", "T-30", "official");
    }
  } finally {
    db.close();
  }
}

function createSidecar(path: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE domain_observations (
        observation_id TEXT PRIMARY KEY,
        observation_type TEXT NOT NULL
      );
      CREATE TABLE capture_attempts (capture_attempt_id TEXT PRIMARY KEY);
      CREATE TABLE shadow_outbox_messages (outbox_message_id TEXT PRIMARY KEY);
      CREATE TABLE shadow_delivery_attempts (delivery_attempt_id TEXT PRIMARY KEY);
      CREATE TABLE rollout_config_events (
        shadow_write_enabled INTEGER NOT NULL,
        operational_gc_enabled INTEGER NOT NULL,
        kill_switch_engaged INTEGER NOT NULL,
        occurred_at TEXT NOT NULL
      );
      CREATE TABLE rollout_approval_grants_v2 (
        approval_scope TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO domain_observations VALUES(?,?)").run("obs-settlement", "settlement_result");
    db.prepare("INSERT INTO rollout_config_events VALUES(?,?,?,?)")
      .run(0, 0, 0, "2026-08-05T00:00:00.000Z");
    db.prepare("INSERT INTO rollout_approval_grants_v2 VALUES(?)")
      .run("F0-R_START_AND_SIDECAR_ROLLOUT");
  } finally {
    db.close();
  }
}

function setup(): { root: string; primary: string; sidecar: string } {
  const root = mkdtempSync(join(tmpdir(), "n2-ingest-readiness-reader-"));
  const primary = join(root, "boat.sqlite");
  const sidecar = join(root, "research-replay.sqlite");
  createPrimary(primary);
  createSidecar(sidecar);
  return { root, primary, sidecar };
}

test("reader builds a deterministic latest seven-day readiness input", () => {
  const fixture = setup();
  try {
    const beforePrimary = new DatabaseSync(fixture.primary, { readOnly: true });
    const beforeSidecar = new DatabaseSync(fixture.sidecar, { readOnly: true });
    const primaryCount = Number((beforePrimary.prepare("SELECT COUNT(*) n FROM official_programs").get() as { n: number }).n);
    const sidecarCount = Number((beforeSidecar.prepare("SELECT COUNT(*) n FROM domain_observations").get() as { n: number }).n);
    beforePrimary.close();
    beforeSidecar.close();

    const result = readN2ObservationIngestReadiness({
      primaryDbPath: fixture.primary,
      sidecarDbPath: fixture.sidecar,
    });
    assert.deepEqual(result.input.cohort, { dateFrom: "2026-07-30", dateTo: "2026-08-05", dayCount: 7 });
    assert.equal(result.input.primaryOfficialProgram.totalRows, 3);
    assert.equal(result.input.primaryOfficialProgram.eligibleRows, 3);
    assert.equal(result.sourceIdentity.oddsSourceTable, "odds_timeseries_snapshots");
    assert.equal(result.input.primaryTrifectaMarket.totalRows, 239);
    assert.equal(result.input.primaryTrifectaMarket.raceCount, 2);
    assert.equal(result.input.primaryTrifectaMarket.completeSnapshotCount, 1);
    assert.equal(result.input.primaryTrifectaMarket.rawDocumentIdColumnPresent, false);
    assert.equal(result.input.primaryTrifectaMarket.rawPayloadColumnPresent, false);
    assert.equal(result.input.sidecar.officialProgramObservationCount, 0);
    assert.equal(result.input.sidecar.trifectaMarketObservationCount, 0);
    assert.equal(result.input.rollout.shadowWriteEnabled, false);
    assert.deepEqual(result.input.rollout.approvalScopes, ["F0-R_START_AND_SIDECAR_ROLLOUT"]);
    assert.equal(result.input.wiring.officialProgramCaptureImplemented, true);
    assert.equal(result.input.wiring.officialProgramProductionCallerConnected, false);
    assert.equal(result.input.wiring.trifectaMarketWriterImplemented, false);

    const afterPrimary = new DatabaseSync(fixture.primary, { readOnly: true });
    const afterSidecar = new DatabaseSync(fixture.sidecar, { readOnly: true });
    assert.equal(Number((afterPrimary.prepare("SELECT COUNT(*) n FROM official_programs").get() as { n: number }).n), primaryCount);
    assert.equal(Number((afterSidecar.prepare("SELECT COUNT(*) n FROM domain_observations").get() as { n: number }).n), sidecarCount);
    afterPrimary.close();
    afterSidecar.close();
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("active WAL blocks without checkpointing or deletion", () => {
  const fixture = setup();
  try {
    const wal = `${fixture.sidecar}-wal`;
    writeFileSync(wal, "active");
    assert.throws(
      () => readN2ObservationIngestReadiness({ primaryDbPath: fixture.primary, sidecarDbPath: fixture.sidecar }),
      /SIDECAR_ACTIVE_WAL/,
    );
    assert.equal(existsSync(wal), true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("missing official program table fails closed", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-ingest-readiness-missing-"));
  const primary = join(root, "boat.sqlite");
  const sidecar = join(root, "research-replay.sqlite");
  new DatabaseSync(primary).close();
  createSidecar(sidecar);
  try {
    assert.throws(
      () => readN2ObservationIngestReadiness({ primaryDbPath: primary, sidecarDbPath: sidecar }),
      /OFFICIAL_PROGRAMS_TABLE_MISSING/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
