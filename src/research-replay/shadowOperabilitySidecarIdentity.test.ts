import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const cli = resolve(import.meta.dirname, "../../scripts/report-shadow-operability.ts");

function run(sidecarPath: string, policyPath: string) {
  return spawnSync(process.execPath, [
    ...process.execArgv,
    cli,
    `--sidecar=${sidecarPath}`,
    `--policy=${policyPath}`,
    "--as-of=2026-08-02T05:00:01.000Z",
    "--mode=simulated",
  ], { encoding: "utf8" });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "shadow-operability-sidecar-identity-"));
  const policyPath = join(root, "policy.json");
  writeFileSync(policyPath, "{}\n", "utf8");
  return { root, policyPath };
}

test("shadow operability rejects a leaf-symlink sidecar before SQLite open", () => {
  const { root, policyPath } = fixture();
  try {
    const realSidecar = join(root, "real.sqlite");
    const aliasSidecar = join(root, "alias.sqlite");
    writeFileSync(realSidecar, "not-a-database", "utf8");
    symlinkSync(realSidecar, aliasSidecar);
    const result = run(aliasSidecar, policyPath);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SHADOW_OPERABILITY_SIDECAR_IDENTITY_INVALID/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shadow operability rejects an ancestor-symlink sidecar before SQLite open", () => {
  const { root, policyPath } = fixture();
  try {
    const realDir = join(root, "real");
    const aliasDir = join(root, "alias");
    mkdirSync(realDir);
    const realSidecar = join(realDir, "sidecar.sqlite");
    writeFileSync(realSidecar, "not-a-database", "utf8");
    symlinkSync(realDir, aliasDir, "dir");
    const result = run(join(aliasDir, "sidecar.sqlite"), policyPath);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SHADOW_OPERABILITY_SIDECAR_IDENTITY_INVALID/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shadow operability rejects a hardlinked sidecar before SQLite open", () => {
  const { root, policyPath } = fixture();
  try {
    const realSidecar = join(root, "real.sqlite");
    const hardlinkSidecar = join(root, "hardlink.sqlite");
    writeFileSync(realSidecar, "not-a-database", "utf8");
    linkSync(realSidecar, hardlinkSidecar);
    const result = run(hardlinkSidecar, policyPath);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SHADOW_OPERABILITY_SIDECAR_IDENTITY_INVALID/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
