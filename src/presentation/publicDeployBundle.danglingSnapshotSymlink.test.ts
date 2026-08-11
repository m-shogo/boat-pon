import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assemblePublicDashboardDeploy } from "./publicDeployBundle";

test("assembly rejects a dangling public snapshot symlink instead of treating it as absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-dangling-snapshot-symlink-"));
  const dist = join(root, "dist");
  const snapshots = join(root, "snapshots");
  const output = join(root, "output");

  try {
    await mkdir(join(dist, "assets"), { recursive: true });
    await mkdir(snapshots, { recursive: true });
    await Promise.all([
      writeFile(join(dist, "public-dashboard.html"), '<div id="public-root"></div>', "utf8"),
      writeFile(join(dist, "assets", "public.css"), "body{margin:0}\n", "utf8"),
      writeFile(join(dist, "assets", "public.js"), "console.log('public')\n", "utf8"),
    ]);
    await symlink(join(root, "missing-latest.json"), join(snapshots, "latest.json"));

    await assert.rejects(
      () => assemblePublicDashboardDeploy({
        distDir: dist,
        staticDir: "public-site",
        outputDir: output,
        snapshotDir: snapshots,
      }),
      /snapshot input must be a regular file:/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
