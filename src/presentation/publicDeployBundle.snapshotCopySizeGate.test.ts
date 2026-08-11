import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assemblePublicDashboardDeploy } from "./publicDeployBundle";

const OVERSIZE_BYTES = 8 * 1024 * 1024 + 1;

test("assembly rejects oversized public snapshots before copying them", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-snapshot-copy-size-gate-"));
  const dist = join(root, "dist");
  const snapshots = join(root, "snapshots");
  const output = join(root, "output");
  const sourceSnapshot = join(snapshots, "latest.json");
  const copiedSnapshot = join(output, "public-data", "latest.json");

  try {
    await mkdir(join(dist, "assets"), { recursive: true });
    await mkdir(snapshots, { recursive: true });
    await Promise.all([
      writeFile(join(dist, "public-dashboard.html"), '<div id="public-root"></div>', "utf8"),
      writeFile(join(dist, "assets", "public.css"), "body{margin:0}\n", "utf8"),
      writeFile(join(dist, "assets", "public.js"), "console.log('public')\n", "utf8"),
      writeFile(sourceSnapshot, "{}", "utf8"),
    ]);
    await truncate(sourceSnapshot, OVERSIZE_BYTES);

    await assert.rejects(
      () => assemblePublicDashboardDeploy({
        distDir: dist,
        staticDir: "public-site",
        outputDir: output,
        snapshotDir: snapshots,
      }),
      /refusing to copy oversized public snapshot:/,
    );
    await assert.rejects(() => access(copiedSnapshot));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
