import assert from "node:assert/strict";
import { closeSync, linkSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readN2EdgeHoldoutSource } from "./n2EdgeHoldoutSource";

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-edge-holdout-identity-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function touch(path: string): void {
  closeSync(openSync(path, "w"));
}

function assertSidecarIdentityBlocked(sidecarDbPath: string): void {
  const result = readN2EdgeHoldoutSource({
    primaryDbPath: join(dirname(sidecarDbPath), "must-not-be-read.sqlite"),
    sidecarDbPath,
  });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.blockers, ["SIDECAR_HOLDOUT_DB_IDENTITY_INVALID"]);
  assert.equal(result.reads.sidecarDatabaseReadCount, 0);
  assert.equal(result.reads.primaryDatabaseReadCount, 0);
}

test("edge holdout source rejects a sidecar leaf symlink before any database read", () => {
  withRoot((root) => {
    const real = join(root, "real.sqlite");
    const alias = join(root, "alias.sqlite");
    touch(real);
    symlinkSync(real, alias);
    assertSidecarIdentityBlocked(alias);
  });
});

test("edge holdout source rejects a sidecar ancestor symlink before any database read", () => {
  withRoot((root) => {
    const realDir = join(root, "real");
    const aliasDir = join(root, "alias");
    const real = join(realDir, "sidecar.sqlite");
    const { mkdirSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(realDir);
    touch(real);
    symlinkSync(realDir, aliasDir);
    assertSidecarIdentityBlocked(join(aliasDir, "sidecar.sqlite"));
  });
});

test("edge holdout source rejects a hard-linked sidecar before any database read", () => {
  withRoot((root) => {
    const real = join(root, "real.sqlite");
    const linked = join(root, "linked.sqlite");
    touch(real);
    linkSync(real, linked);
    assertSidecarIdentityBlocked(linked);
  });
});

test("edge holdout primary open is bound to the same filesystem identity guard", () => {
  const sourcePath = fileURLToPath(new URL("./n2EdgeHoldoutSource.ts", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");
  assert.match(
    source,
    /function openPrimary\(path: string\): DatabaseSync \{\s+const lexicalPath = verifiedDatabasePath\(path, "PRIMARY_HOLDOUT_DB_IDENTITY_INVALID"\);/u,
  );
  assert.match(
    source,
    /function openSidecar\(path: string\): DatabaseSync \{\s+const lexicalPath = verifiedDatabasePath\(path, "SIDECAR_HOLDOUT_DB_IDENTITY_INVALID"\);/u,
  );
});
