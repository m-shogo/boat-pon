import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import fixture from "./fixtures/public-dashboard-snapshot-v1.json";
import type { PublicDashboardSnapshot } from "./publicSnapshot";
import { sealPublicDashboardSnapshot } from "./publicSnapshotTransport";

async function sealedSnapshot(at: string): Promise<PublicDashboardSnapshot> {
  const snapshot = structuredClone(fixture) as PublicDashboardSnapshot;
  snapshot.generatedAt = at;
  snapshot.dataAsOf = at;
  snapshot.status.lastRunAt = at;
  snapshot.integrity.digest = "0".repeat(64);
  return sealPublicDashboardSnapshot(snapshot);
}

test("publisher preflights both targets before replacing last-known-good", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-target-preflight-"));
  try {
    const candidatePath = join(root, "candidate.json");
    const latestPath = join(root, "latest.json");
    const lastKnownGoodPath = join(root, "last-known-good.json");

    const previous = await sealedSnapshot("2026-08-11T00:00:00.000Z");
    const candidate = await sealedSnapshot("2026-08-11T00:01:00.000Z");
    const previousBody = `${JSON.stringify(previous, null, 2)}\n`;

    await writeFile(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
    await writeFile(lastKnownGoodPath, previousBody, "utf8");
    await mkdir(latestPath);

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
      "2026-08-11T00:02:00.000Z",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    assert.notEqual(published.status, 0, `${published.stdout}\n${published.stderr}`);
    assert.match(published.stderr, /public snapshot target must be a regular file/);
    assert.equal(await readFile(lastKnownGoodPath, "utf8"), previousBody);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
