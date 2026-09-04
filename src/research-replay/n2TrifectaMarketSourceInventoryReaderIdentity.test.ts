import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { readN2TrifectaMarketSourceInventory } from "./n2TrifectaMarketSourceInventoryReader";

function createDb(path: string): void {
  const db = new DatabaseSync(path);
  db.close();
}

const identityError = /PRIMARY_DB_IDENTITY_INVALID/;

test("trifecta market inventory reader rejects a leaf symlink primary database", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-trifecta-market-leaf-symlink-"));
  try {
    const target = join(root, "boat.sqlite");
    const alias = join(root, "boat-alias.sqlite");
    createDb(target);
    symlinkSync(target, alias);
    assert.throws(() => readN2TrifectaMarketSourceInventory({ primaryDbPath: alias }), identityError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("trifecta market inventory reader rejects an ancestor symlink primary database", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-trifecta-market-ancestor-symlink-"));
  try {
    const realDir = join(root, "real");
    const aliasDir = join(root, "alias");
    mkdirSync(realDir);
    const target = join(realDir, "boat.sqlite");
    createDb(target);
    symlinkSync(realDir, aliasDir);
    assert.throws(
      () => readN2TrifectaMarketSourceInventory({ primaryDbPath: join(aliasDir, "boat.sqlite") }),
      identityError,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("trifecta market inventory reader rejects a hardlinked primary database", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-trifecta-market-hardlink-"));
  try {
    const target = join(root, "boat.sqlite");
    const hardlink = join(root, "boat-hardlink.sqlite");
    createDb(target);
    linkSync(target, hardlink);
    assert.throws(() => readN2TrifectaMarketSourceInventory({ primaryDbPath: target }), identityError);
    assert.throws(() => readN2TrifectaMarketSourceInventory({ primaryDbPath: hardlink }), identityError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("trifecta market inventory reader opens the verified lexical primary path", () => {
  const source = readFileSync(new URL("./n2TrifectaMarketSourceInventoryReader.ts", import.meta.url), "utf8");
  assert.match(source, /const primaryPath = assertQuiescent\(input\.primaryDbPath\);/u);
  assert.match(source, /const db = openImmutable\(primaryPath\);/u);
  assert.doesNotMatch(source, /openImmutable\(input\.primaryDbPath\)/u);
});
