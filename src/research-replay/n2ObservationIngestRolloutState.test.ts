import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { readCanonicalRolloutState } from "./n2ObservationIngestRolloutState";

function createRolloutTable(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE rollout_config_events (
      shadow_write_enabled INTEGER NOT NULL,
      operational_gc_enabled INTEGER NOT NULL,
      kill_switch_engaged INTEGER NOT NULL,
      occurred_at TEXT NOT NULL
    )
  `);
  return db;
}

test("readiness rollout state uses the latest canonical event", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-readiness-rollout-latest-"));
  const path = join(root, "research-replay.sqlite");
  const db = createRolloutTable(path);
  try {
    db.prepare("INSERT INTO rollout_config_events VALUES(0, 0, 1, ?)").run("2026-08-20T09:00:00.000Z");
    db.prepare("INSERT INTO rollout_config_events VALUES(1, 1, 0, ?)").run("2026-08-20T10:00:00.000Z");
    db.close();

    assert.deepEqual(readCanonicalRolloutState(path), {
      shadowWriteEnabled: true,
      operationalGcEnabled: true,
      killSwitchEngaged: false,
    });
  } finally {
    try { db.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test("non-canonical rollout timestamps fail closed before latest-state selection", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-readiness-rollout-time-"));
  const path = join(root, "research-replay.sqlite");
  const db = createRolloutTable(path);
  try {
    db.prepare("INSERT INTO rollout_config_events VALUES(0, 0, 1, ?)").run("2026-08-20T10:00:00.000Z");
    db.prepare("INSERT INTO rollout_config_events VALUES(1, 1, 0, ?)").run("2026-08-20T24:00:00.000Z");
    db.close();

    assert.throws(
      () => readCanonicalRolloutState(path),
      /N2_READINESS_ROLLOUT_TIMESTAMP_INVALID/,
    );
  } finally {
    try { db.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid historical rollout flags fail closed before latest-state selection", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-readiness-rollout-flags-"));
  const path = join(root, "research-replay.sqlite");
  const db = createRolloutTable(path);
  try {
    db.prepare("INSERT INTO rollout_config_events VALUES(2, 0, 0, ?)").run("2026-08-20T09:00:00.000Z");
    db.prepare("INSERT INTO rollout_config_events VALUES(0, 0, 0, ?)").run("2026-08-20T10:00:00.000Z");
    db.close();

    assert.throws(
      () => readCanonicalRolloutState(path),
      /N2_READINESS_ROLLOUT_FLAG_INVALID/,
    );
  } finally {
    try { db.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test("incomplete rollout schema fails closed", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-readiness-rollout-schema-"));
  const path = join(root, "research-replay.sqlite");
  const db = new DatabaseSync(path);
  try {
    db.exec("CREATE TABLE rollout_config_events (shadow_write_enabled INTEGER NOT NULL)");
    db.close();
    assert.throws(() => readCanonicalRolloutState(path), /N2_READINESS_ROLLOUT_SCHEMA_INVALID/);
  } finally {
    try { db.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing rollout table keeps the existing safe disabled defaults", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-readiness-rollout-empty-"));
  const path = join(root, "research-replay.sqlite");
  const db = new DatabaseSync(path);
  db.close();
  try {
    assert.deepEqual(readCanonicalRolloutState(path), {
      shadowWriteEnabled: false,
      operationalGcEnabled: false,
      killSwitchEngaged: false,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
