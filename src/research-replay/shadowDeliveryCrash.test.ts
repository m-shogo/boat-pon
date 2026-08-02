import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { DEFAULT_ROLLOUT_CONFIG, RolloutController } from "./rollout";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

const CRASH_WORKER = "BOAT_PON_SHADOW_CRASH_WORKER";
const FIXED_NOW = "2026-08-02T02:00:00.000Z";

function forwardedTypeScriptLoaderArgs(): string[] {
  const args: string[] = [];
  for (let index = 0; index < process.execArgv.length; index += 1) {
    const arg = process.execArgv[index];
    if (arg === "--import" || arg === "--loader") {
      args.push(arg, process.execArgv[index + 1]);
      index += 1;
    } else if (arg.startsWith("--import=") || arg.startsWith("--loader=")) {
      args.push(arg);
    }
  }
  return args;
}

function runCrashWorker(): never {
  const dbPath = process.env.BOAT_PON_SHADOW_DB_PATH;
  const rawRoot = process.env.BOAT_PON_SHADOW_RAW_ROOT;
  if (!dbPath || !rawRoot) process.exit(78);
  const db = openRolloutDatabase(dbPath);
  const rawStore = new RawStore(rawRoot);
  let sequence = 0;
  const clock = () => FIXED_NOW;
  const repository = new ResearchReplayRepository(db, rawStore, () => `worker-${++sequence}`, clock);
  const controller = new RolloutController(
    db, repository, rawStore, () => `worker-${++sequence}`, clock, () => Number.MAX_SAFE_INTEGER,
  );
  controller.drain(() => {
    db.prepare(`
      INSERT INTO operational_audit_events
      (audit_event_id, operation_id, event_kind, subject_type, subject_id,
       detail_json, occurred_at, created_at)
      VALUES (?, ?, 'health_snapshot', 'fixture', 'crash', '{}', ?, ?)
    `).run("crash-audit", "crash-operation", FIXED_NOW, FIXED_NOW);
    process.exit(77);
  });
  process.exit(79);
}

if (process.env[CRASH_WORKER] === "1") {
  runCrashWorker();
} else {
  test("process crash rolls back delivery side effects and leaves the message replayable", () => {
    const dir = mkdtempSync(join(tmpdir(), "shadow-delivery-crash-"));
    const dbPath = join(dir, "sidecar.sqlite");
    const rawRoot = join(dir, "raw");
    try {
      const setupDb = openRolloutDatabase(dbPath);
      initializeRolloutSchema(setupDb, FIXED_NOW);
      let sequence = 0;
      const rawStore = new RawStore(rawRoot);
      const clock = () => FIXED_NOW;
      const repository = new ResearchReplayRepository(setupDb, rawStore, () => `setup-${++sequence}`, clock);
      const controller = new RolloutController(
        setupDb, repository, rawStore, () => `setup-${++sequence}`, clock, () => Number.MAX_SAFE_INTEGER,
      );
      controller.recordConfig({
        ...DEFAULT_ROLLOUT_CONFIG,
        shadowWriteEnabled: true,
        storageQuotaBytes: 1024 * 1024 * 1024,
        diskLowWaterBytes: 0,
      }, "subprocess crash rollback test");
      controller.enqueue({
        idempotencyKey: "crash-message-1",
        messageType: "fixture.crash.v1",
        payload: { value: 1 },
      });
      setupDb.close();

      const child = spawnSync(
        process.execPath,
        [...forwardedTypeScriptLoaderArgs(), process.argv[1]],
        {
          env: {
            ...process.env,
            [CRASH_WORKER]: "1",
            BOAT_PON_SHADOW_DB_PATH: dbPath,
            BOAT_PON_SHADOW_RAW_ROOT: rawRoot,
          },
          encoding: "utf8",
          timeout: 10_000,
        },
      );
      assert.equal(child.status, 77, `worker stderr: ${child.stderr}`);

      const replayDb = openRolloutDatabase(dbPath);
      const replayRawStore = new RawStore(rawRoot);
      const replayRepository = new ResearchReplayRepository(
        replayDb, replayRawStore, () => `replay-${++sequence}`, clock,
      );
      const replayController = new RolloutController(
        replayDb,
        replayRepository,
        replayRawStore,
        () => `replay-${++sequence}`,
        clock,
        () => Number.MAX_SAFE_INTEGER,
      );
      assert.equal((replayDb.prepare(
        "SELECT COUNT(*) n FROM shadow_delivery_attempts",
      ).get() as { n: number }).n, 0);
      assert.equal((replayDb.prepare(
        "SELECT COUNT(*) n FROM operational_audit_events WHERE operation_id='crash-operation'",
      ).get() as { n: number }).n, 0);
      assert.equal(replayController.health().queued, 1);
      assert.deepEqual(replayController.drain(() => undefined), {
        succeeded: 1,
        retrying: 0,
        permanentlyFailed: 0,
      });
      assert.equal((replayDb.prepare(
        "SELECT COUNT(*) n FROM shadow_delivery_attempts WHERE outcome='succeeded'",
      ).get() as { n: number }).n, 1);
      replayDb.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
