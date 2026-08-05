import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import fixture from "./fixtures/public-dashboard-snapshot-v1.json";
import type { PublicDashboardSnapshot } from "./publicSnapshot";
import {
  assemblePublicDashboardDeploy,
  verifyPublicDashboardDeploy,
} from "./publicDeployBundle";
import { sealPublicDashboardSnapshot } from "./publicSnapshotTransport";

async function makeFixtureRoot(): Promise<{
  root: string;
  dist: string;
  staticDir: string;
  output: string;
  snapshotDir: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-deploy-"));
  const dist = join(root, "dist");
  const staticDir = join(root, "static");
  const output = join(root, "output");
  const snapshotDir = join(root, "snapshot");
  await Promise.all([
    mkdir(join(dist, "assets"), { recursive: true }),
    mkdir(staticDir, { recursive: true }),
    mkdir(snapshotDir, { recursive: true }),
  ]);

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
    writeFile(join(staticDir, "404.html"), "<!doctype html><meta name=robots content=noindex><a href=\"/\">home</a>", "utf8"),
    writeFile(join(staticDir, "robots.txt"), "User-agent: *\nAllow: /\n", "utf8"),
    writeFile(join(staticDir, "manifest.webmanifest"), "{\"name\":\"Boat Pon\",\"start_url\":\"/\"}\n", "utf8"),
    writeFile(join(staticDir, "_headers"), "/*\n  X-Content-Type-Options: nosniff\n", "utf8"),
    writeFile(join(staticDir, "_redirects"), "/public-dashboard.html / 301\n", "utf8"),
  ]);

  const latest = structuredClone(fixture) as PublicDashboardSnapshot;
  latest.dataAsOf = "2026-08-05T09:00:00.000Z";
  latest.generatedAt = "2026-08-05T09:01:00.000Z";
  const fallback = structuredClone(latest);
  fallback.dataAsOf = "2026-08-05T08:00:00.000Z";
  fallback.generatedAt = "2026-08-05T08:01:00.000Z";
  await Promise.all([
    writeFile(join(snapshotDir, "latest.json"), `${JSON.stringify(await sealPublicDashboardSnapshot(latest), null, 2)}\n`, "utf8"),
    writeFile(join(snapshotDir, "last-known-good.json"), `${JSON.stringify(await sealPublicDashboardSnapshot(fallback), null, 2)}\n`, "utf8"),
  ]);

  return { root, dist, staticDir, output, snapshotDir };
}

test("isolated public deploy bundle contains only allowlisted verified files", async () => {
  const fixtureRoot = await makeFixtureRoot();
  try {
    const manifest = await assemblePublicDashboardDeploy({
      distDir: fixtureRoot.dist,
      staticDir: fixtureRoot.staticDir,
      outputDir: fixtureRoot.output,
      snapshotDir: fixtureRoot.snapshotDir,
    });

    assert.equal(manifest.entry, "index.html");
    assert.ok(manifest.files.some((file) => file.path === "assets/public.js"));
    assert.ok(manifest.files.some((file) => file.path === "public-data/latest.json"));
    await assert.rejects(readFile(join(fixtureRoot.output, "public-dashboard.html"), "utf8"));

    const verified = await verifyPublicDashboardDeploy(fixtureRoot.output);
    assert.equal(verified.ok, true, verified.errors.join("\n"));
  } finally {
    await rm(fixtureRoot.root, { recursive: true, force: true });
  }
});

test("private files and post-manifest tampering fail closed", async () => {
  const fixtureRoot = await makeFixtureRoot();
  try {
    await assemblePublicDashboardDeploy({
      distDir: fixtureRoot.dist,
      staticDir: fixtureRoot.staticDir,
      outputDir: fixtureRoot.output,
    });

    await mkdir(join(fixtureRoot.output, "data"), { recursive: true });
    await writeFile(join(fixtureRoot.output, "data", "boat.sqlite"), "private", "utf8");
    const privateResult = await verifyPublicDashboardDeploy(fixtureRoot.output);
    assert.equal(privateResult.ok, false);
    assert.match(privateResult.errors.join("\n"), /non-allowlisted|private\/runtime/);

    await rm(join(fixtureRoot.output, "data"), { recursive: true, force: true });
    await writeFile(join(fixtureRoot.output, "assets", "public.js"), "console.log('tampered');\n", "utf8");
    const tamperedResult = await verifyPublicDashboardDeploy(fixtureRoot.output);
    assert.equal(tamperedResult.ok, false);
    assert.match(tamperedResult.errors.join("\n"), /manifest (?:byte count|digest) mismatch/);
  } finally {
    await rm(fixtureRoot.root, { recursive: true, force: true });
  }
});

test("snapshot rollback and workflow write or deploy privileges are rejected", async () => {
  const fixtureRoot = await makeFixtureRoot();
  try {
    const latestPath = join(fixtureRoot.snapshotDir, "latest.json");
    const fallbackPath = join(fixtureRoot.snapshotDir, "last-known-good.json");
    const latest = JSON.parse(await readFile(latestPath, "utf8")) as PublicDashboardSnapshot;
    const fallback = JSON.parse(await readFile(fallbackPath, "utf8")) as PublicDashboardSnapshot;
    await Promise.all([
      writeFile(latestPath, `${JSON.stringify(fallback, null, 2)}\n`, "utf8"),
      writeFile(fallbackPath, `${JSON.stringify(latest, null, 2)}\n`, "utf8"),
    ]);

    await assert.rejects(
      assemblePublicDashboardDeploy({
        distDir: fixtureRoot.dist,
        staticDir: fixtureRoot.staticDir,
        outputDir: fixtureRoot.output,
        snapshotDir: fixtureRoot.snapshotDir,
      }),
      /latest\.json is older than last-known-good\.json/,
    );

    const workflow = await readFile(".github/workflows/public-dashboard-preview.yml", "utf8");
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /contents: read/);
    assert.match(workflow, /actions\/upload-artifact@v4/);
    assert.doesNotMatch(workflow, /\bschedule:/);
    assert.doesNotMatch(workflow, /contents: write|wrangler\s+deploy|pages\s+deploy|cloudflare/i);
  } finally {
    await rm(fixtureRoot.root, { recursive: true, force: true });
  }
});

test("real public-site support files remain copyable without symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-static-"));
  try {
    await cp("public-site", join(root, "public-site"), { recursive: true });
    const files = await Promise.all([
      readFile(join(root, "public-site", "_headers"), "utf8"),
      readFile(join(root, "public-site", "_redirects"), "utf8"),
      readFile(join(root, "public-site", "404.html"), "utf8"),
    ]);
    assert.match(files[0], /Content-Security-Policy/);
    assert.match(files[1], /public-dashboard\.html/);
    assert.match(files[2], /noindex/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
