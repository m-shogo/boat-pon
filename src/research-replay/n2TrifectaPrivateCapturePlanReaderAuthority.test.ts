import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readN2TrifectaPrivateCapturePlan } from "./n2TrifectaPrivateCapturePlanReader.js";

function createPrimaryDb(path: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE official_programs (
        race_id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        venue TEXT NOT NULL,
        race_no INTEGER NOT NULL,
        close_at TEXT NOT NULL
      );
      INSERT INTO official_programs(race_id, date, venue, race_no, close_at)
      VALUES ('20260806-05-01', '2026-08-06', '05', 1, '10:05:00');
    `);
  } finally {
    db.close();
  }
}

function read(path: string): void {
  readN2TrifectaPrivateCapturePlan({
    primaryDbPath: path,
    date: "2026-08-06",
    venueCode: "05",
  });
}

test("private capture plan rejects a symlinked primary database authority", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-plan-db-symlink-"));
  try {
    const source = join(root, "primary.sqlite");
    const alias = join(root, "primary-alias.sqlite");
    createPrimaryDb(source);
    symlinkSync(source, alias, "file");

    assert.throws(() => read(alias), /PRIMARY_DB_FILE_AUTHORITY_INVALID/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("private capture plan rejects a primary database reached through a symlinked ancestor", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-plan-db-ancestor-"));
  const external = mkdtempSync(join(tmpdir(), "boat-pon-plan-db-ancestor-external-"));
  try {
    const sourceDir = join(external, "authority");
    mkdirSync(sourceDir, { recursive: true });
    createPrimaryDb(join(sourceDir, "primary.sqlite"));
    symlinkSync(sourceDir, join(root, "authority"), "dir");

    assert.throws(
      () => read(join(root, "authority", "primary.sqlite")),
      /PRIMARY_DB_FILE_AUTHORITY_INVALID/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});

test("private capture plan rejects a hardlinked primary database authority", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-plan-db-hardlink-"));
  try {
    const source = join(root, "primary.sqlite");
    const alias = join(root, "primary-hardlink.sqlite");
    createPrimaryDb(source);
    linkSync(source, alias);

    assert.throws(() => read(alias), /PRIMARY_DB_FILE_AUTHORITY_INVALID/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("private capture plan opens and rechecks the verified lexical primary path", () => {
  const source = readFileSync(new URL("./n2TrifectaPrivateCapturePlanReader.ts", import.meta.url), "utf8");
  assert.match(source, /const db = openImmutable\(before\.path\);/u);
  assert.match(source, /const after = dbMeta\(before\.path\);/u);
  assert.doesNotMatch(source, /openImmutable\(input\.primaryDbPath\)/u);
});
