import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { atomicWriteJson } from "./executorSdk";

test("append-only atomic write never replaces an existing target", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-sdk-atomic-create-"));
  try {
    const path = join(root, "artifact.json");
    atomicWriteJson(path, { generation: 1 });
    assert.throws(
      () => atomicWriteJson(path, { generation: 2 }),
      /target already exists/u,
    );
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { generation: 1 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("explicit replace remains available for mutable executor artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-sdk-atomic-replace-"));
  try {
    const path = join(root, "artifact.json");
    atomicWriteJson(path, { generation: 1 });
    atomicWriteJson(path, { generation: 2 }, true);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { generation: 2 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("atomic write rejects a symlinked parent directory", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-sdk-parent-symlink-"));
  const outside = mkdtempSync(join(tmpdir(), "boat-pon-sdk-parent-symlink-outside-"));
  try {
    const linkedParent = join(root, "retained");
    symlinkSync(outside, linkedParent, "dir");
    const path = join(linkedParent, "artifact.json");

    assert.throws(
      () => atomicWriteJson(path, { generation: 1 }),
      /parent path must be a real directory/u,
    );
    assert.equal(existsSync(join(outside, "artifact.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
