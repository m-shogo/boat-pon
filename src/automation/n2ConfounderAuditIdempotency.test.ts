import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { contractDigest, type Rejection } from "../research/governance/contracts";
import { preflightN2RejectionRegistry } from "./n2ConfounderAuditExecutor";

function rejection(createdAt: string, overrides: Partial<Rejection> = {}): Rejection {
  return {
    rejectionId: "REJ-N2-aaaaaaaaaaaa-bbbbbbbbbbbb",
    subjectType: "discovery",
    subjectId: "DISC-idempotent-replay",
    reason: "N2 v1 holdout rejection: HISTORICAL_REJECTED; source=TASK-N2-041; auditEntry=fixture; rescueByConfounderExplanationAllowed=false",
    evidenceStage: "holdout",
    trialFamilyId: "N2-EDGE-V1",
    createdAt,
    ...overrides,
  };
}

function writeExisting(root: string, record: Rejection): void {
  const dir = join(root, "rejections");
  mkdirSync(dir, { recursive: true });
  const body = record as unknown as Record<string, unknown>;
  writeFileSync(join(dir, `${record.rejectionId}.json`), `${JSON.stringify({
    ...body,
    _digestVersion: "canonical-v2",
    _digest: contractDigest(body),
    _recordedAt: "2026-08-08T08:00:00.000Z",
  }, null, 2)}\n`, "utf8");
}

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-n2-rejection-idempotency-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("semantic replay reuses the immutable stored createdAt instead of conflicting", () => {
  withRoot((root) => {
    const stored = rejection("2026-08-08T07:00:00.000Z");
    writeExisting(root, stored);

    const replay = rejection("2026-08-08T09:00:00.000Z");
    const result = preflightN2RejectionRegistry(root, [replay]);

    assert.equal(result.ok, true);
    assert.deepEqual(result.blockers, []);
    assert.equal(result.alreadyRecordedCount, 1);
    assert.equal(result.resolvedRecords[0]?.createdAt, stored.createdAt);
  });
});

test("createdAt tolerance does not hide any other immutable rejection conflict", () => {
  withRoot((root) => {
    const stored = rejection("2026-08-08T07:00:00.000Z");
    writeExisting(root, stored);

    const changedReason = rejection("2026-08-08T09:00:00.000Z", { reason: "different immutable reason" });
    const result = preflightN2RejectionRegistry(root, [changedReason]);

    assert.equal(result.ok, false);
    assert.ok(result.blockers.includes(`REJECTION_REGISTRY_CONFLICT:${stored.rejectionId}`));
  });
});
