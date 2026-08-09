import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertGovernanceDirectorySafe,
  listJsonFilesFailClosed,
  readGovernanceFileUtf8,
} from "./safeFs";

function tmp(): string { return mkdtempSync(join(tmpdir(), "gov-fs-")); }

test("governance scan walks only real directories and regular JSON files", () => {
  const root = tmp();
  const nested = join(root, "nested");
  mkdirSync(nested);
  writeFileSync(join(root, "a.json"), "{}\n");
  writeFileSync(join(nested, "b.json"), "{}\n");
  writeFileSync(join(root, "note.txt"), "ok\n");

  assert.deepEqual(listJsonFilesFailClosed(root).sort(), [join(root, "a.json"), join(nested, "b.json")].sort());
});

test("governance scan rejects symlinked directories before traversal", () => {
  const root = tmp();
  const outside = tmp();
  writeFileSync(join(outside, "outside.json"), "{}\n");
  symlinkSync(outside, join(root, "linked"), "dir");

  assert.throws(() => listJsonFilesFailClosed(root), /governance scan symlink forbidden/);
});

test("direct governance directory guard rejects a symlinked root", () => {
  const root = tmp();
  const outside = tmp();
  const linked = join(root, "reports-n2");
  symlinkSync(outside, linked, "dir");

  assert.throws(() => assertGovernanceDirectorySafe(linked), /governance scan symlink forbidden/);
});

test("governance scan rejects symlinked JSON files", () => {
  const root = tmp();
  const outside = join(tmp(), "outside.json");
  writeFileSync(outside, "{}\n");
  symlinkSync(outside, join(root, "linked.json"));

  assert.throws(() => listJsonFilesFailClosed(root), /governance scan symlink forbidden/);
});

test("descriptor-bound governance reads reject hardlinks", () => {
  const root = tmp();
  const source = join(root, "source.json");
  const alias = join(root, "alias.json");
  writeFileSync(source, "{}\n");
  linkSync(source, alias);

  assert.throws(() => readGovernanceFileUtf8(alias), /governance scan hardlink forbidden/);
});
