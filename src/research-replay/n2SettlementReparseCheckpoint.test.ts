import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";

import {
  assertN2SettlementReparseCheckpointIdentity,
  assertN2SettlementReparseResumeMode,
  buildN2SettlementReparseCheckpointIdentity,
} from "./n2SettlementReparseCheckpoint";

function withArchiveFiles(run: (files: string[]) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "boat-pon-reparse-checkpoint-"));
  try {
    const first = join(dir, "k260801.lzh");
    const second = join(dir, "k260802.lzh");
    writeFileSync(first, "archive-one");
    writeFileSync(second, "archive-two");
    run([first, second]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function build(
  selectedFiles: string[],
  overrides: Partial<Parameters<typeof buildN2SettlementReparseCheckpointIdentity>[0]> = {},
) {
  return buildN2SettlementReparseCheckpointIdentity({
    reparseSchemaVersion: "n2-settlement-reparse-v2",
    sourceParserVersion: "settlement-v1",
    targetParserVersion: "settlement-v2",
    canonicalizationVersion: "rr-c14n-v1",
    raceIdentityVersion: "race-key-v1",
    asOf: "2026-08-01T00:00:00.000Z",
    mode: "simulated",
    canary: false,
    filesLimit: 20,
    sourcePath: "/repo/data/research-replay.sqlite",
    sourceSidecarSha256: "a".repeat(64),
    targetPath: "/repo/data/tmp/reparse-target.sqlite",
    archiveRoot: "/repo/data/raw/official/results",
    selectedFiles,
    ...overrides,
  });
}

test("reparse checkpoint identity canonicalizes equivalent as-of instants", () => {
  withArchiveFiles((files) => {
    assert.deepEqual(
      build(files, { asOf: "2026-08-01T09:00:00+09:00" }),
      build(files, { asOf: "2026-08-01T00:00:00.000Z" }),
    );
  });
});

test("reparse checkpoint identity resolves CLI basename selections from archive root", () => {
  withArchiveFiles((files) => {
    const archiveRoot = dirname(files[0]);
    assert.deepEqual(
      build(files.map((file) => basename(file)), { archiveRoot }),
      build(files, { archiveRoot }),
    );
  });
});

test("reparse checkpoint identity rejects stale selection and parser lineage", () => {
  withArchiveFiles((files) => {
    const expected = build(files);
    assert.doesNotThrow(() => assertN2SettlementReparseCheckpointIdentity(expected, expected));

    for (const actual of [
      build([files[0]]),
      build(files, { filesLimit: 1 }),
      build(files, { canary: true }),
      build(files, { sourceParserVersion: "settlement-v0" }),
      build(files, { targetParserVersion: "settlement-v3" }),
      build(files, { asOf: "2026-08-02T00:00:00.000Z" }),
      build(files, { sourcePath: "/other/source.sqlite" }),
      build(files, { sourceSidecarSha256: "b".repeat(64) }),
      build(files, { archiveRoot: "/other/archive" }),
    ]) {
      assert.throws(
        () => assertN2SettlementReparseCheckpointIdentity(actual, expected),
        /REPARSE_CHECKPOINT_IDENTITY_MISMATCH/,
      );
    }
  });
});

test("reparse checkpoint identity rejects changed archive bytes under the same filename", () => {
  withArchiveFiles((files) => {
    const expected = build(files);
    writeFileSync(files[0], "archive-one-changed");
    const changed = build(files);
    assert.throws(
      () => assertN2SettlementReparseCheckpointIdentity(changed, expected),
      /REPARSE_CHECKPOINT_IDENTITY_MISMATCH/,
    );
  });
});

test("reparse checkpoint identity rejects duplicate archive basenames", () => {
  withArchiveFiles((files) => {
    const otherDir = mkdtempSync(join(tmpdir(), "boat-pon-reparse-duplicate-"));
    try {
      const duplicate = join(otherDir, "k260801.lzh");
      writeFileSync(duplicate, "different-archive-with-same-name");
      assert.throws(
        () => build([files[0], duplicate]),
        /REPARSE_CHECKPOINT_ARCHIVE_BASENAME_DUPLICATE/,
      );
    } finally {
      rmSync(otherDir, { recursive: true, force: true });
    }
  });
});

test("reparse checkpoint identity rejects ambiguous basename lookup under archive root", () => {
  const archiveRoot = mkdtempSync(join(tmpdir(), "boat-pon-reparse-ambiguous-"));
  try {
    const firstDir = join(archiveRoot, "first");
    const secondDir = join(archiveRoot, "second");
    mkdirSync(firstDir, { recursive: true });
    mkdirSync(secondDir, { recursive: true });
    writeFileSync(join(firstDir, "k260801.lzh"), "archive-one");
    writeFileSync(join(secondDir, "k260801.lzh"), "archive-two");
    assert.throws(
      () => build(["k260801.lzh"], { archiveRoot }),
      /REPARSE_CHECKPOINT_ARCHIVE_BASENAME_AMBIGUOUS/,
    );
  } finally {
    rmSync(archiveRoot, { recursive: true, force: true });
  }
});

test("reparse checkpoint identity rejects impossible timestamps and malformed source digests", () => {
  withArchiveFiles((files) => {
    assert.throws(
      () => build(files, { asOf: "2026-08-01T24:00:00Z" }),
      /timestamp/i,
    );
    assert.throws(
      () => build(files, { sourceSidecarSha256: "not-a-sha" }),
      /REPARSE_CHECKPOINT_SOURCE_SHA_INVALID/,
    );
  });
});

test("reparse resume cannot recreate the target copy", () => {
  assert.doesNotThrow(() => assertN2SettlementReparseResumeMode({ resume: false, makeCopy: true }));
  assert.doesNotThrow(() => assertN2SettlementReparseResumeMode({ resume: true, makeCopy: false }));
  assert.throws(
    () => assertN2SettlementReparseResumeMode({ resume: true, makeCopy: true }),
    /REPARSE_RESUME_MAKE_COPY_CONFLICT/,
  );
});
