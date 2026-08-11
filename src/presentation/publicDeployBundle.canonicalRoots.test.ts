import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assemblePublicDashboardDeploy } from "./publicDeployBundle";

test("assembly rejects a symlink-parent output alias before deleting the dist source", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-canonical-roots-"));
  const dist = join(root, "dist");
  const staticDir = join(root, "static");
  const aliasRoot = join(root, "alias-root");
  const outputAlias = join(aliasRoot, "dist");
  const marker = join(dist, "source-marker.txt");

  try {
    await Promise.all([
      mkdir(dist, { recursive: true }),
      mkdir(staticDir, { recursive: true }),
    ]);
    await writeFile(marker, "must-survive\n", "utf8");
    await symlink(root, aliasRoot, "dir");

    await assert.rejects(
      assemblePublicDashboardDeploy({
        distDir: dist,
        staticDir,
        outputDir: outputAlias,
      }),
      /dist, static and output directories must be distinct/,
    );

    assert.equal(await readFile(marker, "utf8"), "must-survive\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
