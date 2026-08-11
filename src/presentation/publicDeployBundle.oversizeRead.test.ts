import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assemblePublicDashboardDeploy, verifyPublicDashboardDeploy } from "./publicDeployBundle";

const OVERSIZE_BYTES = 8 * 1024 * 1024 + 1;

test("deploy verifier stops reading a file after the size gate fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-oversize-read-"));
  const dist = join(root, "dist");
  const output = join(root, "output");

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

    const oversized = `${"x".repeat(OVERSIZE_BYTES - 12)}/api/owner`;
    await writeFile(join(output, "assets", "public.js"), oversized, "utf8");

    const verified = await verifyPublicDashboardDeploy(output);
    const errors = verified.errors.join("\n");
    assert.equal(verified.ok, false);
    assert.match(errors, /public file exceeds 8 MiB: assets\/public\.js/);
    assert.doesNotMatch(errors, /contains forbidden owner API/);
    assert.doesNotMatch(errors, /manifest (?:byte count|digest) mismatch: assets\/public\.js/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
