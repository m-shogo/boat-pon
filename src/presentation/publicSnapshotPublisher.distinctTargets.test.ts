import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import fixture from "./fixtures/public-dashboard-snapshot-v1.json";
import type { PublicDashboardSnapshot } from "./publicSnapshot";
import { sealPublicDashboardSnapshot } from "./publicSnapshotTransport";

test("publisher rejects one path reused for latest and last-known-good", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-distinct-targets-"));
  try {
    const candidatePath = join(root, "candidate.json");
    const sharedPath = join(root, "shared.json");

    const snapshot = structuredClone(fixture) as PublicDashboardSnapshot;
    snapshot.generatedAt = "2026-08-11T00:00:00.000Z";
    snapshot.dataAsOf = "2026-08-11T00:00:00.000Z";
    snapshot.status.lastRunAt = "2026-08-11T00:00:00.000Z";
    snapshot.integrity.digest = "0".repeat(64);
    const candidate = await sealPublicDashboardSnapshot(snapshot);
    const previousBody = "previous-publication\n";

    await writeFile(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
    await writeFile(sharedPath, previousBody, "utf8");

    const published = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "scripts/publish-public-dashboard-snapshot.ts",
      "--candidate",
      candidatePath,
      "--latest",
      sharedPath,
      "--last-known-good",
      sharedPath,
      "--now",
      "2026-08-11T00:01:00.000Z",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    assert.notEqual(published.status, 0, `${published.stdout}\n${published.stderr}`);
    assert.match(published.stderr, /latest and last-known-good targets must be distinct/);
    assert.equal(await readFile(sharedPath, "utf8"), previousBody);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
