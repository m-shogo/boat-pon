import type { DatabaseSync } from "node:sqlite";
import { resolveApproval, type ApprovalMode, type ApprovalResolution } from "./approval";
import { canonicalHash } from "./canonical";
import {
  buildShadowOperabilityReport,
  type ShadowOperabilityReport,
  type ShadowOperabilityThresholds,
} from "./shadowOperability";
import { ROLLOUT_SCHEMA_VERSION } from "./schema";

export const SHADOW_OPERABILITY_POLICY_CONTRACT = "shadow-operability-policy-v1";
export const SHADOW_OPERABILITY_APPROVAL_SCOPE = "F0-R_SHADOW_OPERABILITY_POLICY";

export type ShadowOperabilityPolicy = {
  contractVersion: typeof SHADOW_OPERABILITY_POLICY_CONTRACT;
  policyVersion: string;
  diagnosticsWindowMs: number;
  thresholds: ShadowOperabilityThresholds;
};

export type ShadowOperabilityGate = {
  gateVersion: "shadow-operability-gate-v1";
  executionMode: ApprovalMode;
  policy: ShadowOperabilityPolicy;
  policyDigest: string;
  approval: ApprovalResolution;
  report: ShadowOperabilityReport;
  status: ShadowOperabilityReport["status"];
  reasons: string[];
  digest: string;
};

function exactObject(value: unknown, expectedKeys: string[], name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid ${name}`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join("\0") !== [...expectedKeys].sort().join("\0")) {
    throw new Error(`invalid ${name} fields`);
  }
  return record;
}

export function parseShadowOperabilityPolicy(value: unknown): ShadowOperabilityPolicy {
  const policy = exactObject(
    value,
    ["contractVersion", "diagnosticsWindowMs", "policyVersion", "thresholds"],
    "shadow operability policy",
  );
  if (policy.contractVersion !== SHADOW_OPERABILITY_POLICY_CONTRACT) {
    throw new Error("unsupported shadow operability policy contract");
  }
  if (typeof policy.policyVersion !== "string"
    || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(policy.policyVersion)) {
    throw new Error("invalid shadow operability policy version");
  }
  if (!Number.isSafeInteger(policy.diagnosticsWindowMs) || Number(policy.diagnosticsWindowMs) < 1) {
    throw new Error("invalid shadow operability diagnostics window");
  }
  const thresholdRecord = exactObject(policy.thresholds, [
    "maxContentionRate",
    "maxHandlerDeadlineExceeded",
    "maxOldestQueuedAgeMs",
    "maxPermanentlyFailed",
    "maxQueued",
    "maxReadyQueued",
    "maxRetryExhausted",
    "maxRetrying",
  ], "shadow operability thresholds");
  const thresholds = thresholdRecord as ShadowOperabilityThresholds;
  for (const [name, threshold] of Object.entries(thresholds)) {
    if (name === "maxContentionRate") {
      if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
        throw new Error(`invalid shadow operability threshold: ${name}`);
      }
    } else if (typeof threshold !== "number" || !Number.isSafeInteger(threshold) || threshold < 0) {
      throw new Error(`invalid shadow operability threshold: ${name}`);
    }
  }
  return {
    contractVersion: SHADOW_OPERABILITY_POLICY_CONTRACT,
    policyVersion: policy.policyVersion,
    diagnosticsWindowMs: Number(policy.diagnosticsWindowMs),
    thresholds: { ...thresholds },
  };
}

export function shadowOperabilityApprovalTarget(policy: ShadowOperabilityPolicy) {
  const policyDigest = canonicalHash(policy);
  return {
    policyDigest,
    approvalScope: SHADOW_OPERABILITY_APPROVAL_SCOPE,
    targetStage: "F0-R-OPERABILITY",
    targetSchemaVersion: ROLLOUT_SCHEMA_VERSION,
    targetContractVersion: `${SHADOW_OPERABILITY_POLICY_CONTRACT}:${policyDigest}`,
  } as const;
}

export function evaluateShadowOperabilityGate(
  db: DatabaseSync,
  input: {
    policy: unknown;
    asOf: string;
    executionMode: ApprovalMode;
  },
): ShadowOperabilityGate {
  if (input.executionMode !== "simulated" && input.executionMode !== "production") {
    throw new Error("invalid shadow operability execution mode");
  }
  const policy = parseShadowOperabilityPolicy(input.policy);
  const target = shadowOperabilityApprovalTarget(policy);
  const approval = resolveApproval(db, {
    approvalScope: target.approvalScope,
    targetStage: target.targetStage,
    targetSchemaVersion: target.targetSchemaVersion,
    targetContractVersion: target.targetContractVersion,
    rolloutStartedAt: input.asOf,
    executionMode: input.executionMode,
  });
  const report = buildShadowOperabilityReport(db, {
    policyVersion: policy.policyVersion,
    asOf: input.asOf,
    diagnosticsWindowMs: policy.diagnosticsWindowMs,
    thresholds: policy.thresholds,
  });
  const reasons = approval.approved
    ? report.reasons
    : [...report.reasons, `approval:${approval.code}`].sort();
  const status = approval.approved ? report.status : "BLOCKED";
  const unsigned = {
    gateVersion: "shadow-operability-gate-v1" as const,
    executionMode: input.executionMode,
    policy,
    policyDigest: target.policyDigest,
    approval,
    report,
    status,
    reasons,
  };
  return { ...unsigned, digest: canonicalHash(unsigned) };
}
