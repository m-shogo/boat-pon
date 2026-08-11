import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { verifyJsonReadback } from "./executorSdk";

const DIGEST = "d".repeat(64);
const CONTENT = `${JSON.stringify({ outputDigest: DIGEST })}\n`;

test("JSON readback rejects symlink aliases even when digest matches", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-sdk-readback-symlink-"));
  const outside = mkdtempSync(join(tmpdir(), "boat-pon-sdk-readback-outside-"));
  try {
    const target = join(outside, "artifact.json");
    writeFileSync(target, CONTENT, "utf8");
    const alias = join(root, "artifact.json");
    symlinkSync(target, alias);

    const result = verifyJsonReadback(alias, DIGEST);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("symlink forbidden")));
  } finally {
    rmSync(outside, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("JSON readback rejects hardlink aliases even when digest matches", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-sdk-readback-hardlink-"));
  const outside = mkdtempSync(join(tmpdir(), "boat-pon-sdk-readback-outside-"));
  try {
    const target = join(outside, "artifact.json");
    writeFileSync(target, CONTENT, "utf8");
    const alias = join(root, "artifact.json");
    linkSync(target, alias);

    const result = verifyJsonReadback(alias, DIGEST);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("single-link regular file")));
  } finally {
    rmSync(outside, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("JSON readback rejects a symlinked parent directory", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-sdk-readback-parent-"));
  const outside = mkdtempSync(join(tmpdir(), "boat-pon-sdk-readback-parent-outside-"));
  try {
    const realParent = join(outside, "retained");
    mkdirSync(realParent);
    writeFileSync(join(realParent, "artifact.json"), CONTENT, "utf8");
    const linkedParent = join(root, "retained");
    symlinkSync(realParent, linkedParent, "dir");

    const result = verifyJsonReadback(join(linkedParent, "artifact.json"), DIGEST);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("parent path must be a real directory")));
  } finally {
    rmSync(outside, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
