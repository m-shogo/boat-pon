import assert from "node:assert/strict";
import { linkSync, mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { N2EdgeDiscoveryCandidate } from "./n2EdgeDiscoverySource";
import { readN2EdgeSelectedProgramFeatures } from "./n2EdgeSelectedProgramFeatures";

function candidate(): N2EdgeDiscoveryCandidate {
  return {
    canonicalRaceKey: "2004-01-01:11:R1",
    primaryRaceId: "20040101-びわこ-01",
    primaryIdentityEncoding: "venue_label",
    decisionCutoff: "2004-01-01T14:00:00.000Z",
    sourceObservedAt: "2004-01-01T01:00:00.000Z",
  };
}

function createDb(path: string): void {
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE official_programs (race_id TEXT PRIMARY KEY);");
  db.close();
}

function assertIdentityBlocked(path: string): void {
  const report = readN2EdgeSelectedProgramFeatures({
    primaryDbPath: path,
    selectedCandidates: [candidate()],
  });
  assert.equal(report.status, "BLOCKED");
  assert.deepEqual(report.blockers, ["PRIMARY_SELECTED_PROGRAM_DB_IDENTITY_INVALID"]);
  assert.equal(report.primaryDatabaseReadCount, 0);
  assert.equal(report.rawJsonReadCount, 0);
  assert.deepEqual(report.programs, []);
}

test("selected program reader rejects a primary database leaf symlink before reading private rows", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-edge-selected-leaf-symlink-"));
  try {
    const realPath = join(root, "real.sqlite");
    const aliasPath = join(root, "alias.sqlite");
    createDb(realPath);
    symlinkSync(realPath, aliasPath);
    assertIdentityBlocked(aliasPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("selected program reader rejects a primary database ancestor symlink before reading private rows", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-edge-selected-ancestor-symlink-"));
  try {
    const realDir = join(root, "real");
    const aliasDir = join(root, "alias");
    mkdirSync(realDir);
    const realPath = join(realDir, "primary.sqlite");
    createDb(realPath);
    symlinkSync(realDir, aliasDir, "dir");
    assertIdentityBlocked(join(aliasDir, "primary.sqlite"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("selected program reader rejects a hardlinked primary database before reading private rows", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-edge-selected-hardlink-"));
  try {
    const realPath = join(root, "real.sqlite");
    const hardlinkPath = join(root, "hardlink.sqlite");
    createDb(realPath);
    linkSync(realPath, hardlinkPath);
    assertIdentityBlocked(hardlinkPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
