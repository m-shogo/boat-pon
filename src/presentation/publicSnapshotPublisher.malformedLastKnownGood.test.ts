import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import fixture from "./fixtures/public-dashboard-snapshot-v1.json";
import type { PublicDashboardSnapshot } from "./publicSnapshot";
import { sealPublicDashboardSnapshot, verifyPublicDashboardSnapshotIntegrity } from "./publicSnapshotTransport";

test("publisher replaces malformed last-known-good JSON with a valid candidate", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-malformed-lkg-"));
  try {
    const candidatePath = join(root, "candidate.json");
    const publicDataDir = join(root, "public-data");
    const latestPath = join(publicDataDir, "latest.json");
    const lastKnownGoodPath = join(publicDataDir, "last-known-good.json");

    const snapshot = structuredClone(fixture) as PublicDashboardSnapshot;
    snapshot.generatedAt = "2026-08-11T00:00:00.000Z";
    snapshot.dataAsOf = "2026-08-11T00:00:00.000Z";
    snapshot.status.lastRunAt = "2026-08-11T00:00:00.000Z";
    snapshot.integrity.digest = "0".repeat(64);
    const candidate = await sealPublicDashboardSnapshot(snapshot);

    await mkdir(publicDataDir, { recursive: true });
    await writeFile(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
    await writeFile(lastKnownGoodPath, "{ malformed", "utf8");

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

    assert.equal(published.status, 0, `${published.stdout}\n${published.stderr}`);
    assert.match(published.stdout, /warnings=EXISTING_LAST_KNOWN_GOOD_INVALID_REPLACED/);

    const latest = JSON.parse(await readFile(latestPath, "utf8")) as unknown;
    const lastKnownGood = JSON.parse(await readFile(lastKnownGoodPath, "utf8")) as unknown;
    const latestVerified = await verifyPublicDashboardSnapshotIntegrity(latest);
    const lastKnownGoodVerified = await verifyPublicDashboardSnapshotIntegrity(lastKnownGood);
    assert.equal(latestVerified.ok, true, latestVerified.errors.join("\n"));
    assert.equal(lastKnownGoodVerified.ok, true, lastKnownGoodVerified.errors.join("\n"));
    assert.equal(latestVerified.snapshot?.integrity.digest, candidate.integrity.digest);
    assert.equal(lastKnownGoodVerified.snapshot?.integrity.digest, candidate.integrity.digest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
