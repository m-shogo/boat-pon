import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { appendPrivateJsonStore } from "./privateAppendOnlyJsonStore";

const DIGEST = "a".repeat(64);
const FILENAME = "runtime-decision-shadow-fixture.json";
const CONTENTS = `${JSON.stringify({ evidence: { contentDigest: DIGEST }, private: true })}\n`;

function validateFixtureEvidence(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 && record.contentDigest === DIGEST;
}

function appendFixture(directory: string, filename: string, contents = CONTENTS): string {
  return appendPrivateJsonStore({
    directory,
    filename,
    contents,
    expectedEvidenceDigest: DIGEST,
    validateExistingEvidence: validateFixtureEvidence,
  });
}

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-private-store-"));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("private append-only store creates restrictive directory and file modes", () => {
  withRoot((root) => {
    const directory = join(root, "private");
    const path = appendFixture(directory, FILENAME);

    assert.equal(lstatSync(directory).mode & 0o077, 0);
    assert.equal(lstatSync(path).mode & 0o077, 0);
    assert.equal(readFileSync(path, "utf8"), CONTENTS);
  });
});

test("private append-only store accepts a valid evidence replay without replacing the file", () => {
  withRoot((root) => {
    const directory = join(root, "private");
    const first = appendFixture(directory, FILENAME);
    const before = lstatSync(first);
    const second = appendFixture(directory, FILENAME);

    assert.equal(second, first);
    assert.equal(lstatSync(second).ino, before.ino);
  });
});

test("private append-only store rejects forged existing evidence even when the embedded digest matches", () => {
  withRoot((root) => {
    const directory = join(root, "private");
    const path = appendFixture(directory, FILENAME);
    const forged = `${JSON.stringify({ evidence: { contentDigest: DIGEST, tampered: true }, private: true })}\n`;
    writeFileSync(path, forged, { encoding: "utf8", mode: 0o600 });

    assert.throws(
      () => appendFixture(directory, FILENAME),
      /existing evidence is invalid/,
    );
    assert.equal(readFileSync(path, "utf8"), forged);
  });
});

test("private append-only store rejects a permissive pre-existing directory", () => {
  withRoot((root) => {
    const directory = join(root, "private");
    appendFixture(directory, FILENAME);
    chmodSync(directory, 0o755);

    assert.throws(
      () => appendFixture(directory, "second.json"),
      /directory permissions are too broad/,
    );
  });
});

test("private append-only store rejects symlink and permissive existing targets", () => {
  withRoot((root) => {
    const directory = join(root, "private");
    const real = appendFixture(directory, "real.json");

    const symlink = join(directory, FILENAME);
    symlinkSync(real, symlink);
    assert.throws(
      () => appendFixture(directory, FILENAME),
      /symlink is forbidden|unsafe or invalid/,
    );
    rmSync(symlink);

    const permissive = join(directory, FILENAME);
    writeFileSync(permissive, CONTENTS, { mode: 0o644 });
    assert.throws(
      () => appendFixture(directory, FILENAME),
      /permissions are too broad|unsafe or invalid/,
    );
  });
});
