import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertCanonicalSingleLinkRegularFile } from "./researchFileIdentity";

const ERROR = "RESEARCH_FILE_IDENTITY_INVALID";

test("canonical file identity accepts a regular single-link file", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-file-identity-"));
  try {
    const path = join(root, "data.sqlite");
    writeFileSync(path, "ok", "utf8");
    assert.equal(assertCanonicalSingleLinkRegularFile(path, ERROR), path);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical file identity rejects a leaf symlink", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-file-identity-leaf-"));
  try {
    const realPath = join(root, "real.sqlite");
    const aliasPath = join(root, "alias.sqlite");
    writeFileSync(realPath, "ok", "utf8");
    symlinkSync(realPath, aliasPath);
    assert.throws(() => assertCanonicalSingleLinkRegularFile(aliasPath, ERROR), new RegExp(ERROR));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical file identity rejects an ancestor symlink", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-file-identity-ancestor-"));
  try {
    const realDir = join(root, "real");
    const aliasDir = join(root, "alias");
    mkdirSync(realDir);
    const realPath = join(realDir, "data.sqlite");
    writeFileSync(realPath, "ok", "utf8");
    symlinkSync(realDir, aliasDir, "dir");
    assert.throws(() => assertCanonicalSingleLinkRegularFile(join(aliasDir, "data.sqlite"), ERROR), new RegExp(ERROR));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical file identity rejects a hardlink", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-file-identity-hardlink-"));
  try {
    const realPath = join(root, "real.sqlite");
    const hardlinkPath = join(root, "hardlink.sqlite");
    writeFileSync(realPath, "ok", "utf8");
    linkSync(realPath, hardlinkPath);
    assert.throws(() => assertCanonicalSingleLinkRegularFile(hardlinkPath, ERROR), new RegExp(ERROR));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
