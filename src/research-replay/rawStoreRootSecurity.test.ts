import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdtempSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RawStore } from "./rawStore";

test("RawStore rejects a symlink root before changing the target mode", () => {
  const parent = mkdtempSync(join(tmpdir(), "boat-pon-raw-root-"));
  const outside = mkdtempSync(join(tmpdir(), "boat-pon-raw-target-"));
  try {
    chmodSync(outside, 0o755);
    const beforeMode = lstatSync(outside).mode & 0o777;
    const root = join(parent, "raw");
    symlinkSync(outside, root);

    assert.throws(() => new RawStore(root), /raw root must not be a symlink/u);
    assert.equal(lstatSync(outside).mode & 0o777, beforeMode);
  } finally {
    rmSync(parent, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("RawStore rejects a root replaced by a symlink after construction", () => {
  const parent = mkdtempSync(join(tmpdir(), "boat-pon-raw-root-swap-"));
  const outside = mkdtempSync(join(tmpdir(), "boat-pon-raw-swap-target-"));
  try {
    const root = join(parent, "raw");
    const store = new RawStore(root);
    renameSync(root, join(parent, "raw-original"));
    symlinkSync(outside, root);

    assert.throws(
      () => store.write({ bytes: Buffer.from("safe"), contentType: "text/plain" }),
      /raw root must not be a symlink/u,
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
