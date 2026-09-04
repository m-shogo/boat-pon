import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { readLifecycleValidApprovalScopes } from "./n2ObservationIngestApprovalScopes";

function createAuthorityDb(path: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE rollout_approval_grants_v2 (
        approval_id TEXT NOT NULL,
        approval_scope TEXT NOT NULL,
        approval_source TEXT NOT NULL,
        approval_reference TEXT NOT NULL,
        target_stage TEXT NOT NULL,
        target_schema_version TEXT NOT NULL,
        target_contract_version TEXT NOT NULL,
        approved_at TEXT NOT NULL,
        approval_mode TEXT NOT NULL,
        content_hash TEXT NOT NULL
      );
      CREATE TABLE rollout_approval_lifecycle_events_v2 (
        lifecycle_event_id TEXT NOT NULL,
        event_kind TEXT NOT NULL,
        subject_approval_id TEXT NOT NULL,
        replacement_approval_id TEXT,
        reason TEXT NOT NULL,
        source TEXT NOT NULL,
        reference TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        content_hash TEXT NOT NULL
      );
    `);
  } finally {
    db.close();
  }
}

const identityError = /N2_READINESS_APPROVAL_SIDECAR_IDENTITY_INVALID/;

test("approval scope reader rejects a leaf symlink authority database", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-approval-sidecar-leaf-symlink-"));
  try {
    const target = join(root, "authority.sqlite");
    const alias = join(root, "authority-alias.sqlite");
    createAuthorityDb(target);
    symlinkSync(target, alias);
    assert.throws(() => readLifecycleValidApprovalScopes(alias), identityError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("approval scope reader rejects an ancestor symlink authority database", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-approval-sidecar-ancestor-symlink-"));
  try {
    const realDir = join(root, "real");
    const aliasDir = join(root, "alias");
    mkdirSync(realDir);
    const target = join(realDir, "authority.sqlite");
    createAuthorityDb(target);
    symlinkSync(realDir, aliasDir);
    assert.throws(() => readLifecycleValidApprovalScopes(join(aliasDir, "authority.sqlite")), identityError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("approval scope reader rejects a hardlinked authority database", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-approval-sidecar-hardlink-"));
  try {
    const target = join(root, "authority.sqlite");
    const hardlink = join(root, "authority-hardlink.sqlite");
    createAuthorityDb(target);
    linkSync(target, hardlink);
    assert.throws(() => readLifecycleValidApprovalScopes(target), identityError);
    assert.throws(() => readLifecycleValidApprovalScopes(hardlink), identityError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
