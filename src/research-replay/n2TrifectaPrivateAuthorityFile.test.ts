import assert from "node:assert/strict";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readN2TrifectaPrivateAuthorityJson } from "./n2TrifectaPrivateAuthorityFile.js";

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-private-authority-file-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("local private authority reader accepts owner-only JSON", () => {
  withRoot((root) => {
    const path = join(root, "authority.json");
    writeFileSync(path, "{\"ok\":true}\n", { encoding: "utf8", mode: 0o600 });
    assert.deepEqual(
      readN2TrifectaPrivateAuthorityJson<{ ok: boolean }>(path, "AUTHORITY_MISSING"),
      { ok: true },
    );
  });
});

test("local private authority reader rejects a permissive file before parsing it", () => {
  withRoot((root) => {
    const path = join(root, "authority.json");
    writeFileSync(path, "{\"ok\":true}\n", { encoding: "utf8", mode: 0o600 });
    chmodSync(path, 0o644);
    assert.throws(
      () => readN2TrifectaPrivateAuthorityJson(path, "AUTHORITY_MISSING"),
      /LOCAL_CAPTURE_PRIVATE_AUTHORITY_FILE_MODE_INVALID/,
    );
  });
});

test("local private authority reader rejects a hardlinked owner-only file", () => {
  withRoot((root) => {
    const sourcePath = join(root, "authority-source.json");
    const authorityPath = join(root, "authority.json");
    writeFileSync(sourcePath, "{\"ok\":true}\n", { encoding: "utf8", mode: 0o600 });
    linkSync(sourcePath, authorityPath);
    assert.throws(
      () => readN2TrifectaPrivateAuthorityJson(authorityPath, "AUTHORITY_MISSING"),
      /LOCAL_CAPTURE_PRIVATE_AUTHORITY_HARDLINK_NOT_ALLOWED/,
    );
  });
});

test("local private authority reader rejects a symlinked leaf", () => {
  withRoot((root) => {
    const sourcePath = join(root, "authority-source.json");
    const authorityPath = join(root, "authority.json");
    writeFileSync(sourcePath, "{\"ok\":true}\n", { encoding: "utf8", mode: 0o600 });
    symlinkSync(sourcePath, authorityPath, "file");
    assert.throws(
      () => readN2TrifectaPrivateAuthorityJson(authorityPath, "AUTHORITY_MISSING"),
      /LOCAL_CAPTURE_PRIVATE_AUTHORITY_SYMLINK_NOT_ALLOWED/,
    );
  });
});

test("local private authority reader rejects a symlinked ancestor under the trusted root", () => {
  withRoot((root) => {
    const external = mkdtempSync(join(tmpdir(), "boat-pon-private-authority-external-"));
    try {
      mkdirSync(join(root, "data/private"), { recursive: true, mode: 0o700 });
      writeFileSync(join(external, "authorization.json"), "{\"ok\":true}\n", {
        encoding: "utf8",
        mode: 0o600,
      });
      symlinkSync(external, join(root, "data/private/trifecta-capture"), "dir");
      const authorityPath = join(root, "data/private/trifecta-capture/authorization.json");

      assert.throws(
        () => readN2TrifectaPrivateAuthorityJson(authorityPath, "AUTHORITY_MISSING", root),
        /LOCAL_CAPTURE_PRIVATE_AUTHORITY_PARENT_INVALID/,
      );
    } finally {
      rmSync(external, { recursive: true, force: true });
    }
  });
});

test("local private authority reader rejects paths outside the trusted root", () => {
  withRoot((root) => {
    const external = mkdtempSync(join(tmpdir(), "boat-pon-private-authority-outside-"));
    try {
      const authorityPath = join(external, "authorization.json");
      writeFileSync(authorityPath, "{\"ok\":true}\n", { encoding: "utf8", mode: 0o600 });
      assert.throws(
        () => readN2TrifectaPrivateAuthorityJson(authorityPath, "AUTHORITY_MISSING", root),
        /LOCAL_CAPTURE_PRIVATE_AUTHORITY_PATH_OUTSIDE_TRUSTED_ROOT/,
      );
    } finally {
      rmSync(external, { recursive: true, force: true });
    }
  });
});
