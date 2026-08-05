import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runN2ObservationIngestReadinessExecutor } from "./n2ObservationIngestReadinessExecutor";
import type { ExecutorContext } from "./taskExecutors";

function createPrimary(path: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE official_programs (
        race_id TEXT PRIMARY KEY, date TEXT NOT NULL, venue TEXT NOT NULL,
        race_no INTEGER NOT NULL, close_at TEXT, source_file TEXT,
        raw_json TEXT, imported_at TEXT
      );
      CREATE TABLE odds_timeseries_snapshots (
        race_id TEXT NOT NULL, bet_type TEXT NOT NULL, bet_selection TEXT NOT NULL,
        odds REAL NOT NULL, captured_at TEXT NOT NULL, checkpoint_label TEXT
      );
    `);
    db.prepare("INSERT INTO official_programs VALUES(?,?,?,?,?,?,?,?)").run(
      "20260805-01-01", "2026-08-05", "01", 1, "10:00",
      "program.json", JSON.stringify({ race: 1 }), "2026-08-05T00:00:00.000Z",
    );
    db.prepare("INSERT INTO odds_timeseries_snapshots VALUES(?,?,?,?,?,?)").run(
      "20260805-01-01", "trifecta", "123", 10, "2026-08-05T00:30:00.000Z", "T-30",
    );
  } finally {
    db.close();
  }
}

function createSidecar(path: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE domain_observations (observation_id TEXT PRIMARY KEY, observation_type TEXT NOT NULL);
      CREATE TABLE capture_attempts (capture_attempt_id TEXT PRIMARY KEY);
      CREATE TABLE shadow_outbox_messages (outbox_message_id TEXT PRIMARY KEY);
      CREATE TABLE shadow_delivery_attempts (delivery_attempt_id TEXT PRIMARY KEY);
      CREATE TABLE rollout_config_events (
        shadow_write_enabled INTEGER NOT NULL, operational_gc_enabled INTEGER NOT NULL,
        kill_switch_engaged INTEGER NOT NULL, occurred_at TEXT NOT NULL
      );
      CREATE TABLE rollout_approval_grants_v2 (approval_scope TEXT NOT NULL);
    `);
    db.prepare("INSERT INTO rollout_config_events VALUES(?,?,?,?)").run(0, 0, 0, "2026-08-05T00:00:00.000Z");
  } finally {
    db.close();
  }
}

function setup(): { root: string; context: ExecutorContext } {
  const root = mkdtempSync(join(tmpdir(), "n2-readiness-executor-"));
  const data = join(root, "data");
  mkdirSync(data, { recursive: true });
  createPrimary(join(data, "boat.sqlite"));
  createSidecar(join(data, "research-replay.sqlite"));
  return {
    root,
    context: {
      repoRoot: root,
      runId: "run-readiness-1",
      requestId: "REQ-readiness-1",
      taskId: "TASK-N2-012",
      sidecarPath: join(data, "research-replay.sqlite"),
      historyDir: join(root, "reports/automation/history"),
      reportsDir: join(root, "reports/n2"),
      dryRun: false,
      taskStatuses: { "TASK-N2-010": "PASS" },
    },
  };
}

test("readiness task PASS persists an explicit blocked-for-write report", () => {
  const fixture = setup();
  try {
    const result = runN2ObservationIngestReadinessExecutor(fixture.context);
    assert.equal(result.result, "PASS", result.blocks.join("; "));
    assert.deepEqual(result.outputs, ["reports/n2/n2-observation-ingest-readiness.json"]);
    const path = join(fixture.root, result.outputs[0]);
    assert.equal(existsSync(path), true);
    const report = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
    assert.equal(report.overallStatus, "BLOCKED_NOT_READY_FOR_WRITE");
    assert.equal(report.writeAuthorized, false);
    assert.equal(report.autoEnableShadowWrite, false);
    assert.equal(report.officialProgram.status, "BLOCKED_NOT_READY");
    assert.equal(report.trifectaMarket.status, "BLOCKED_NOT_READY");
    assert.equal(report.readOnly, true);
    assert.equal(report.queryOnly, true);
    assert.equal(report.primaryDbWriteCount, 0);
    assert.equal(report.sidecarWriteCount, 0);
    assert.equal(report.productionApplyExecuted, false);
    assert.equal(report.pitEvidence.status, "NOT_APPLICABLE");
    assert.equal(report.pitEvidence.sameRaceViolationCount, 0);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("N2-010 dependency and active WAL block fail-closed", () => {
  const dependency = setup();
  try {
    dependency.context.taskStatuses["TASK-N2-010"] = "CONDITIONAL";
    const result = runN2ObservationIngestReadinessExecutor(dependency.context);
    assert.equal(result.result, "BLOCKED");
    assert.match(result.blocks.join("\n"), /DEPENDENCY_NOT_SATISFIED/);
  } finally {
    rmSync(dependency.root, { recursive: true, force: true });
  }

  const walFixture = setup();
  try {
    const wal = `${walFixture.context.sidecarPath}-wal`;
    writeFileSync(wal, "active");
    const result = runN2ObservationIngestReadinessExecutor(walFixture.context);
    assert.equal(result.result, "BLOCKED");
    assert.match(result.blocks.join("\n"), /SIDECAR_ACTIVE_WAL/);
    assert.equal(readFileSync(wal, "utf8"), "active");
  } finally {
    rmSync(walFixture.root, { recursive: true, force: true });
  }
});

test("dry-run performs no report write", () => {
  const fixture = setup();
  try {
    fixture.context.dryRun = true;
    const result = runN2ObservationIngestReadinessExecutor(fixture.context);
    assert.equal(result.result, "DRY_RUN_OK");
    assert.deepEqual(result.outputs, []);
    assert.equal(existsSync(join(fixture.root, "reports/n2/n2-observation-ingest-readiness.json")), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
