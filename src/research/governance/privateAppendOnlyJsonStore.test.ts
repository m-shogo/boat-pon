import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { appendPrivateJsonStore } from "./privateAppendOnlyJsonStore";

const DIGEST = "a".repeat(64);
const FILENAME = "runtime-decision-shadow-fixture.json";
const CONTENTS = `${JSON.stringify({ evidence: { contentDigest: DIGEST }, private: true })}\n`;

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-private-store-"));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("private append-only store creates restrictive directory and file modes", () => {
  withRoot((root) => {
    const directory = join(root, "private");
    const path = appendPrivateJsonStore({
      directory,
      filename: FILENAME,
      contents: CONTENTS,
      expectedEvidenceDigest: DIGEST,
    });

    assert.equal(lstatSync(directory).mode & 0o077, 0);
    assert.equal(lstatSync(path).mode & 0o077, 0);
    assert.equal(readFileSync(path, "utf8"), CONTENTS);
  });
});

test("private append-only store accepts an exact evidence replay without replacing the file", () => {
  withRoot((root) => {
    const directory = join(root, "private");
    const first = appendPrivateJsonStore({
      directory,
      filename: FILENAME,
      contents: CONTENTS,
      expectedEvidenceDigest: DIGEST,
    });
    const before = lstatSync(first);
    const second = appendPrivateJsonStore({
      directory,
      filename: FILENAME,
      contents: CONTENTS,
      expectedEvidenceDigest: DIGEST,
    });

    assert.equal(second, first);
    assert.equal(lstatSync(second).ino, before.ino);
  });
});

test("private append-only store rejects altered replay bytes even when the embedded digest matches", () => {
  withRoot((root) => {
    const directory = join(root, "private");
    appendPrivateJsonStore({
      directory,
      filename: FILENAME,
      contents: CONTENTS,
      expectedEvidenceDigest: DIGEST,
    });
    const altered = `${JSON.stringify({ evidence: { contentDigest: DIGEST }, private: false })}\n`;

    assert.throws(
      () => appendPrivateJsonStore({ directory, filename: FILENAME, contents: altered, expectedEvidenceDigest: DIGEST }),
      /existing evidence differs/,
    );
    assert.equal(readFileSync(join(directory, FILENAME), "utf8"), CONTENTS);
  });
});

test("private append-only store rejects a permissive pre-existing directory", () => {
  withRoot((root) => {
    const directory = join(root, "private");
    appendPrivateJsonStore({ directory, filename: FILENAME, contents: CONTENTS, expectedEvidenceDigest: DIGEST });
    chmodSync(directory, 0o755);

    assert.throws(
      () => appendPrivateJsonStore({ directory, filename: "second.json", contents: CONTENTS, expectedEvidenceDigest: DIGEST }),
      /directory permissions are too broad/,
    );
  });
});

test("private append-only store rejects symlink and permissive existing targets", () => {
  withRoot((root) => {
    const directory = join(root, "private");
    const real = appendPrivateJsonStore({
      directory,
      filename: "real.json",
      contents: CONTENTS,
      expectedEvidenceDigest: DIGEST,
    });

    const symlink = join(directory, FILENAME);
    symlinkSync(real, symlink);
    assert.throws(
      () => appendPrivateJsonStore({ directory, filename: FILENAME, contents: CONTENTS, expectedEvidenceDigest: DIGEST }),
      /symlink is forbidden|unsafe or invalid/,
    );
    rmSync(symlink);

    const permissive = join(directory, FILENAME);
    writeFileSync(permissive, CONTENTS, { mode: 0o644 });
    assert.throws(
      () => appendPrivateJsonStore({ directory, filename: FILENAME, contents: CONTENTS, expectedEvidenceDigest: DIGEST }),
      /permissions are too broad|unsafe or invalid/,
    );
  });
});
