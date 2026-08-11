import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assemblePublicDashboardDeploy } from "./publicDeployBundle";

const OVERSIZE_BYTES = 8 * 1024 * 1024 + 1;

test("assembly preserves existing output when dist contains an oversized file", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-source-preflight-size-"));
  const dist = join(root, "dist");
  const staticDir = join(root, "static");
  const output = join(root, "output");
  const oversized = join(dist, "assets", "public.js");
  const marker = join(output, "known-good.txt");

  try {
    await Promise.all([
      mkdir(join(dist, "assets"), { recursive: true }),
      mkdir(staticDir, { recursive: true }),
      mkdir(output, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(dist, "public-dashboard.html"), '<div id="public-root"></div>', "utf8"),
      writeFile(oversized, "x", "utf8"),
      writeFile(marker, "must-survive\n", "utf8"),
    ]);
    await truncate(oversized, OVERSIZE_BYTES);

    await assert.rejects(
      assemblePublicDashboardDeploy({ distDir: dist, staticDir, outputDir: output }),
      /refusing to copy oversized public file:/,
    );
    assert.equal(await readFile(marker, "utf8"), "must-survive\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("assembly preserves existing output when static input contains a symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-source-preflight-link-"));
  const dist = join(root, "dist");
  const staticDir = join(root, "static");
  const output = join(root, "output");
  const marker = join(output, "known-good.txt");

  try {
    await Promise.all([
      mkdir(dist, { recursive: true }),
      mkdir(staticDir, { recursive: true }),
      mkdir(output, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(dist, "public-dashboard.html"), '<div id="public-root"></div>', "utf8"),
      writeFile(marker, "must-survive\n", "utf8"),
    ]);
    await symlink(join(root, "external.txt"), join(staticDir, "linked.txt"));

    await assert.rejects(
      assemblePublicDashboardDeploy({ distDir: dist, staticDir, outputDir: output }),
      /refusing to copy symbolic link:/,
    );
    assert.equal(await readFile(marker, "utf8"), "must-survive\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("assembly preserves existing output when the isolated Vite entry is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-source-preflight-entry-"));
  const dist = join(root, "dist");
  const staticDir = join(root, "static");
  const output = join(root, "output");
  const marker = join(output, "known-good.txt");

  try {
    await Promise.all([
      mkdir(dist, { recursive: true }),
      mkdir(staticDir, { recursive: true }),
      mkdir(output, { recursive: true }),
    ]);
    await writeFile(marker, "must-survive\n", "utf8");

    await assert.rejects(
      assemblePublicDashboardDeploy({ distDir: dist, staticDir, outputDir: output }),
      /isolated Vite public-dashboard\.html entry/,
    );
    assert.equal(await readFile(marker, "utf8"), "must-survive\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
