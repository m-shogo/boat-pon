import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assemblePublicDashboardDeploy, verifyPublicDashboardDeploy } from "./publicDeployBundle";

test("deploy verifier does not follow a symlink while hashing manifest entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-manifest-symlink-"));
  const dist = join(root, "dist");
  const output = join(root, "output");
  const targetDirectory = join(root, "external-directory");

  try {
    await mkdir(join(dist, "assets"), { recursive: true });
    await Promise.all([
      writeFile(join(dist, "public-dashboard.html"), [
        "<!doctype html>",
        "<html><head>",
        '<link rel="stylesheet" href="/assets/public.css">',
        '<link rel="manifest" href="/manifest.webmanifest">',
        "</head><body>",
        '<div id="public-root"></div>',
        '<script type="module" src="/assets/public.js"></script>',
        "</body></html>",
      ].join(""), "utf8"),
      writeFile(join(dist, "assets", "public.js"), "console.log('public dashboard');\n", "utf8"),
      writeFile(join(dist, "assets", "public.css"), "body{margin:0}\n", "utf8"),
    ]);

    await assemblePublicDashboardDeploy({
      distDir: dist,
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
