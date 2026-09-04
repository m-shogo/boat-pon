import assert from "node:assert/strict";
import { closeSync, linkSync, mkdirSync, mkdtempSync, openSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openN2CoverageDbImmutable } from "./n2FeatureCoverageReader";

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-coverage-identity-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function touch(path: string): void {
  closeSync(openSync(path, "w"));
}

function assertIdentityBlocked(path: string): void {
  assert.throws(
    () => openN2CoverageDbImmutable(path),
    (error: unknown) => error instanceof Error && error.message === "N2_COVERAGE_DB_IDENTITY_INVALID",
  );
}

test("coverage immutable DB open rejects a leaf symlink", () => {
  withRoot((root) => {
    const real = join(root, "real.sqlite");
    const alias = join(root, "alias.sqlite");
    touch(real);
    symlinkSync(real, alias);
    assertIdentityBlocked(alias);
  });
});

test("coverage immutable DB open rejects an ancestor symlink", () => {
  withRoot((root) => {
    const realDir = join(root, "real");
    const aliasDir = join(root, "alias");
    mkdirSync(realDir);
    const real = join(realDir, "coverage.sqlite");
    touch(real);
    symlinkSync(realDir, aliasDir);
    assertIdentityBlocked(join(aliasDir, "coverage.sqlite"));
  });
});

test("coverage immutable DB open rejects a hardlink", () => {
  withRoot((root) => {
    const real = join(root, "real.sqlite");
    const linked = join(root, "linked.sqlite");
    touch(real);
    linkSync(real, linked);
    assertIdentityBlocked(linked);
  });
});
