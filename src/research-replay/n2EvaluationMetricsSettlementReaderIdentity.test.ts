import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readN2EvaluationMetricsSettlements } from "./n2EvaluationMetricsSettlementReader.js";

const RACE_KEY = "2026-08-06:05:R1";

function createDb(path: string): void {
  const db = new DatabaseSync(path);
  db.close();
}

function read(path: string) {
  return readN2EvaluationMetricsSettlements({ sidecarDbPath: path, raceKeys: [RACE_KEY] });
}

function assertIdentityBlocked(path: string): void {
  const report = read(path);
  assert.equal(report.status, "BLOCKED");
  assert.deepEqual(report.blockers, ["SIDECAR_DB_IDENTITY_INVALID"]);
  assert.equal(report.databaseReadCount, 0);
  assert.equal(report.databaseWriteCount, 0);
  assert.equal(report.networkRequestCount, 0);
}

test("evaluation settlement reader rejects a leaf symlink sidecar before database reads", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-eval-settlement-leaf-symlink-"));
  try {
    const target = join(root, "sidecar.sqlite");
    const alias = join(root, "sidecar-alias.sqlite");
    createDb(target);
    symlinkSync(target, alias, "file");
    assertIdentityBlocked(alias);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("evaluation settlement reader rejects an ancestor symlink sidecar before database reads", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-eval-settlement-ancestor-symlink-"));
  const external = mkdtempSync(join(tmpdir(), "n2-eval-settlement-ancestor-external-"));
  try {
    const authority = join(external, "authority");
    mkdirSync(authority, { recursive: true });
    createDb(join(authority, "sidecar.sqlite"));
    symlinkSync(authority, join(root, "authority"), "dir");
    assertIdentityBlocked(join(root, "authority", "sidecar.sqlite"));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});

test("evaluation settlement reader rejects a hardlinked sidecar before database reads", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-eval-settlement-hardlink-"));
  try {
    const target = join(root, "sidecar.sqlite");
    const alias = join(root, "sidecar-hardlink.sqlite");
    createDb(target);
    linkSync(target, alias);
    assertIdentityBlocked(target);
    assertIdentityBlocked(alias);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
