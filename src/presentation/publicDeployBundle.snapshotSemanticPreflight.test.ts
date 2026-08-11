import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import fixture from "./fixtures/public-dashboard-snapshot-v1.json";
import type { PublicDashboardSnapshot } from "./publicSnapshot";
import { assemblePublicDashboardDeploy } from "./publicDeployBundle";
import { sealPublicDashboardSnapshot } from "./publicSnapshotTransport";

async function makeRoots(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const dist = join(root, "dist");
  const staticDir = join(root, "static");
  const snapshots = join(root, "snapshots");
  const output = join(root, "output");
  const marker = join(output, "known-good.txt");
  await Promise.all([
    mkdir(dist, { recursive: true }),
    mkdir(staticDir, { recursive: true }),
    mkdir(snapshots, { recursive: true }),
    mkdir(output, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(dist, "public-dashboard.html"), '<div id="public-root"></div>', "utf8"),
    writeFile(marker, "must-survive\n", "utf8"),
  ]);
  return { root, dist, staticDir, snapshots, output, marker };
}

test("assembly preserves existing output when snapshot JSON is malformed", async () => {
  const roots = await makeRoots("boat-pon-public-snapshot-semantic-json-");
  try {
    await Promise.all([
      writeFile(join(roots.snapshots, "latest.json"), "{not-json\n", "utf8"),
      writeFile(join(roots.snapshots, "last-known-good.json"), "{}\n", "utf8"),
    ]);

    await assert.rejects(
      assemblePublicDashboardDeploy({
        distDir: roots.dist,
        staticDir: roots.staticDir,
        outputDir: roots.output,
        snapshotDir: roots.snapshots,
      }),
      /latest\.json is invalid JSON/,
    );
    assert.equal(await readFile(roots.marker, "utf8"), "must-survive\n");
  } finally {
    await rm(roots.root, { recursive: true, force: true });
  }
});

test("assembly preserves existing output when latest snapshot would roll back fallback", async () => {
  const roots = await makeRoots("boat-pon-public-snapshot-semantic-rollback-");
  try {
    const latest = structuredClone(fixture) as PublicDashboardSnapshot;
    latest.dataAsOf = "2026-08-05T08:00:00.000Z";
    latest.generatedAt = "2026-08-05T08:01:00.000Z";
    const fallback = structuredClone(fixture) as PublicDashboardSnapshot;
    fallback.dataAsOf = "2026-08-05T09:00:00.000Z";
    fallback.generatedAt = "2026-08-05T09:01:00.000Z";

    await Promise.all([
      writeFile(
        join(roots.snapshots, "latest.json"),
        `${JSON.stringify(await sealPublicDashboardSnapshot(latest), null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        join(roots.snapshots, "last-known-good.json"),
        `${JSON.stringify(await sealPublicDashboardSnapshot(fallback), null, 2)}\n`,
        "utf8",
      ),
    ]);

    await assert.rejects(
      assemblePublicDashboardDeploy({
        distDir: roots.dist,
        staticDir: roots.staticDir,
        outputDir: roots.output,
        snapshotDir: roots.snapshots,
      }),
      /latest\.json is older than last-known-good\.json/,
    );
    assert.equal(await readFile(roots.marker, "utf8"), "must-survive\n");
  } finally {
    await rm(roots.root, { recursive: true, force: true });
  }
});
