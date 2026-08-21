import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RawStore } from "./rawStore";
import { initializeSidecarSchema, openSidecarDatabase } from "./schema";
import { initializeN1BackfillSchema, initializeN1SettlementSchema } from "./settlement";
import { runBackfill } from "./n1Backfill";

const NOW = "2026-07-25T04:00:00.000Z";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "n1-backfill-bounds-test-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  db.exec("PRAGMA synchronous = OFF;");
  initializeSidecarSchema(db, NOW);
  initializeN1SettlementSchema(db, NOW);
  initializeN1BackfillSchema(db, NOW);
  return { root, db, rawStore: new RawStore(join(root, "raw")) };
}

test("backfill maxFiles=0 selects zero archives", async () => {
  const { db, rawStore } = setup();
  const summary = await runBackfill({
    db,
    rawStore,
    archiveFiles: ["/definitely-not-read/k260101.lzh"],
    now: NOW,
    maxFiles: 0,
  });
  assert.equal(summary.requestedFiles, 0);
  assert.equal(summary.processedFiles, 0);
  assert.equal(summary.failedFiles, 0);
  assert.equal(summary.checkpointsRecorded, 0);
  db.close();
});

test("backfill bounded inputs reject negative, fractional, and unsafe values before archive reads", async () => {
  const invalidCases = [
    { maxFiles: -1, pattern: /N1_BACKFILL_MAX_FILES_INVALID/ },
    { maxFiles: 1.5, pattern: /N1_BACKFILL_MAX_FILES_INVALID/ },
    { maxFiles: Number.MAX_SAFE_INTEGER + 1, pattern: /N1_BACKFILL_MAX_FILES_INVALID/ },
    { limit: -1, pattern: /N1_BACKFILL_LIMIT_INVALID/ },
    { limit: 1.5, pattern: /N1_BACKFILL_LIMIT_INVALID/ },
    { limit: Number.MAX_SAFE_INTEGER + 1, pattern: /N1_BACKFILL_LIMIT_INVALID/ },
  ];

  for (const invalid of invalidCases) {
    const { db, rawStore } = setup();
    await assert.rejects(
      runBackfill({
        db,
        rawStore,
        archiveFiles: ["/definitely-not-read/k260101.lzh"],
        now: NOW,
        ...invalid,
      }),
      invalid.pattern,
    );
    const checkpointCount = Number((db.prepare("SELECT COUNT(*) c FROM n1_settlement_backfill_checkpoints").get() as { c: number }).c);
    assert.equal(checkpointCount, 0);
    db.close();
  }
});

test("backfill safety guards reject invalid quota, disk floor, and primary monitor before archive reads", async () => {
  const invalidCases = [
    { quotaBytes: Number.NaN, pattern: /N1_BACKFILL_QUOTA_BYTES_INVALID/ },
    { quotaBytes: -1, pattern: /N1_BACKFILL_QUOTA_BYTES_INVALID/ },
    { quotaBytes: 1.5, pattern: /N1_BACKFILL_QUOTA_BYTES_INVALID/ },
    { diskFloorBytes: Number.NaN, pattern: /N1_BACKFILL_DISK_FLOOR_BYTES_INVALID/ },
    { diskFloorBytes: -1, pattern: /N1_BACKFILL_DISK_FLOOR_BYTES_INVALID/ },
    { diskFloorBytes: 1.5, pattern: /N1_BACKFILL_DISK_FLOOR_BYTES_INVALID/ },
    { primaryMonitor: "disabled" as never, pattern: /N1_BACKFILL_PRIMARY_MONITOR_INVALID/ },
  ];

  for (const invalid of invalidCases) {
    const { db, rawStore } = setup();
    await assert.rejects(
      runBackfill({
        db,
        rawStore,
        archiveFiles: ["/definitely-not-read/k260101.lzh"],
        now: NOW,
        ...invalid,
      }),
      invalid.pattern,
    );
    const checkpointCount = Number((db.prepare("SELECT COUNT(*) c FROM n1_settlement_backfill_checkpoints").get() as { c: number }).c);
    assert.equal(checkpointCount, 0);
    db.close();
  }
});

test("backfill primary monitor requires its runtime authority before archive reads", async () => {
  const invalidCases = [
    {
      primaryPath: "/definitely-not-read/boat.sqlite",
      primaryMonitor: "strict" as const,
      pattern: /N1_BACKFILL_PRIMARY_FINGERPRINT_REQUIRED/,
    },
    {
      primaryPath: "/definitely-not-read/boat.sqlite",
      primaryMonitor: "structural" as const,
      pattern: /N1_BACKFILL_PRIMARY_STRUCTURAL_MONITOR_REQUIRED/,
    },
    {
      primaryPath: "/definitely-not-read/boat.sqlite",
      primaryMonitor: "structural" as const,
      primaryStructuralBaseline: { schemaHash: "schema", appSettingsHash: "settings" },
      pattern: /N1_BACKFILL_PRIMARY_STRUCTURAL_MONITOR_REQUIRED/,
    },
  ];

  for (const invalid of invalidCases) {
    const { db, rawStore } = setup();
    await assert.rejects(
      runBackfill({
        db,
        rawStore,
        archiveFiles: ["/definitely-not-read/k260101.lzh"],
        now: NOW,
        ...invalid,
      }),
      invalid.pattern,
    );
    const checkpointCount = Number((db.prepare("SELECT COUNT(*) c FROM n1_settlement_backfill_checkpoints").get() as { c: number }).c);
    assert.equal(checkpointCount, 0);
    db.close();
  }
});

test("backfill total archive count cannot understate projection authority", async () => {
  const invalidCases = [Number.NaN, -1, 1.5, 1, Number.MAX_SAFE_INTEGER + 1];
  for (const totalArchiveCount of invalidCases) {
    const { db, rawStore } = setup();
    await assert.rejects(
      runBackfill({
        db,
        rawStore,
        archiveFiles: [
          "/definitely-not-read/k260101.lzh",
          "/definitely-not-read/k260102.lzh",
        ],
        now: NOW,
        totalArchiveCount,
      }),
      /N1_BACKFILL_TOTAL_ARCHIVE_COUNT_INVALID/,
    );
    const checkpointCount = Number((db.prepare("SELECT COUNT(*) c FROM n1_settlement_backfill_checkpoints").get() as { c: number }).c);
    assert.equal(checkpointCount, 0);
    db.close();
  }
});

test("backfill limit bounds failed archive attempts as well as completed files", async () => {
  const { db, rawStore } = setup();
  const summary = await runBackfill({
    db,
    rawStore,
    archiveFiles: [
      "/definitely-not-read/k260101.lzh",
      "/definitely-not-read/k260102.lzh",
    ],
    now: NOW,
    limit: 1,
  });

  assert.equal(summary.processedFiles, 0);
  assert.equal(summary.failedFiles, 1);
  assert.equal(summary.checkpointsRecorded, 1);
  assert.equal(summary.fileResults.length, 1);
  assert.equal(summary.fileResults[0]?.archiveFile, "k260101.lzh");
  const checkpoints = db.prepare("SELECT archive_file AS archiveFile FROM n1_settlement_backfill_checkpoints ORDER BY rowid").all() as Array<{ archiveFile: string }>;
  assert.deepEqual(checkpoints.map((row) => row.archiveFile), ["k260101.lzh"]);
  db.close();
});
