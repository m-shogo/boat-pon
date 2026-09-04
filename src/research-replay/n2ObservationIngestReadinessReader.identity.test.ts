import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { readN2ObservationIngestReadiness } from "./n2ObservationIngestReadinessReader";

function withTempDir(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-readiness-identity-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writePlaceholder(path: string): void {
  writeFileSync(path, "not-opened-as-sqlite");
}

test("readiness rejects primary leaf symlink before SQLite open", () => {
  withTempDir((root) => {
    const target = join(root, "primary-target.db");
    const primary = join(root, "primary.db");
    const sidecar = join(root, "sidecar.db");
    writePlaceholder(target);
    symlinkSync(target, primary);
    writePlaceholder(sidecar);
    assert.throws(
      () => readN2ObservationIngestReadiness({ primaryDbPath: primary, sidecarDbPath: sidecar }),
      /PRIMARY_DB_IDENTITY_INVALID/,
    );
  });
});

test("readiness rejects primary ancestor alias before SQLite open", () => {
  withTempDir((root) => {
    const realDir = join(root, "real");
    const aliasDir = join(root, "alias");
    mkdirSync(realDir);
    symlinkSync(realDir, aliasDir, "dir");
    const primary = join(aliasDir, "primary.db");
    const sidecar = join(root, "sidecar.db");
    writePlaceholder(join(realDir, "primary.db"));
    writePlaceholder(sidecar);
    assert.throws(
      () => readN2ObservationIngestReadiness({ primaryDbPath: primary, sidecarDbPath: sidecar }),
      /PRIMARY_DB_IDENTITY_INVALID/,
    );
  });
});

test("readiness rejects primary hardlink before SQLite open", () => {
  withTempDir((root) => {
    const target = join(root, "primary-target.db");
    const primary = join(root, "primary.db");
    const sidecar = join(root, "sidecar.db");
    writePlaceholder(target);
    linkSync(target, primary);
    writePlaceholder(sidecar);
    assert.throws(
      () => readN2ObservationIngestReadiness({ primaryDbPath: primary, sidecarDbPath: sidecar }),
      /PRIMARY_DB_IDENTITY_INVALID/,
    );
  });
});

test("readiness rejects sidecar leaf symlink before SQLite open", () => {
  withTempDir((root) => {
    const primary = join(root, "primary.db");
    const target = join(root, "sidecar-target.db");
    const sidecar = join(root, "sidecar.db");
    writePlaceholder(primary);
    writePlaceholder(target);
    symlinkSync(target, sidecar);
    assert.throws(
      () => readN2ObservationIngestReadiness({ primaryDbPath: primary, sidecarDbPath: sidecar }),
      /SIDECAR_IDENTITY_INVALID/,
    );
  });
});

test("readiness rejects sidecar ancestor alias before SQLite open", () => {
  withTempDir((root) => {
    const primary = join(root, "primary.db");
    const realDir = join(root, "real");
    const aliasDir = join(root, "alias");
    mkdirSync(realDir);
    symlinkSync(realDir, aliasDir, "dir");
    const sidecar = join(aliasDir, "sidecar.db");
    writePlaceholder(primary);
    writePlaceholder(join(realDir, "sidecar.db"));
    assert.throws(
      () => readN2ObservationIngestReadiness({ primaryDbPath: primary, sidecarDbPath: sidecar }),
      /SIDECAR_IDENTITY_INVALID/,
    );
  });
});

test("readiness rejects sidecar hardlink before SQLite open", () => {
  withTempDir((root) => {
    const primary = join(root, "primary.db");
    const target = join(root, "sidecar-target.db");
    const sidecar = join(root, "sidecar.db");
    writePlaceholder(primary);
    writePlaceholder(target);
    linkSync(target, sidecar);
    assert.throws(
      () => readN2ObservationIngestReadiness({ primaryDbPath: primary, sidecarDbPath: sidecar }),
      /SIDECAR_IDENTITY_INVALID/,
    );
  });
});
