import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assemblePublicDashboardDeploy, verifyPublicDashboardDeploy } from "./publicDeployBundle";

test("deploy verifier rejects a symlinked artifact root", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-root-symlink-"));
  const dist = join(root, "dist");
  const output = join(root, "output");
  const alias = join(root, "output-alias");

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
    await symlink(output, alias, "dir");

    const verified = await verifyPublicDashboardDeploy(alias);
    assert.equal(verified.ok, false);
    assert.match(verified.errors.join("\n"), /deploy directory must not be a symbolic link/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
