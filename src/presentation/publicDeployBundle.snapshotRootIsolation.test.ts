import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assemblePublicDashboardDeploy } from "./publicDeployBundle";

test("assembly rejects an output root that would delete the snapshot source", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-snapshot-root-"));
  const dist = join(root, "dist");
  const staticDir = join(root, "static");
  const snapshotDir = join(root, "snapshots");
  const marker = join(snapshotDir, "latest.json");

  try {
    await Promise.all([
      mkdir(dist, { recursive: true }),
      mkdir(staticDir, { recursive: true }),
      mkdir(snapshotDir, { recursive: true }),
    ]);
    await writeFile(marker, "must-survive\n", "utf8");

    await assert.rejects(
      assemblePublicDashboardDeploy({
        distDir: dist,
        staticDir,
        outputDir: snapshotDir,
        snapshotDir,
      }),
      /snapshot directory must be distinct from deploy input\/output directories/,
    );

    assert.equal(await readFile(marker, "utf8"), "must-survive\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("assembly rejects an output parent that contains the snapshot source", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-snapshot-parent-"));
  const dist = join(root, "dist");
  const staticDir = join(root, "static");
  const outputDir = join(root, "publish");
  const snapshotDir = join(outputDir, "source-snapshots");
  const marker = join(snapshotDir, "latest.json");

  try {
    await Promise.all([
      mkdir(dist, { recursive: true }),
      mkdir(staticDir, { recursive: true }),
      mkdir(snapshotDir, { recursive: true }),
    ]);
    await writeFile(marker, "must-survive\n", "utf8");

    await assert.rejects(
      assemblePublicDashboardDeploy({
        distDir: dist,
        staticDir,
        outputDir,
        snapshotDir,
      }),
      /snapshot directory must be distinct from deploy input\/output directories/,
    );

    assert.equal(await readFile(marker, "utf8"), "must-survive\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
