import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readN2PitAuditObservations } from "./n2PitAuditReader";

function createDatabase(path: string): void {
  const db = new DatabaseSync(path);
  db.close();
}

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "n2-pit-audit-db-identity-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("pit audit rejects primary leaf symlink, ancestor alias, and hardlink before SQLite reads", () => {
  for (const kind of ["leaf-symlink", "ancestor-alias", "hardlink"] as const) {
    withRoot((root) => {
      const sidecar = join(root, "sidecar.sqlite");
      createDatabase(sidecar);
      const realPrimary = join(root, "real-primary.sqlite");
      createDatabase(realPrimary);
      let primary: string;
      if (kind === "leaf-symlink") {
        primary = join(root, "primary-alias.sqlite");
        symlinkSync(realPrimary, primary);
      } else if (kind === "hardlink") {
        primary = join(root, "primary-hardlink.sqlite");
        linkSync(realPrimary, primary);
      } else {
        const realDir = join(root, "real-primary-dir");
        mkdirSync(realDir);
        const nestedPrimary = join(realDir, "primary.sqlite");
        createDatabase(nestedPrimary);
        const aliasDir = join(root, "primary-dir-alias");
        symlinkSync(realDir, aliasDir, "dir");
        primary = join(aliasDir, "primary.sqlite");
      }
      assert.throws(
        () => readN2PitAuditObservations({ primaryDbPath: primary, sidecarDbPath: sidecar }),
        /N2_PIT_AUDIT_PRIMARY_DB_IDENTITY_INVALID/,
        kind,
      );
    });
  }
});

test("pit audit rejects sidecar leaf symlink, ancestor alias, and hardlink before sidecar queries", () => {
  for (const kind of ["leaf-symlink", "ancestor-alias", "hardlink"] as const) {
    withRoot((root) => {
      const primary = join(root, "primary.sqlite");
      createDatabase(primary);
      const realSidecar = join(root, "real-sidecar.sqlite");
      createDatabase(realSidecar);
      let sidecar: string;
      if (kind === "leaf-symlink") {
        sidecar = join(root, "sidecar-alias.sqlite");
        symlinkSync(realSidecar, sidecar);
      } else if (kind === "hardlink") {
        sidecar = join(root, "sidecar-hardlink.sqlite");
        linkSync(realSidecar, sidecar);
      } else {
        const realDir = join(root, "real-sidecar-dir");
        mkdirSync(realDir);
        const nestedSidecar = join(realDir, "sidecar.sqlite");
        createDatabase(nestedSidecar);
        const aliasDir = join(root, "sidecar-dir-alias");
        symlinkSync(realDir, aliasDir, "dir");
        sidecar = join(aliasDir, "sidecar.sqlite");
      }
      assert.throws(
        () => readN2PitAuditObservations({ primaryDbPath: primary, sidecarDbPath: sidecar }),
        /N2_PIT_AUDIT_SIDECAR_DB_IDENTITY_INVALID/,
        kind,
      );
    });
  }
});
