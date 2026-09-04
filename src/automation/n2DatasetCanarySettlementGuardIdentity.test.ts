import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  preflightN2AllActiveSettlementLineage,
  preflightN2DatasetCanarySettlementLineage,
} from "./n2DatasetCanarySettlementGuard";

function createDb(path: string): void {
  const db = new DatabaseSync(path);
  db.close();
}

function assertIdentityBlocked(path: string): void {
  const canary = preflightN2DatasetCanarySettlementLineage(path);
  assert.equal(canary.ok, false);
  assert.deepEqual(canary.blocks, ["DATASET_CANARY_SIDECAR_IDENTITY_INVALID"]);
  assert.equal(canary.checkedCandidateCount, 0);

  const active = preflightN2AllActiveSettlementLineage(path);
  assert.equal(active.ok, false);
  assert.deepEqual(active.blocks, ["DATASET_ACTIVE_SIDECAR_IDENTITY_INVALID"]);
  assert.equal(active.checkedCandidateCount, 0);
}

test("dataset settlement preflights reject a leaf symlink sidecar", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-settlement-preflight-leaf-symlink-"));
  try {
    const target = join(root, "sidecar.sqlite");
    const alias = join(root, "sidecar-alias.sqlite");
    createDb(target);
    symlinkSync(target, alias);
    assertIdentityBlocked(alias);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dataset settlement preflights reject an ancestor symlink sidecar", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-settlement-preflight-ancestor-symlink-"));
  try {
    const realDir = join(root, "real");
    const aliasDir = join(root, "alias");
    mkdirSync(realDir);
    const target = join(realDir, "sidecar.sqlite");
    createDb(target);
    symlinkSync(realDir, aliasDir);
    assertIdentityBlocked(join(aliasDir, "sidecar.sqlite"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dataset settlement preflights reject a hardlinked sidecar", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-settlement-preflight-hardlink-"));
  try {
    const target = join(root, "sidecar.sqlite");
    const hardlink = join(root, "sidecar-hardlink.sqlite");
    createDb(target);
    linkSync(target, hardlink);
    assertIdentityBlocked(target);
    assertIdentityBlocked(hardlink);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
