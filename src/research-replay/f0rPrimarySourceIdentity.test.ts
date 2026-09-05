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

function run(cwd: string): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", script, "--dry-run", `--root=${cwd}`],
    { cwd, encoding: "utf8" },
  );
}

function assertIdentityRejected(root: string): void {
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(errorCode));
}

test("F0-R rollout rejects a symlinked primary source before fingerprinting", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-f0r-primary-leaf-"));
  try {
    const data = join(root, "data");
    mkdirSync(data);
    const target = join(root, "target.sqlite");
    writeFileSync(target, "not a database", "utf8");
    symlinkSync(target, join(data, "boat.sqlite"));
    assertIdentityRejected(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F0-R rollout rejects an ancestor alias before fingerprinting", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-f0r-primary-ancestor-"));
  try {
    const realData = join(root, "real-data");
    mkdirSync(realData);
    writeFileSync(join(realData, "boat.sqlite"), "not a database", "utf8");
    symlinkSync(realData, join(root, "data"));
    assertIdentityRejected(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F0-R rollout rejects a hardlinked primary source before fingerprinting", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-f0r-primary-hardlink-"));
  try {
    const data = join(root, "data");
    mkdirSync(data);
    const target = join(root, "target.sqlite");
    writeFileSync(target, "not a database", "utf8");
    linkSync(target, join(data, "boat.sqlite"));
    assertIdentityRejected(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
