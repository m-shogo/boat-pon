import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import fixture from "./fixtures/public-dashboard-snapshot-v1.json";
import type { PublicDashboardSnapshot } from "./publicSnapshot";
import { sealPublicDashboardSnapshot } from "./publicSnapshotTransport";

test("publisher blocks malformed candidate JSON without replacing published snapshots", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-malformed-candidate-"));
  try {
    const candidatePath = join(root, "candidate.json");
    const latestPath = join(root, "latest.json");
    const lastKnownGoodPath = join(root, "last-known-good.json");

    const snapshot = structuredClone(fixture) as PublicDashboardSnapshot;
    snapshot.generatedAt = "2026-08-11T00:00:00.000Z";
    snapshot.dataAsOf = "2026-08-11T00:00:00.000Z";
    snapshot.status.lastRunAt = "2026-08-11T00:00:00.000Z";
    snapshot.integrity.digest = "0".repeat(64);
    const publishedSnapshot = await sealPublicDashboardSnapshot(snapshot);
    const publishedBody = `${JSON.stringify(publishedSnapshot, null, 2)}\n`;

    await writeFile(candidatePath, "{ malformed", "utf8");
    await writeFile(latestPath, publishedBody, "utf8");
    await writeFile(lastKnownGoodPath, publishedBody, "utf8");

    const published = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "scripts/publish-public-dashboard-snapshot.ts",
      "--candidate",
      candidatePath,
      "--latest",
      latestPath,
      "--last-known-good",
      lastKnownGoodPath,
      "--now",
      "2026-08-11T00:01:00.000Z",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    assert.equal(published.status, 1, `${published.stdout}\n${published.stderr}`);
    assert.match(published.stderr, /PUBLIC_SNAPSHOT_PUBLICATION_BLOCKED CANDIDATE_INVALID_OR_UNVERIFIED/);
    assert.equal(await readFile(latestPath, "utf8"), publishedBody);
    assert.equal(await readFile(lastKnownGoodPath, "utf8"), publishedBody);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
