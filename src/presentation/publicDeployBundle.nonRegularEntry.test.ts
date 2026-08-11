import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assemblePublicDashboardDeploy, verifyPublicDashboardDeploy } from "./publicDeployBundle";

test("deploy verifier rejects a non-regular required entry", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-nonregular-entry-"));
  const dist = join(root, "dist");
  const output = join(root, "output");
  let server: Server | null = null;

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

    const manifestPath = join(output, "deploy-manifest.json");
    await unlink(manifestPath);
    server = createServer();
    await new Promise<void>((resolveListen, reject) => {
      server!.once("error", reject);
      server!.listen(manifestPath, resolveListen);
    });

    const verified = await verifyPublicDashboardDeploy(output);
    assert.equal(verified.ok, false);
    assert.match(verified.errors.join("\n"), /non-regular public entry is forbidden: deploy-manifest\.json/);
  } finally {
    if (server) {
      await new Promise<void>((resolveClose) => server!.close(() => resolveClose()));
    }
    await rm(root, { recursive: true, force: true });
  }
});
