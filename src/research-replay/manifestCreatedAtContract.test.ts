import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildRaceAsOfManifest } from "./manifest";
import type { ResearchReplayRepository } from "./repository";
import { initializeSidecarSchema, openSidecarDatabase } from "./schema";

function withSidecar(run: (db: ReturnType<typeof openSidecarDatabase>) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-manifest-created-at-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  try {
    initializeSidecarSchema(db, "2026-07-24T00:00:00.000Z");
    run(db);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function build(db: ReturnType<typeof openSidecarDatabase>, createdAt: string) {
  let id = 0;
  return buildRaceAsOfManifest({
    db,
    repository: {} as ResearchReplayRepository,
    canonicalRaceKey: "2026-07-24:01:R1",
    asOfAt: "2026-07-24T06:15:00.000Z",
    purpose: "research_replay_strict_pre_race",
    gitCommitSha: "test-sha",
    sourceSnapshotId: "test-snapshot",
    createdAt,
    idFactory: () => `manifest-created-at-${++id}`,
  });
}

test("manifest persistence canonicalizes createdAt before immutable writes", () => {
  withSidecar((db) => {
    const result = build(db, "2026-07-24T09:00:00+09:00");
    assert.equal(result.persisted, true);

    const manifest = db.prepare("SELECT created_at FROM race_asof_manifests WHERE manifest_id=?").get(result.manifestId) as {
      created_at: string;
    };
    assert.equal(manifest.created_at, "2026-07-24T00:00:00.000Z");

    const expectationTimes = db.prepare(`
      SELECT DISTINCT created_at FROM race_asof_manifest_expectations WHERE manifest_id=? ORDER BY created_at
    `).all(result.manifestId) as Array<{ created_at: string }>;
    assert.deepEqual(expectationTimes, [{ created_at: "2026-07-24T00:00:00.000Z" }]);

    const policyTimes = db.prepare("SELECT DISTINCT created_at FROM asof_resolution_policies ORDER BY created_at").all() as Array<{
      created_at: string;
    }>;
    assert.deepEqual(policyTimes, [{ created_at: "2026-07-24T00:00:00.000Z" }]);
  });
});

test("manifest persistence rejects normalized or timezone-ambiguous createdAt before writes", () => {
  for (const createdAt of ["2026-07-24T24:00:00Z", "2026-02-30T00:00:00Z", "2026-07-24T00:00:00"]) {
    withSidecar((db) => {
      assert.throws(() => build(db, createdAt));
      const manifestCount = db.prepare("SELECT COUNT(*) count FROM race_asof_manifests").get() as { count: number };
      const policyCount = db.prepare("SELECT COUNT(*) count FROM asof_resolution_policies").get() as { count: number };
      assert.equal(manifestCount.count, 0, createdAt);
      assert.equal(policyCount.count, 0, createdAt);
    });
  }
});
