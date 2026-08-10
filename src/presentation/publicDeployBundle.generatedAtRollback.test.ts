import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import fixture from "./fixtures/public-dashboard-snapshot-v1.json";
import type { PublicDashboardSnapshot } from "./publicSnapshot";
import { assemblePublicDashboardDeploy } from "./publicDeployBundle";
import { sealPublicDashboardSnapshot } from "./publicSnapshotTransport";

test("deploy rejects generatedAt rollback when dataAsOf is unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-generatedat-rollback-"));
  const dist = join(root, "dist");
  const staticDir = join(root, "static");
  const output = join(root, "output");
  const snapshotDir = join(root, "snapshot");

  try {
    await Promise.all([
      mkdir(join(dist, "assets"), { recursive: true }),
      mkdir(staticDir, { recursive: true }),
      mkdir(snapshotDir, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(dist, "public-dashboard.html"), [
        "<!doctype html><html><head>",
        '<link rel="stylesheet" href="/assets/public.css">',
        "</head><body>",
        '<div id="public-root"></div>',
        '<script type="module" src="/assets/public.js"></script>',
        "</body></html>",
      ].join(""), "utf8"),
      writeFile(join(dist, "assets", "public.js"), "console.log('public dashboard');\n", "utf8"),
      writeFile(join(dist, "assets", "public.css"), "body{margin:0}\n", "utf8"),
      writeFile(join(staticDir, "404.html"), "<!doctype html><meta name=robots content=noindex>", "utf8"),
      writeFile(join(staticDir, "robots.txt"), "User-agent: *\nAllow: /\n", "utf8"),
      writeFile(join(staticDir, "manifest.webmanifest"), "{\"name\":\"Boat Pon\",\"start_url\":\"/\"}\n", "utf8"),
      writeFile(join(staticDir, "_headers"), "/*\n  X-Content-Type-Options: nosniff\n", "utf8"),
      writeFile(join(staticDir, "_redirects"), "/public-dashboard.html / 301\n", "utf8"),
    ]);

    const dataAsOf = "2026-08-05T09:00:00.000Z";
    const latest = structuredClone(fixture) as PublicDashboardSnapshot;
    latest.dataAsOf = dataAsOf;
    latest.generatedAt = "2026-08-05T09:01:00.000Z";
    const fallback = structuredClone(fixture) as PublicDashboardSnapshot;
    fallback.dataAsOf = dataAsOf;
    fallback.generatedAt = "2026-08-05T09:02:00.000Z";

    await Promise.all([
      writeFile(
        join(snapshotDir, "latest.json"),
        `${JSON.stringify(await sealPublicDashboardSnapshot(latest), null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        join(snapshotDir, "last-known-good.json"),
        `${JSON.stringify(await sealPublicDashboardSnapshot(fallback), null, 2)}\n`,
        "utf8",
      ),
    ]);

    await assert.rejects(
      assemblePublicDashboardDeploy({ distDir: dist, staticDir, outputDir: output, snapshotDir }),
      /latest\.json generation is older than last-known-good\.json/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
