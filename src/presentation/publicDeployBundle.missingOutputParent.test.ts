import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assemblePublicDashboardDeploy, verifyPublicDashboardDeploy } from "./publicDeployBundle";

test("assembly supports an output directory whose parent does not exist yet", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-missing-output-parent-"));
  const dist = join(root, "dist");
  const staticDir = join(root, "static");
  const output = join(root, "new-parent", "nested", "deploy");

  try {
    await Promise.all([
      mkdir(join(dist, "assets"), { recursive: true }),
      mkdir(staticDir, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(dist, "public-dashboard.html"), '<!doctype html><div id="public-root"></div><script src="/assets/public.js"></script>', "utf8"),
      writeFile(join(dist, "assets", "public.js"), "console.log('public dashboard');\n", "utf8"),
      writeFile(join(staticDir, "404.html"), '<!doctype html><a href="/">home</a>', "utf8"),
      writeFile(join(staticDir, "robots.txt"), "User-agent: *\nAllow: /\n", "utf8"),
      writeFile(join(staticDir, "manifest.webmanifest"), '{"name":"Boat Pon","start_url":"/"}\n', "utf8"),
      writeFile(join(staticDir, "_headers"), "/*\n  X-Content-Type-Options: nosniff\n", "utf8"),
      writeFile(join(staticDir, "_redirects"), "/public-dashboard.html / 301\n", "utf8"),
    ]);

    const manifest = await assemblePublicDashboardDeploy({
      distDir: dist,
      staticDir,
      outputDir: output,
    });

    assert.equal(manifest.entry, "index.html");
    const verified = await verifyPublicDashboardDeploy(output);
    assert.equal(verified.ok, true, verified.errors.join("\n"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
