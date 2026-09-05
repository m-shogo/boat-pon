import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const script = join(root, "scripts", "reconcile-archive-canonical-settlement.ts");
const errorCode = "N2_ARCHIVE_CANONICAL_SIDECAR_IDENTITY_INVALID";

function run(sidecar: string, archiveRoot: string): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      script,
      "--as-of=2026-08-01T00:00:00.000Z",
      `--sidecar=${sidecar}`,
      `--archive-root=${archiveRoot}`,
    ],
    { cwd: root, encoding: "utf8" },
  );
}

function assertIdentityRejected(sidecar: string, archiveRoot: string): void {
  const result = run(sidecar, archiveRoot);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(errorCode));
}

test("archive-canonical reconcile rejects a leaf symlink before reading the sidecar", () => {
  const dir = mkdtempSync(join(tmpdir(), "boat-pon-archive-reconcile-leaf-"));
  try {
    const archiveRoot = join(dir, "archive");
    const target = join(dir, "target.sqlite");
    const sidecar = join(dir, "sidecar.sqlite");
    mkdirSync(archiveRoot);
    writeFileSync(target, "not a database", "utf8");
    symlinkSync(target, sidecar);
    assertIdentityRejected(sidecar, archiveRoot);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("archive-canonical reconcile rejects an ancestor alias before reading the sidecar", () => {
  const dir = mkdtempSync(join(tmpdir(), "boat-pon-archive-reconcile-ancestor-"));
  try {
    const archiveRoot = join(dir, "archive");
    const realDir = join(dir, "real");
    const aliasDir = join(dir, "alias");
    mkdirSync(archiveRoot);
    mkdirSync(realDir);
    writeFileSync(join(realDir, "sidecar.sqlite"), "not a database", "utf8");
    symlinkSync(realDir, aliasDir);
    assertIdentityRejected(join(aliasDir, "sidecar.sqlite"), archiveRoot);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("archive-canonical reconcile rejects a hardlink before reading the sidecar", () => {
  const dir = mkdtempSync(join(tmpdir(), "boat-pon-archive-reconcile-hardlink-"));
  try {
    const archiveRoot = join(dir, "archive");
    const target = join(dir, "target.sqlite");
    const sidecar = join(dir, "sidecar.sqlite");
    mkdirSync(archiveRoot);
    writeFileSync(target, "not a database", "utf8");
    linkSync(target, sidecar);
    assertIdentityRejected(sidecar, archiveRoot);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
