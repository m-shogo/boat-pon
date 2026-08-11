import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assemblePublicDashboardDeploy } from "./publicDeployBundle";

test("assembly preserves existing output when the snapshot pair is incomplete", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-snapshot-preflight-pair-"));
  const dist = join(root, "dist");
  const staticDir = join(root, "static");
  const snapshots = join(root, "snapshots");
  const output = join(root, "output");
  const marker = join(output, "known-good.txt");

  try {
    await Promise.all([
      mkdir(dist, { recursive: true }),
      mkdir(staticDir, { recursive: true }),
      mkdir(snapshots, { recursive: true }),
      mkdir(output, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(snapshots, "latest.json"), "{}\n", "utf8"),
      writeFile(marker, "must-survive\n", "utf8"),
    ]);

    await assert.rejects(
      assemblePublicDashboardDeploy({
        distDir: dist,
        staticDir,
        outputDir: output,
        snapshotDir: snapshots,
      }),
      /latest\.json and last-known-good\.json must be supplied together/,
    );

    assert.equal(await readFile(marker, "utf8"), "must-survive\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("assembly preserves existing output when a snapshot input is a dangling symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-snapshot-preflight-symlink-"));
  const dist = join(root, "dist");
  const staticDir = join(root, "static");
  const snapshots = join(root, "snapshots");
  const output = join(root, "output");
  const marker = join(output, "known-good.txt");

  try {
    await Promise.all([
      mkdir(dist, { recursive: true }),
      mkdir(staticDir, { recursive: true }),
      mkdir(snapshots, { recursive: true }),
      mkdir(output, { recursive: true }),
    ]);
    await Promise.all([
      symlink(join(root, "missing-latest.json"), join(snapshots, "latest.json")),
      writeFile(marker, "must-survive\n", "utf8"),
    ]);

    await assert.rejects(
      assemblePublicDashboardDeploy({
        distDir: dist,
        staticDir,
        outputDir: output,
        snapshotDir: snapshots,
      }),
      /snapshot input must be a regular file:/,
    );

    assert.equal(await readFile(marker, "utf8"), "must-survive\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
