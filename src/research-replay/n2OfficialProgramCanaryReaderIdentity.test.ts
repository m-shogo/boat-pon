import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { readOfficialProgramCanarySource } from "./n2OfficialProgramCanaryReader";

function createDb(path: string): void {
  const db = new DatabaseSync(path);
  db.close();
}

const identityError = /PRIMARY_DB_IDENTITY_INVALID/;

test("official program canary reader rejects a leaf symlink primary database", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-program-canary-leaf-symlink-"));
  try {
    const target = join(root, "boat.sqlite");
    const alias = join(root, "boat-alias.sqlite");
    createDb(target);
    symlinkSync(target, alias);
    assert.throws(() => readOfficialProgramCanarySource({ primaryDbPath: alias }), identityError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("official program canary reader rejects an ancestor symlink primary database", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-program-canary-ancestor-symlink-"));
  try {
    const realDir = join(root, "real");
    const aliasDir = join(root, "alias");
    mkdirSync(realDir);
    const target = join(realDir, "boat.sqlite");
    createDb(target);
    symlinkSync(realDir, aliasDir);
    assert.throws(
      () => readOfficialProgramCanarySource({ primaryDbPath: join(aliasDir, "boat.sqlite") }),
      identityError,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("official program canary reader rejects a hardlinked primary database", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-program-canary-hardlink-"));
  try {
    const target = join(root, "boat.sqlite");
    const hardlink = join(root, "boat-hardlink.sqlite");
    createDb(target);
    linkSync(target, hardlink);
    assert.throws(() => readOfficialProgramCanarySource({ primaryDbPath: target }), identityError);
    assert.throws(() => readOfficialProgramCanarySource({ primaryDbPath: hardlink }), identityError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("official program canary reader opens the verified lexical primary path", () => {
  const source = readFileSync(new URL("./n2OfficialProgramCanaryReader.ts", import.meta.url), "utf8");
  assert.match(source, /const primaryPath = assertQuiescent\(input\.primaryDbPath\);/u);
  assert.match(source, /const primary = openImmutable\(primaryPath\);/u);
  assert.doesNotMatch(source, /openImmutable\(input\.primaryDbPath\)/u);
});
