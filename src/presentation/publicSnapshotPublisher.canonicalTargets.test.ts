import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import fixture from "./fixtures/public-dashboard-snapshot-v1.json";
import type { PublicDashboardSnapshot } from "./publicSnapshot";
import { sealPublicDashboardSnapshot } from "./publicSnapshotTransport";

test("publisher rejects targets that alias through a symlinked parent directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-canonical-targets-"));
  try {
    const realDir = join(root, "real");
    const aliasDir = join(root, "alias");
    await mkdir(realDir, { recursive: true });
    await symlink(realDir, aliasDir, "dir");

    const candidatePath = join(root, "candidate.json");
    const latestPath = join(realDir, "snapshot.json");
    const lastKnownGoodPath = join(aliasDir, "snapshot.json");

    const snapshot = structuredClone(fixture) as PublicDashboardSnapshot;
    snapshot.generatedAt = "2026-08-11T00:00:00.000Z";
    snapshot.dataAsOf = "2026-08-11T00:00:00.000Z";
    snapshot.status.lastRunAt = "2026-08-11T00:00:00.000Z";
    snapshot.integrity.digest = "0".repeat(64);
    const candidate = await sealPublicDashboardSnapshot(snapshot);
    const previousBody = "previous-publication\n";

    await writeFile(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
    await writeFile(latestPath, previousBody, "utf8");

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

    assert.notEqual(published.status, 0, `${published.stdout}\n${published.stderr}`);
    assert.match(published.stderr, /latest and last-known-good targets must be distinct/);
    assert.equal(await readFile(latestPath, "utf8"), previousBody);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
