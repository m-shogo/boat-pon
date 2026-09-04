import assert from "node:assert/strict";
import {
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

import { readN2TrifectaRealPlanPreflight } from "./n2TrifectaRealPlanPreflight";

const NOW = "2026-09-05T00:00:00.000Z";
const identityError = /PRIMARY_DB_IDENTITY_INVALID/;

function assertIdentityRejected(primaryDbPath: string): void {
  assert.throws(
    () => readN2TrifectaRealPlanPreflight({ primaryDbPath, now: NOW, executionLocation: "fixture" }),
    identityError,
  );
}

test("real-plan preflight rejects a leaf symlink before opening the primary database", () => {
  const dir = mkdtempSync(join(tmpdir(), "boat-pon-real-plan-leaf-"));
  try {
    const target = join(dir, "target.sqlite");
    const alias = join(dir, "alias.sqlite");
    writeFileSync(target, "not-opened");
    symlinkSync(target, alias);
    assertIdentityRejected(alias);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real-plan preflight rejects an ancestor symlink before opening the primary database", () => {
  const dir = mkdtempSync(join(tmpdir(), "boat-pon-real-plan-ancestor-"));
  try {
    const actualDir = join(dir, "actual");
    const aliasDir = join(dir, "alias");
    mkdirSync(actualDir);
    writeFileSync(join(actualDir, "primary.sqlite"), "not-opened");
    symlinkSync(actualDir, aliasDir, "dir");
    assertIdentityRejected(join(aliasDir, "primary.sqlite"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real-plan preflight rejects a hard-linked primary database before opening it", () => {
  const dir = mkdtempSync(join(tmpdir(), "boat-pon-real-plan-hardlink-"));
  try {
    const target = join(dir, "target.sqlite");
    const alias = join(dir, "alias.sqlite");
    writeFileSync(target, "not-opened");
    linkSync(target, alias);
    assertIdentityRejected(alias);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
