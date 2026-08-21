import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RawStore } from "./rawStore";
import { initializeSidecarSchema, openSidecarDatabase } from "./schema";
import {
  BackfillCheckpointRepository,
  initializeN1BackfillSchema,
  initializeN1SettlementSchema,
  N1_SETTLEMENT_PARSER_VERSION,
} from "./settlement";
import {
  completedBackfillCountForParser,
  latestBackfillCheckpointForParser,
  runBackfill,
} from "./n1Backfill";

const NOW = "2026-08-21T08:00:00.000Z";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "n1-backfill-parser-checkpoint-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  initializeSidecarSchema(db, NOW);
  initializeN1SettlementSchema(db, NOW);
  initializeN1BackfillSchema(db, NOW);
  return { root, db };
}

function checkpointBase(parserVersion: string) {
  return {
    sourceArchiveSha256: "a".repeat(64),
    parserVersion,
    sourceSchemaFamily: "official_archive",
    firstRaceKey: null,
    lastRaceKey: null,
    expectedRaceCount: 0,
    parsedRaceCount: 0,
    candidateCount: 0,
    payoutLineCount: 0,
    refundLineCount: 0,
    transactionBatchSize: 1000,
    resumeToken: null,
    retryCount: 0,
    failureReason: null,
    completedAt: NOW,
  };
}

test("backfill completion is scoped to the current parser lineage", () => {
  const { db } = setup();
  let seq = 0;
  const checkpoints = new BackfillCheckpointRepository(db, () => `cp-${++seq}`);

  checkpoints.record({
    ...checkpointBase("n1-settlement-parser-v1"),
    archiveFile: "k260101.lzh",
    state: "completed",
    createdAt: "2026-08-21T07:00:00.000Z",
  });

  assert.equal(latestBackfillCheckpointForParser({ db, archiveFile: "k260101.lzh" }), null);
  assert.equal(completedBackfillCountForParser({ db }), 0);

  checkpoints.record({
    ...checkpointBase(N1_SETTLEMENT_PARSER_VERSION),
    archiveFile: "k260101.lzh",
    state: "completed",
    createdAt: "2026-08-21T07:10:00.000Z",
  });
  checkpoints.record({
    ...checkpointBase("n1-settlement-parser-v1"),
    archiveFile: "k260101.lzh",
    state: "failed",
    failureReason: "stale-parser-retry",
    completedAt: null,
    createdAt: "2026-08-21T07:20:00.000Z",
  });

  assert.equal(latestBackfillCheckpointForParser({ db, archiveFile: "k260101.lzh" })?.state, "completed");
  assert.equal(completedBackfillCountForParser({ db }), 1);

  checkpoints.record({
    ...checkpointBase(N1_SETTLEMENT_PARSER_VERSION),
    archiveFile: "k260101.lzh",
    state: "failed",
    failureReason: "current-parser-retry",
    completedAt: null,
    createdAt: "2026-08-21T07:30:00.000Z",
  });

  assert.equal(latestBackfillCheckpointForParser({ db, archiveFile: "k260101.lzh" })?.state, "failed");
  assert.equal(completedBackfillCountForParser({ db }), 0);
  db.close();
});

test("runBackfill does not skip a stale-parser completed checkpoint", async () => {
  const { root, db } = setup();
  const checkpoints = new BackfillCheckpointRepository(db, () => "stale-cp");
  checkpoints.record({
    ...checkpointBase("n1-settlement-parser-v1"),
    archiveFile: "k260102.lzh",
    state: "completed",
    createdAt: "2026-08-21T07:00:00.000Z",
  });

  const summary = await runBackfill({
    db,
    rawStore: new RawStore(join(root, "raw")),
    archiveFiles: [join(root, "k260102.lzh")],
    now: NOW,
    limit: 1,
  });

  assert.equal(summary.skippedCompleted, 0);
  assert.equal(summary.failedFiles, 1);
  assert.equal(summary.checkpointsRecorded, 1);
  assert.equal(summary.startCompletedTotal, 0);
  assert.equal(summary.endCompletedTotal, 0);
  db.close();
});
