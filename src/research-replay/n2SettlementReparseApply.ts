// N2 settlement reparse production apply gate（承認境界のみ・自己承認不可）。
//
// 実 sidecar への reparse 適用は、既存 append-only approval grant/lifecycle（resolveApproval）で
// 解決される有効な production approval が、approval target digest / source snapshot identity / mode /
// schema と完全一致する場合だけ許可する。一致しなければ必ず BLOCKED。Claude は承認を作成しない。
import type { DatabaseSync } from "node:sqlite";
import { canonicalHash } from "./canonical";
import { resolveApproval, type ApprovalResolution } from "./approval";

export const REPARSE_APPLY_SCOPE = "N2_SETTLEMENT_REPARSE_APPLY";
export const REPARSE_APPLY_TARGET_STAGE = "N2-REPARSE-APPLY";
export const REPARSE_APPLY_CONTRACT_PREFIX = "n2-settlement-reparse-apply-v1";
export const REPARSE_APPLY_GATE_VERSION = "n2-settlement-reparse-apply-gate-v1";

// approval grant が bind すべき target 値（source snapshot SHA と approval target digest を束ねる）。
export function reparseApplyTargetSchemaVersion(settlementSchema: string, sourceSha256: string): string {
  return `${settlementSchema}@${sourceSha256}`;
}
export function reparseApplyTargetContractVersion(approvalTargetDigest: string): string {
  return `${REPARSE_APPLY_CONTRACT_PREFIX}:${approvalTargetDigest}`;
}

// approval manifest の binding から approval target digest を再計算する（manifest 生成と同一式）。
export function computeApprovalTargetDigest(binding: unknown): string {
  return canonicalHash(binding);
}

export type ReparseApplyGateInput = {
  manifest: {
    manifestSchemaVersion: string;
    approvalStatus?: string;
    approvalTargetDigest: string;
    binding: Record<string, unknown> & { snapshotIdentity: { sourceSha256: string; sourceBytes: number; settlementSchema: string } };
    productionApplyCodeGitSha?: string | null;
  };
  onDisk: {
    sourceSha256: string;
    sourceBytes: number;
    settlementSchema: string;
    hasActiveWal: boolean;
    diskFreeBytes: number;
    neededBytes: number;
    codeGitSha: string | null;
  };
  approvalGrantId?: string | null;
  executionMode: "simulated" | "production";
  rolloutStartedAt: string; // 通常は now（approval は rollout 開始前でなければならない）
};

export type ReparseApplyGateResult = {
  gateVersion: string;
  approved: boolean;
  status: "PASS" | "WARN" | "BLOCKED";
  exitCode: 0 | 2 | 3;
  blocks: string[];
  approval: ApprovalResolution;
  approvalTargetDigest: string;
  recomputedApprovalTargetDigest: string;
};

// gate 判定。全 BLOCK 条件を集約する。approved は「全 block 無し かつ approval valid かつ mode=production」。
export function resolveReparseApplyGate(db: DatabaseSync, input: ReparseApplyGateInput): ReparseApplyGateResult {
  const blocks: string[] = [];
  const { manifest, onDisk } = input;

  // 0. mode
  if (input.executionMode !== "production") blocks.push("MODE_NOT_PRODUCTION");

  // 1. manifest integrity（approval target digest 再計算一致）
  const recomputed = computeApprovalTargetDigest(manifest.binding);
  if (recomputed !== manifest.approvalTargetDigest) blocks.push("MANIFEST_DIGEST_MISMATCH");
  if (manifest.approvalStatus === "NOT_APPROVED") {
    // manifest 自体が未承認宣言（承認取得後は新 manifest を生成する運用）。
    blocks.push("MANIFEST_MARKED_NOT_APPROVED");
  }

  // 2. source snapshot identity（manifest ↔ on-disk）
  const snap = manifest.binding.snapshotIdentity;
  if (snap.sourceSha256 !== onDisk.sourceSha256) blocks.push("SOURCE_SNAPSHOT_SHA_MISMATCH");
  if (snap.sourceBytes !== onDisk.sourceBytes) blocks.push("SOURCE_SIZE_MISMATCH");
  if (snap.settlementSchema !== onDisk.settlementSchema) blocks.push("SCHEMA_IDENTITY_MISMATCH");

  // 3. quiescence / capacity
  if (onDisk.hasActiveWal) blocks.push("ACTIVE_WAL");
  if (onDisk.diskFreeBytes < onDisk.neededBytes) blocks.push("INSUFFICIENT_DISK");

  // 4. code SHA（承認は特定 apply code SHA へ束ねる）
  if (manifest.productionApplyCodeGitSha && onDisk.codeGitSha
    && manifest.productionApplyCodeGitSha !== onDisk.codeGitSha) blocks.push("CODE_SHA_MISMATCH");

  // 5. approval 解決（既存 append-only approval lifecycle を再利用）
  const approval = resolveApproval(db, {
    approvalScope: REPARSE_APPLY_SCOPE,
    targetStage: REPARSE_APPLY_TARGET_STAGE,
    targetSchemaVersion: reparseApplyTargetSchemaVersion(snap.settlementSchema, snap.sourceSha256),
    targetContractVersion: reparseApplyTargetContractVersion(manifest.approvalTargetDigest),
    rolloutStartedAt: input.rolloutStartedAt,
    executionMode: input.executionMode,
  });
  if (!approval.approved) blocks.push(`APPROVAL_${approval.code}`);
  // approval grant id が明示指定された場合は一致必須
  if (input.approvalGrantId && approval.approvalId && input.approvalGrantId !== approval.approvalId) {
    blocks.push("APPROVAL_GRANT_ID_MISMATCH");
  }

  const approved = blocks.length === 0 && approval.approved && input.executionMode === "production";
  const status: ReparseApplyGateResult["status"] = approved ? "PASS" : "BLOCKED";
  return {
    gateVersion: REPARSE_APPLY_GATE_VERSION,
    approved, status, exitCode: approved ? 0 : 3, blocks,
    approval, approvalTargetDigest: manifest.approvalTargetDigest, recomputedApprovalTargetDigest: recomputed,
  };
}
