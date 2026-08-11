import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
