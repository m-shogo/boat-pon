import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assemblePublicDashboardDeploy, verifyPublicDashboardDeploy } from "./publicDeployBundle";

test("deploy verifier does not follow a symlink while hashing manifest entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-manifest-symlink-"));
  const output = join(root, "output");
  const targetDirectory = join(root, "external-directory");

  try {
    await assemblePublicDashboardDeploy({
      distDir: "dist-public",
      staticDir: "public-site",
      outputDir: output,
    });

    const assetPath = join(output, "assets", "public.js");
    const manifest = JSON.parse(await readFile(join(output, "deploy-manifest.json"), "utf8")) as {
      files: Array<{ path: string }>;
    };
    assert.equal(manifest.files.some((entry) => entry.path === "assets/public.js"), true);

    await mkdir(targetDirectory);
    await unlink(assetPath);
    await symlink(targetDirectory, assetPath, "dir");

    const verified = await verifyPublicDashboardDeploy(output);
    assert.equal(verified.ok, false);
    assert.match(verified.errors.join("\n"), /symbolic links are forbidden: assets\/public\.js/);
    assert.match(verified.errors.join("\n"), /manifest file must be a regular file: assets\/public\.js/);
    assert.doesNotMatch(verified.errors.join("\n"), /invalid deploy-manifest\.json/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
