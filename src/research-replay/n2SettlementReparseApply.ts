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

export const SETTLEMENT_SNAPSHOT_IDENTITY_VERSION = "n2-settlement-snapshot-identity-v1";

// approval grant が bind すべき target 値。
// snapshot 束縛は settlement-content identity（承認 grant / 監査行の append で不変）を使う。
// whole-file SHA-256 は grant を記録すると変化するため gate の束縛には使わない（advisory のみ）。
export function reparseApplyTargetSchemaVersion(settlementSchema: string, settlementSnapshotIdentity: string): string {
  return `${settlementSchema}@${settlementSnapshotIdentity}`;
}
export function reparseApplyTargetContractVersion(approvalTargetDigest: string): string {
  return `${REPARSE_APPLY_CONTRACT_PREFIX}:${approvalTargetDigest}`;
}

// approval manifest の binding から approval target digest を再計算する（manifest 生成と同一式）。
export function computeApprovalTargetDigest(binding: unknown): string {
  return canonicalHash(binding);
}

// settlement-content snapshot identity。settlement テーブルの DDL と件数分布から決定的に導出し、
// rollout_approval_grants_v2 / operational_audit_events など settlement 外テーブルへの append では不変。
// production apply gate は whole-file SHA ではなくこの identity を snapshot 束縛に使う。
export function computeSettlementSnapshotIdentity(db: DatabaseSync): { identity: string; components: Record<string, unknown> } {
  const schema = (db.prepare("SELECT migration_version AS v FROM n1_schema_migrations WHERE status='applied' ORDER BY rowid").all() as Array<{ v: string }>).at(-1)?.v ?? "unknown";
  const ddl = (db.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name IN ('settlement_candidates_v2','race_payout_lines_v2','race_refund_lines_v2','settlement_source_duplicate_resolutions_v2') ORDER BY name",
  ).all() as Array<{ name: string; sql: string }>).map((r) => [r.name, r.sql] as const);
  // 1 スキャンで status × revision × superseded 分布を取得（settlement 変化を検出する強い指紋）。
  const dist = (db.prepare(
    "SELECT settlement_status AS s, revision_kind AS r, CASE WHEN supersedes_candidate_id IS NULL THEN 0 ELSE 1 END AS sup, COUNT(*) AS n FROM settlement_candidates_v2 GROUP BY 1,2,3 ORDER BY 1,2,3",
  ).all() as Array<{ s: string; r: string; sup: number; n: number }>).map((x) => [x.s, x.r, x.sup, Number(x.n)] as const);
  const one = (sql: string): number => Number((db.prepare(sql).get() as { n: number }).n);
  const components = {
    version: SETTLEMENT_SNAPSHOT_IDENTITY_VERSION,
    settlementSchema: schema,
    ddl,
    candidateDistribution: dist,
    physicalCandidateRows: one("SELECT COUNT(*) AS n FROM settlement_candidates_v2"),
    payoutLineRows: one("SELECT COUNT(*) AS n FROM race_payout_lines_v2"),
    refundLineRows: one("SELECT COUNT(*) AS n FROM race_refund_lines_v2"),
    sourceDuplicateRows: one("SELECT COUNT(*) AS n FROM settlement_source_duplicate_resolutions_v2"),
  };
  return { identity: canonicalHash(components), components };
}

export type ReparseApplyGateInput = {
  manifest: {
    manifestSchemaVersion: string;
    approvalStatus?: string;
    approvalTargetDigest: string;
    binding: Record<string, unknown> & {
      snapshotIdentity: {
        settlementSnapshotIdentity: string; // 束縛に使う不変 identity
        settlementSchema: string;
        sourceSha256?: string;  // advisory（grant 記録で変化しうる）
        sourceBytes?: number;   // advisory
      };
    };
    productionApplyCodeGitSha?: string | null;
  };
  onDisk: {
    settlementSnapshotIdentity: string;
    settlementSchema: string;
    sourceSha256: string;  // advisory record
    sourceBytes: number;   // advisory record
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

  // 2. settlement-content snapshot identity（承認 grant 記録で不変な束縛）。
  //    whole-file SHA / size は grant 記録で変化するため BLOCK には使わず advisory record のみ。
  const snap = manifest.binding.snapshotIdentity;
  if (snap.settlementSnapshotIdentity !== onDisk.settlementSnapshotIdentity) blocks.push("SETTLEMENT_SNAPSHOT_IDENTITY_MISMATCH");
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
    targetSchemaVersion: reparseApplyTargetSchemaVersion(snap.settlementSchema, snap.settlementSnapshotIdentity),
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
