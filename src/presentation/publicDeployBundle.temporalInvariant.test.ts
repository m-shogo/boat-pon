import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import fixture from "./fixtures/public-dashboard-snapshot-v1.json";
import type { PublicDashboardSnapshot } from "./publicSnapshot";
import { assemblePublicDashboardDeploy } from "./publicDeployBundle";
import { sealPublicDashboardSnapshot } from "./publicSnapshotTransport";

test("deploy rejects signed snapshots that violate loader timestamp invariants", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-deploy-time-"));
  const dist = join(root, "dist");
  const staticDir = join(root, "static");
  const snapshotDir = join(root, "snapshot");

  try {
    await writePublicShell(dist, staticDir);
    await mkdir(snapshotDir, { recursive: true });

    const dataAfterGeneration = structuredClone(fixture) as PublicDashboardSnapshot;
    dataAfterGeneration.generatedAt = "2026-08-05T09:00:00.000Z";
    dataAfterGeneration.dataAsOf = "2026-08-05T10:00:00.000Z";
    await writeSnapshotPair(snapshotDir, dataAfterGeneration);

    await assert.rejects(
      assemblePublicDashboardDeploy({
        distDir: dist,
        staticDir,
        outputDir: join(root, "output-impossible-order"),
        snapshotDir,
      }),
      /dataAsOf is after generatedAt/,
    );

    const future = structuredClone(fixture) as PublicDashboardSnapshot;
    future.generatedAt = "2099-01-01T00:00:00.000Z";
    future.dataAsOf = "2099-01-01T00:00:00.000Z";
    await writeSnapshotPair(snapshotDir, future);

    await assert.rejects(
      assemblePublicDashboardDeploy({
        distDir: dist,
        staticDir,
        outputDir: join(root, "output-future"),
        snapshotDir,
      }),
      /generatedAt is in the future/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeSnapshotPair(snapshotDir: string, snapshot: PublicDashboardSnapshot): Promise<void> {
  snapshot.integrity.digest = "0".repeat(64);
  const sealed = await sealPublicDashboardSnapshot(snapshot);
  const body = `${JSON.stringify(sealed, null, 2)}\n`;
  await Promise.all([
    writeFile(join(snapshotDir, "latest.json"), body, "utf8"),
    writeFile(join(snapshotDir, "last-known-good.json"), body, "utf8"),
  ]);
}

async function writePublicShell(dist: string, staticDir: string): Promise<void> {
  await Promise.all([
    mkdir(join(dist, "assets"), { recursive: true }),
    mkdir(staticDir, { recursive: true }),
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
}
