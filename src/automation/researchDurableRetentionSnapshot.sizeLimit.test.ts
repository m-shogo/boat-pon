import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { buildResearchDurableKnowledgeCompletenessReport } from "./researchDurableKnowledgeCompleteness";
import {
  buildResearchDurableRetentionSnapshot,
  durableRetentionSnapshotRelativePath,
  persistResearchDurableRetentionSnapshot,
  type ResearchDurableRetentionSnapshot,
} from "./researchDurableRetentionSnapshot";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value == null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]),
  );
}

function withRecomputedDigest(snapshot: ResearchDurableRetentionSnapshot): ResearchDurableRetentionSnapshot {
  const { snapshotDigest: _digest, ...core } = snapshot as ResearchDurableRetentionSnapshot & Record<string, unknown>;
  return {
    ...core,
    snapshotDigest: createHash("sha256").update(JSON.stringify(canonical(core))).digest("hex"),
  } as ResearchDurableRetentionSnapshot;
}

test("retention writer rejects snapshots larger than its reader ceiling before publication", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retention-size-limit-"));
  try {
    const base = buildResearchDurableRetentionSnapshot({
      report: buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root }),
      sourceStateSha: "d".repeat(40),
      mainAuthoritySha: "e".repeat(40),
      firstObservedAt: "2026-08-07T14:00:00.000Z",
    });
    const snapshot = withRecomputedDigest({
      ...base,
      payload: "x".repeat(2_000_001),
    } as unknown as ResearchDurableRetentionSnapshot);
    const relativePath = durableRetentionSnapshotRelativePath(snapshot);

    assert.throws(
      () => persistResearchDurableRetentionSnapshot({ repoRoot: root, snapshot }),
      /DURABLE_RETENTION_SNAPSHOT_TOO_LARGE/u,
    );
    assert.equal(existsSync(join(root, relativePath)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
