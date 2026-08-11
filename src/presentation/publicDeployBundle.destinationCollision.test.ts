import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assemblePublicDashboardDeploy } from "./publicDeployBundle";

async function makeRoots(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const dist = join(root, "dist");
  const staticDir = join(root, "static");
  const output = join(root, "output");
  const marker = join(output, "known-good.txt");
  await Promise.all([
    mkdir(join(dist, "assets"), { recursive: true }),
    mkdir(join(staticDir, "assets"), { recursive: true }),
    mkdir(output, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(dist, "public-dashboard.html"), '<div id="public-root"></div>', "utf8"),
    writeFile(marker, "must-survive\n", "utf8"),
  ]);
  return { root, dist, staticDir, output, marker };
}

test("assembly rejects dist/static destination collisions before deleting existing output", async () => {
  const fixture = await makeRoots("boat-pon-public-destination-collision-");
  try {
    await Promise.all([
      writeFile(join(fixture.dist, "assets", "shared.js"), "dist\n", "utf8"),
      writeFile(join(fixture.staticDir, "assets", "shared.js"), "static\n", "utf8"),
    ]);

    await assert.rejects(
      assemblePublicDashboardDeploy({
        distDir: fixture.dist,
        staticDir: fixture.staticDir,
        outputDir: fixture.output,
      }),
      /deploy source destination collision: assets\/shared\.js/,
    );
    assert.equal(await readFile(fixture.marker, "utf8"), "must-survive\n");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("assembly rejects static index overwrite before deleting existing output", async () => {
  const fixture = await makeRoots("boat-pon-public-index-collision-");
  try {
    await writeFile(join(fixture.staticDir, "index.html"), "static index\n", "utf8");

    await assert.rejects(
      assemblePublicDashboardDeploy({
        distDir: fixture.dist,
        staticDir: fixture.staticDir,
        outputDir: fixture.output,
      }),
      /deploy source destination collision: index\.html/,
    );
    assert.equal(await readFile(fixture.marker, "utf8"), "must-survive\n");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("assembly rejects source deploy-manifest collision before deleting existing output", async () => {
  const fixture = await makeRoots("boat-pon-public-manifest-collision-");
  try {
    await writeFile(join(fixture.staticDir, "deploy-manifest.json"), "{}\n", "utf8");

    await assert.rejects(
      assemblePublicDashboardDeploy({
        distDir: fixture.dist,
        staticDir: fixture.staticDir,
        outputDir: fixture.output,
      }),
      /deploy source destination collision: deploy-manifest\.json/,
    );
    assert.equal(await readFile(fixture.marker, "utf8"), "must-survive\n");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
