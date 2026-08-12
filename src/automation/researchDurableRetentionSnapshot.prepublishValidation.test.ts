import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildResearchDurableKnowledgeCompletenessReport } from "./researchDurableKnowledgeCompleteness";
import {
  buildResearchDurableRetentionSnapshot,
  durableRetentionSnapshotRelativePath,
  persistResearchDurableRetentionSnapshot,
  type ResearchDurableRetentionSnapshot,
} from "./researchDurableRetentionSnapshot";

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  const object = objectValue(value);
  if (!object) return value;
  return Object.fromEntries(
    Object.entries(object)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]),
  );
}

function withValidSelfDigest(snapshot: ResearchDurableRetentionSnapshot): ResearchDurableRetentionSnapshot {
  const { snapshotDigest: _snapshotDigest, ...core } = snapshot;
  return {
    ...snapshot,
    snapshotDigest: createHash("sha256").update(JSON.stringify(canonical(core))).digest("hex"),
  };
}

test("invalid retention snapshots are rejected before append-only publication", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retention-prepublish-"));
  try {
    const report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });
    const snapshot = buildResearchDurableRetentionSnapshot({
      report,
      sourceStateSha: "d".repeat(40),
      mainAuthoritySha: "e".repeat(40),
      firstObservedAt: "2026-08-07T14:00:00.000Z",
    });
    const invalid = {
      ...snapshot,
      snapshotDigest: "0".repeat(64),
    } as ResearchDurableRetentionSnapshot;
    const relativePath = durableRetentionSnapshotRelativePath(invalid);

    assert.throws(
      () => persistResearchDurableRetentionSnapshot({ repoRoot: root, snapshot: invalid }),
      /DURABLE_RETENTION_SNAPSHOT_SELF_DIGEST_INVALID/u,
    );
    assert.equal(existsSync(join(root, relativePath)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("self-digest-valid retention snapshots with impossible counts are rejected before publication", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retention-counts-"));
  try {
    const report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });
    const snapshot = buildResearchDurableRetentionSnapshot({
      report,
      sourceStateSha: "d".repeat(40),
      mainAuthoritySha: "e".repeat(40),
      firstObservedAt: "2026-08-07T14:00:00.000Z",
    });
    const invalid = withValidSelfDigest({
      ...snapshot,
      strongDurableCompleteCount: snapshot.durableCompleteCount + 1,
    });
    const relativePath = durableRetentionSnapshotRelativePath(invalid);

    assert.throws(
      () => persistResearchDurableRetentionSnapshot({ repoRoot: root, snapshot: invalid }),
      /DURABLE_RETENTION_STRONG_COUNT_INVALID/u,
    );
    assert.equal(existsSync(join(root, relativePath)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
