import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
