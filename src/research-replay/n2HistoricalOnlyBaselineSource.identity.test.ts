import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readCleanTrifectaWinners } from "./n2HistoricalOnlyBaselineSource";

function withTempDir(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-historical-sidecar-identity-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function invoke(sidecarDbPath: string): void {
  readCleanTrifectaWinners({
    sidecarDbPath,
    fromDate: "2026-08-01",
    toDate: "2026-08-01",
  });
}

test("historical winner reader rejects a sidecar leaf symlink before SQLite open", () => {
  withTempDir((root) => {
    const target = join(root, "target.sqlite");
    const sidecar = join(root, "sidecar.sqlite");
    writeFileSync(target, "not-sqlite");
    symlinkSync(target, sidecar);
    assert.throws(() => invoke(sidecar), /SIDECAR_IDENTITY_INVALID/);
  });
});

test("historical winner reader rejects a sidecar ancestor alias before SQLite open", () => {
  withTempDir((root) => {
    const realDir = join(root, "real");
    const aliasDir = join(root, "alias");
    mkdirSync(realDir);
    symlinkSync(realDir, aliasDir, "dir");
    writeFileSync(join(realDir, "sidecar.sqlite"), "not-sqlite");
    assert.throws(() => invoke(join(aliasDir, "sidecar.sqlite")), /SIDECAR_IDENTITY_INVALID/);
  });
});

test("historical winner reader rejects a hardlinked sidecar before SQLite open", () => {
  withTempDir((root) => {
    const target = join(root, "target.sqlite");
    const sidecar = join(root, "sidecar.sqlite");
    writeFileSync(target, "not-sqlite");
    linkSync(target, sidecar);
    assert.throws(() => invoke(sidecar), /SIDECAR_IDENTITY_INVALID/);
  });
});
