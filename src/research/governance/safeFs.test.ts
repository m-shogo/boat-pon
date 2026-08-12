import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertGovernanceDirectorySafe,
  listJsonFilesFailClosed,
  readGovernanceFileUtf8,
  readGovernanceFileUtf8Bounded,
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

test("governance directory guard rejects cwd-contained parent symlinks", (t) => {
  const root = mkdtempSync(join(process.cwd(), ".gov-fs-dir-parent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const outside = tmp();
  const nested = join(outside, "history");
  mkdirSync(nested);
  const aliasDir = join(root, "linked");
  symlinkSync(outside, aliasDir, "dir");

  assert.throws(
    () => assertGovernanceDirectorySafe(join(aliasDir, "history")),
    /governance scan parent symlink forbidden/,
  );
});

test("trusted-root directory guards reject parent symlinks outside cwd", () => {
  const root = tmp();
  const outside = tmp();
  mkdirSync(join(outside, "history"));
  const aliasDir = join(root, "linked");
  symlinkSync(outside, aliasDir, "dir");

  assert.throws(
    () => assertGovernanceDirectorySafe(join(aliasDir, "history"), root),
    /governance scan parent symlink forbidden/,
  );
});

test("governance scan rejects symlinked JSON files", () => {
  const root = tmp();
  const outside = join(tmp(), "outside.json");
  writeFileSync(outside, "{}\n");
  symlinkSync(outside, join(root, "linked.json"));

  assert.throws(() => listJsonFilesFailClosed(root), /governance scan symlink forbidden/);
});

test("descriptor-bound governance reads reject symlinks", () => {
  const root = tmp();
  const outside = join(tmp(), "outside.json");
  const alias = join(root, "alias.json");
  writeFileSync(outside, "{}\n");
  symlinkSync(outside, alias);

  assert.throws(() => readGovernanceFileUtf8(alias), /governance scan symlink forbidden/);
});

test("descriptor-bound governance reads reject cwd-contained parent symlinks", (t) => {
  const root = mkdtempSync(join(process.cwd(), ".gov-fs-parent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const outside = tmp();
  writeFileSync(join(outside, "outside.json"), "{}\n");
  const aliasDir = join(root, "linked");
  symlinkSync(outside, aliasDir, "dir");

  assert.throws(
    () => readGovernanceFileUtf8Bounded(join(aliasDir, "outside.json"), 1024),
    /governance scan parent symlink forbidden/,
  );
});

test("trusted-root reads reject parent symlinks even when the root is outside cwd", () => {
  const root = tmp();
  const outside = tmp();
  writeFileSync(join(outside, "outside.json"), "{}\n");
  const aliasDir = join(root, "linked");
  symlinkSync(outside, aliasDir, "dir");

  assert.throws(
    () => readGovernanceFileUtf8Bounded(join(aliasDir, "outside.json"), 1024, root),
    /governance scan parent symlink forbidden/,
  );
});

test("trusted-root reads reject targets outside the trusted root", () => {
  const root = tmp();
  const outside = join(tmp(), "outside.json");
  writeFileSync(outside, "{}\n");

  assert.throws(
    () => readGovernanceFileUtf8Bounded(outside, 1024, root),
    /governance scan path outside trusted root/,
  );
});

test("trusted-root reads allow regular descendants without inspecting ambient parents", () => {
  const root = tmp();
  const nested = join(root, "reports", "history");
  mkdirSync(nested, { recursive: true });
  const path = join(nested, "run.json");
  writeFileSync(path, "{}\n");

  assert.deepEqual(readGovernanceFileUtf8Bounded(path, 1024, root), { text: "{}\n", bytes: 3 });
});

test("descriptor-bound governance reads reject hardlinks", () => {
  const root = tmp();
  const source = join(root, "source.json");
  const alias = join(root, "alias.json");
  writeFileSync(source, "{}\n");
  linkSync(source, alias);

  assert.throws(() => readGovernanceFileUtf8(alias), /governance scan hardlink forbidden/);
});

test("descriptor-bound governance reads reject malformed UTF-8", () => {
  const root = tmp();
  const path = join(root, "invalid.json");
  writeFileSync(path, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]));

  assert.throws(() => readGovernanceFileUtf8(path), /governance scan invalid utf8/);
  assert.throws(() => readGovernanceFileUtf8Bounded(path, 10), /governance scan invalid utf8/);
});

test("bounded descriptor reads enforce the opened inode byte limit", () => {
  const root = tmp();
  const path = join(root, "bounded.json");
  writeFileSync(path, "12345", "utf8");

  assert.deepEqual(readGovernanceFileUtf8Bounded(path, 5), { text: "12345", bytes: 5 });
  assert.throws(() => readGovernanceFileUtf8Bounded(path, 4), /governance scan file exceeds byte limit/);
});
