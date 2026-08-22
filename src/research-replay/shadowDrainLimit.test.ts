import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { RolloutController } from "./rollout";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

function context() {
  const root = mkdtempSync(join(tmpdir(), "shadow-drain-limit-"));
  const db = openRolloutDatabase(join(root, "sidecar.sqlite"));
  initializeRolloutSchema(db, "2026-08-02T04:00:00.000Z");
  const rawStore = new RawStore(join(root, "raw"));
  let sequence = 0;
  const repository = new ResearchReplayRepository(
    db,
    rawStore,
    () => `limit-${++sequence}`,
    () => "2026-08-02T04:00:00.000Z",
  );
  const controller = new RolloutController(
    db,
    repository,
    rawStore,
    () => `limit-${++sequence}`,
    () => "2026-08-02T04:00:00.000Z",
    () => Number.MAX_SAFE_INTEGER,
  );
  return {
    controller,
    close() {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("shadow drain rejects invalid bounds before selection", () => {
  const ctx = context();
  try {
    for (const limit of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(
        () => ctx.controller.drainWithDiagnostics(() => undefined, limit),
        /invalid shadow drain limit/,
      );
    }
  } finally {
    ctx.close();
  }
});

test("shadow drain keeps zero as an explicit zero-item bound", () => {
  const ctx = context();
  try {
    assert.deepEqual(ctx.controller.drainWithDiagnostics(() => undefined, 0), {
      succeeded: 0,
      retrying: 0,
      permanentlyFailed: 0,
      examined: 0,
      contended: 0,
      skippedAfterClaim: 0,
      handlerDeadlineExceeded: 0,
    });
  } finally {
    ctx.close();
  }
});
