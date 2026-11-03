import assert from "node:assert/strict";
import { closeSync, fsyncSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { atomicWriteJson, verifyJsonReadback } from "./executorSdk.js";

// Synthetic counterexamples only. These candidates are NOT production or
// research writer implementations and do not authorize recovery.
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Forward Vault alternative publication primitives (negative fixtures)", () => {
  it("rejects exclusive destination creation as an atomic-publication substitute", () => {
    const root = mkdtempSync(join(tmpdir(), "forward-vault-alt-"));
    roots.push(root);
    const path = join(root, "synthetic-record.json");

    // O_EXCL prevents replacement but exposes the destination name BEFORE
    // the writer has finished writing, flushing, or closing the JSON bytes.
    const fd = openSync(path, "wx", 0o600);
    try {
      writeFileSync(fd, '{"recordId":', "utf8");
      fsyncSync(fd);
      assert.equal(readFileSync(path, "utf8"), '{"recordId":');
      const readback = verifyJsonReadback(path);
      assert.equal(readback.ok, false);
      assert.match(readback.errors.join(" "), /readback failed/u);
      assert.throws(() => openSync(path, "wx", 0o600), { code: "EEXIST" });
    } finally {
      closeSync(fd);
    }

    // The failed publication leaves a named incomplete record. This is an
    // availability counterexample, not a real crash or a recovery attempt.
    assert.equal(verifyJsonReadback(path).ok, false);
  });

  it("rejects rename-based publication because it can replace an existing record", () => {
    const root = mkdtempSync(join(tmpdir(), "forward-vault-alt-"));
    roots.push(root);
    const path = join(root, "synthetic-record.json");
    const staged = join(root, "staged.json");
    const original = { recordId: "synthetic-1", version: 1 };
    const conflicting = { recordId: "synthetic-1", version: 2 };

    atomicWriteJson(path, original);
    assert.equal(verifyJsonReadback(path).ok, true);
    assert.throws(() => atomicWriteJson(path, conflicting), /target already exists/u);

    // A plain rename is atomic as a namespace update, but is NOT no-replace.
    // This destructive action is confined to a fresh disposable fixture.
    writeFileSync(staged, `${JSON.stringify(conflicting)}\n`, "utf8");
    renameSync(staged, path);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), conflicting);
    assert.notDeepEqual(JSON.parse(readFileSync(path, "utf8")), original);
    // Structural readback alone does not prove append-only identity.
    assert.equal(verifyJsonReadback(path).ok, true);
  });
});
