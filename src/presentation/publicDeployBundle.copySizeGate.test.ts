import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assemblePublicDashboardDeploy } from "./publicDeployBundle";

const OVERSIZE_BYTES = 8 * 1024 * 1024 + 1;

test("assembly rejects oversized public files before copying them", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-copy-size-gate-"));
  const dist = join(root, "dist");
  const output = join(root, "output");
  const sourceAsset = join(dist, "assets", "public.js");
  const copiedAsset = join(output, "assets", "public.js");

  try {
    await mkdir(join(dist, "assets"), { recursive: true });
    await Promise.all([
      writeFile(join(dist, "public-dashboard.html"), '<div id="public-root"></div>', "utf8"),
      writeFile(join(dist, "assets", "public.css"), "body{margin:0}\n", "utf8"),
      writeFile(sourceAsset, "x", "utf8"),
    ]);
    await truncate(sourceAsset, OVERSIZE_BYTES);

    await assert.rejects(
      () => assemblePublicDashboardDeploy({
        distDir: dist,
        staticDir: "public-site",
        outputDir: output,
      }),
      /refusing to copy oversized public file:/,
    );
    await assert.rejects(() => access(copiedAsset));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
