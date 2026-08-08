import { createHash } from "node:crypto";

import type { ResearchDurableKnowledgeCompletenessReportWithRetainedInventory } from "./researchDurableKnowledgeRetainedInventory";
import {
  buildResearchDurableRetentionSnapshot,
  persistResearchDurableRetentionSnapshot,
  type ResearchDurableRetentionPersistResult,
  type ResearchDurableRetentionSnapshot,
} from "./researchDurableRetentionSnapshot";

export type ResearchDurableRetentionSnapshotWithRetainedInventory = ResearchDurableRetentionSnapshot & {
  retainedOutputFileCount: number;
  retainedOutputBytes: number;
  referencedRetainedOutputCount: number;
  orphanRetainedOutputCount: number;
  invalidRetainedOutputCount: number;
};

export type ResearchDurableRetentionPersistResultWithRetainedInventory =
  Omit<ResearchDurableRetentionPersistResult, "snapshot"> & {
    snapshot: ResearchDurableRetentionSnapshotWithRetainedInventory;
  };

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

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

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function assertCount(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`DURABLE_RETENTION_RETAINED_INVENTORY_COUNT_INVALID:${field}`);
  }
}

function validateExtendedSnapshot(
  snapshot: ResearchDurableRetentionSnapshot,
): ResearchDurableRetentionSnapshotWithRetainedInventory {
  const value = snapshot as ResearchDurableRetentionSnapshot & Partial<ResearchDurableRetentionSnapshotWithRetainedInventory>;
  assertCount(value.retainedOutputFileCount, "retainedOutputFileCount");
  assertCount(value.retainedOutputBytes, "retainedOutputBytes");
  assertCount(value.referencedRetainedOutputCount, "referencedRetainedOutputCount");
  assertCount(value.orphanRetainedOutputCount, "orphanRetainedOutputCount");
  assertCount(value.invalidRetainedOutputCount, "invalidRetainedOutputCount");
  return value as ResearchDurableRetentionSnapshotWithRetainedInventory;
}

export function buildResearchDurableRetentionSnapshotWithRetainedInventory(input: {
  report: ResearchDurableKnowledgeCompletenessReportWithRetainedInventory;
  sourceStateSha: string;
  mainAuthoritySha: string;
  firstObservedAt: string;
}): ResearchDurableRetentionSnapshotWithRetainedInventory {
  const base = buildResearchDurableRetentionSnapshot(input);
  const evidenceDigest = sha256Text(canonicalJson({
    baseEvidenceDigest: base.evidenceDigest,
    retainedOutputFileCount: input.report.retainedOutputFileCount,
    retainedOutputBytes: input.report.retainedOutputBytes,
    referencedRetainedOutputCount: input.report.referencedRetainedOutputCount,
    orphanRetainedOutputCount: input.report.orphanRetainedOutputCount,
    invalidRetainedOutputCount: input.report.invalidRetainedOutputCount,
  }));
  const { snapshotDigest: _previousSnapshotDigest, ...baseWithoutDigest } = base;
  const core = {
    ...baseWithoutDigest,
    evidenceDigest,
    retainedOutputFileCount: input.report.retainedOutputFileCount,
    retainedOutputBytes: input.report.retainedOutputBytes,
    referencedRetainedOutputCount: input.report.referencedRetainedOutputCount,
    orphanRetainedOutputCount: input.report.orphanRetainedOutputCount,
    invalidRetainedOutputCount: input.report.invalidRetainedOutputCount,
  };
  return {
    ...core,
    snapshotDigest: sha256Text(canonicalJson(core)),
  };
}

export function persistResearchDurableRetentionSnapshotWithRetainedInventory(input: {
  repoRoot: string;
  snapshot: ResearchDurableRetentionSnapshotWithRetainedInventory;
}): ResearchDurableRetentionPersistResultWithRetainedInventory {
  const persisted = persistResearchDurableRetentionSnapshot(input);
  return {
    ...persisted,
    snapshot: validateExtendedSnapshot(persisted.snapshot),
  };
}
