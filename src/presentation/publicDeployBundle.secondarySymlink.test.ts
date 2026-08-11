import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assemblePublicDashboardDeploy, verifyPublicDashboardDeploy } from "./publicDeployBundle";

async function createDeploy(root: string): Promise<string> {
  const dist = join(root, "dist");
  const output = join(root, "output");
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
  await assemblePublicDashboardDeploy({ distDir: dist, staticDir: "public-site", outputDir: output });
  return output;
}

test("deploy verifier does not re-read a symlinked index entry", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-index-symlink-"));
  try {
    const output = await createDeploy(root);
    const targetDirectory = join(root, "external-index-directory");
    await mkdir(targetDirectory);
    await unlink(join(output, "index.html"));
    await symlink(targetDirectory, join(output, "index.html"), "dir");

    const verified = await verifyPublicDashboardDeploy(output);
    assert.equal(verified.ok, false);
    assert.match(verified.errors.join("\n"), /symbolic links are forbidden: index\.html/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deploy verifier does not re-read a symlinked manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-manifest-secondary-symlink-"));
  try {
    const output = await createDeploy(root);
    const targetDirectory = join(root, "external-manifest-directory");
    await mkdir(targetDirectory);
    await unlink(join(output, "deploy-manifest.json"));
    await symlink(targetDirectory, join(output, "deploy-manifest.json"), "dir");

    const verified = await verifyPublicDashboardDeploy(output);
    assert.equal(verified.ok, false);
    assert.match(verified.errors.join("\n"), /symbolic links are forbidden: deploy-manifest\.json/);
    assert.doesNotMatch(verified.errors.join("\n"), /invalid deploy-manifest\.json/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deploy verifier does not re-read a symlinked optional snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-snapshot-secondary-symlink-"));
  try {
    const output = await createDeploy(root);
    const targetDirectory = join(root, "external-snapshot-directory");
    await mkdir(targetDirectory);
    await mkdir(join(output, "public-data"), { recursive: true });
    await symlink(targetDirectory, join(output, "public-data", "latest.json"), "dir");

    const verified = await verifyPublicDashboardDeploy(output);
    assert.equal(verified.ok, false);
    assert.match(verified.errors.join("\n"), /symbolic links are forbidden: public-data\/latest\.json/);
    assert.doesNotMatch(verified.errors.join("\n"), /public-data\/latest\.json is invalid JSON/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
