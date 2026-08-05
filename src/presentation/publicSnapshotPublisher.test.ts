import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import fixture from "./fixtures/public-dashboard-snapshot-v1.json";
import type { PublicDashboardSnapshot } from "./publicSnapshot";
import { validatePublicSnapshotForPublication } from "./publicSnapshotPublisher";
import {
  sealPublicDashboardSnapshot,
  verifyPublicDashboardSnapshotIntegrity,
} from "./publicSnapshotTransport";

function snapshotAt(dataAsOf: string): PublicDashboardSnapshot {
  const snapshot = structuredClone(fixture) as PublicDashboardSnapshot;
  snapshot.generatedAt = dataAsOf;
  snapshot.dataAsOf = dataAsOf;
  snapshot.status.lastRunAt = dataAsOf;
  snapshot.status.snapshotFreshness = "FRESH";
  snapshot.integrity.digest = "0".repeat(64);
  return snapshot;
}

test("publication rejects rollback and future candidates", async () => {
  const older = await sealPublicDashboardSnapshot(snapshotAt("2026-08-05T05:00:00.000Z"));
  const newer = await sealPublicDashboardSnapshot(snapshotAt("2026-08-05T06:00:00.000Z"));

  const rollback = await validatePublicSnapshotForPublication({
    candidate: older,
    existingLastKnownGood: newer,
    nowMs: Date.parse("2026-08-05T06:01:00.000Z"),
  });
  assert.equal(rollback.ok, false);
  assert.deepEqual(rollback.errors, ["CANDIDATE_ROLLBACK_DATA_AS_OF"]);

  const future = await validatePublicSnapshotForPublication({
    candidate: newer,
    nowMs: Date.parse("2026-08-05T05:00:00.000Z"),
    maxFutureSkewMs: 5 * 60_000,
  });
  assert.equal(future.ok, false);
  assert.deepEqual(future.errors, ["CANDIDATE_GENERATED_AT_IN_FUTURE"]);
});

test("publisher writes latest and last-known-good, then preserves both on invalid input", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-lkg-"));
  try {
    const candidatePath = join(root, "candidate.json");
    const latestPath = join(root, "public-data", "latest.json");
    const lastKnownGoodPath = join(root, "public-data", "last-known-good.json");
    const candidate = await sealPublicDashboardSnapshot(snapshotAt("2026-08-05T05:15:00.000Z"));
    await writeFile(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");

    const published = runPublisher({
      candidatePath,
      latestPath,
      lastKnownGoodPath,
      now: "2026-08-05T05:16:00.000Z",
    });
    assert.equal(published.status, 0, `${published.stdout}\n${published.stderr}`);
    assert.doesNotMatch(published.stdout, new RegExp(root.replaceAll("\\", "\\\\")));

    const latestText = await readFile(latestPath, "utf8");
    const lastKnownGoodText = await readFile(lastKnownGoodPath, "utf8");
    assert.equal(latestText, lastKnownGoodText);
    const latest = JSON.parse(latestText) as unknown;
    const verified = await verifyPublicDashboardSnapshotIntegrity(latest);
    assert.equal(verified.ok, true, verified.errors.join("\n"));
    assert.equal(verified.snapshot?.integrity.digest, candidate.integrity.digest);

    const tampered = structuredClone(candidate);
    tampered.status.nextTask = "TASK-N2-999";
    await writeFile(candidatePath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
    const blocked = runPublisher({
      candidatePath,
      latestPath,
      lastKnownGoodPath,
      now: "2026-08-05T05:17:00.000Z",
    });
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /CANDIDATE_INVALID_OR_UNVERIFIED/);
    assert.equal(await readFile(latestPath, "utf8"), latestText);
    assert.equal(await readFile(lastKnownGoodPath, "utf8"), lastKnownGoodText);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function runPublisher(options: {
  candidatePath: string;
  latestPath: string;
  lastKnownGoodPath: string;
  now: string;
}) {
  return spawnSync(process.execPath, [
    "--import",
    "tsx",
    "scripts/publish-public-dashboard-snapshot.ts",
    "--candidate",
    options.candidatePath,
    "--latest",
    options.latestPath,
    "--last-known-good",
    options.lastKnownGoodPath,
    "--now",
    options.now,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}
