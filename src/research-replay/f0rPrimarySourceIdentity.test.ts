import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const script = join(repoRoot, "scripts", "research-replay-rollout.ts");
const errorCode = "F0R_PRIMARY_SOURCE_IDENTITY_INVALID";

function run(primarySource: string, deploymentRoot: string): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      script,
      "--dry-run",
      `--root=${deploymentRoot}`,
      `--primary-source=${primarySource}`,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
}

function assertIdentityRejected(primarySource: string, deploymentRoot: string): void {
  const result = run(primarySource, deploymentRoot);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(errorCode));
}

test("F0-R rollout rejects a symlinked primary source before fingerprinting", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-f0r-primary-leaf-"));
  try {
    const target = join(root, "target.sqlite");
    const primarySource = join(root, "boat.sqlite");
    writeFileSync(target, "not a database", "utf8");
    symlinkSync(target, primarySource);
    assertIdentityRejected(primarySource, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F0-R rollout rejects an ancestor alias before fingerprinting", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-f0r-primary-ancestor-"));
  try {
    const realData = join(root, "real-data");
    const aliasData = join(root, "alias-data");
    mkdirSync(realData);
    writeFileSync(join(realData, "boat.sqlite"), "not a database", "utf8");
    symlinkSync(realData, aliasData);
    assertIdentityRejected(join(aliasData, "boat.sqlite"), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F0-R rollout rejects a hardlinked primary source before fingerprinting", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-f0r-primary-hardlink-"));
  try {
    const target = join(root, "target.sqlite");
    const primarySource = join(root, "boat.sqlite");
    writeFileSync(target, "not a database", "utf8");
    linkSync(target, primarySource);
    assertIdentityRejected(primarySource, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
