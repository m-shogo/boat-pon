import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { canonicalHash } from "../research-replay/canonical";
import { buildN2ConfounderDistributionBridge, type N2ConfounderDistributionBridgeReport } from "../research-replay/n2ConfounderDistributionBridge";
import { auditN2ConfoundersAndRejections, type N2ConfounderRejectionAuditReport } from "../research-replay/n2ConfounderRejectionAudit";
import type { N2EdgeHistoricalConfirmationReport } from "../research-replay/n2EdgeHistoricalConfirmation";
import type { N2EdgeHoldoutDistributionEvidenceReport } from "../research-replay/n2EdgeHoldoutDistributionEvidence";
import { contractDigest, type Rejection } from "../research/governance/contracts";
import { appendRecordIdempotent, listRecords } from "../research/governance/registryStore";
import {
  atomicWriteJson,
  runExecutorLifecycle,
  verifyJsonReadback,
  type ExecutorSpec,
  type SdkContext,
} from "../research/governance/executorSdk";
import type { Executor, ExecutorResult } from "./taskExecutors";

export const N2_CONFOUNDER_AUDIT_EXECUTOR_VERSION = "n2-confounder-audit-executor-v2" as const;
const REPORT_RELATIVE_PATH = "reports/n2/n2-confounder-audit.json";
const HISTORICAL_REPORT_RELATIVE_PATH = "reports/n2/n2-edge-historical-test.json";
const REGISTRY_ROOT_RELATIVE_PATH = "research/registries";
const REJECTION_TRIAL_FAMILY = "N2-EDGE-V1";
const REJECTION_SUBJECT_PREFIX: Record<Rejection["subjectType"], string> = {
  experiment: "EXP",
  discovery: "DISC",
  strategy: "STRAT",
  transfer: "XFER",
};

export type N2HistoricalTestArtifact = {
  status: "PASS";
  generatedAt: string;
  outputDigest: string;
  confirmation: N2EdgeHistoricalConfirmationReport;
  distributionEvidence?: N2EdgeHoldoutDistributionEvidenceReport;
  authority?: {
    automaticPromotionAuthorized?: unknown;
    productionApplyAuthorized?: unknown;
  };
};

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}
function unique(values: readonly string[]): string[] { return [...new Set(values)].sort(); }
function digestMatches<T extends { outputDigest: string }>(value: T): boolean {
  const { outputDigest, ...body } = value;
  return isDigest(outputDigest) && canonicalHash(body) === outputDigest;
}
function rejectionSubjectIdentityBlocker(record: Rejection): string | null {
  const prefix = REJECTION_SUBJECT_PREFIX[record.subjectType];
  const valid = new RegExp(`^${prefix}-[0-9A-Za-z._-]{1,80}$`, "u").test(record.subjectId);
  return valid
    ? null
    : `REJECTION_SUBJECT_ID_MISMATCH:${record.rejectionId}:${record.subjectType}:${record.subjectId}`;
}

export function readN2HistoricalTestArtifact(repoRoot: string): {
  artifact: N2HistoricalTestArtifact | null;
  blockers: string[];
} {
  const path = join(repoRoot, HISTORICAL_REPORT_RELATIVE_PATH);
  if (!existsSync(path)) return { artifact: null, blockers: ["HISTORICAL_TEST_REPORT_MISSING"] };
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, "utf8")); }
  catch { return { artifact: null, blockers: ["HISTORICAL_TEST_REPORT_INVALID_JSON"] }; }
  const value = parsed as Partial<N2HistoricalTestArtifact>;
  const blockers: string[] = [];
  if (value.status !== "PASS") blockers.push("HISTORICAL_TEST_REPORT_NOT_PASS");
  if (!isDigest(value.outputDigest)) blockers.push("HISTORICAL_TEST_OUTPUT_DIGEST_INVALID");
  if (typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))) blockers.push("HISTORICAL_TEST_GENERATED_AT_INVALID");

  const confirmation = value.confirmation as N2EdgeHistoricalConfirmationReport | undefined;
  if (!confirmation || confirmation.status !== "PASS") blockers.push("HISTORICAL_CONFIRMATION_NOT_PASS");
  if (confirmation && !digestMatches(confirmation)) blockers.push("HISTORICAL_CONFIRMATION_DIGEST_MISMATCH");
  if (confirmation && !Array.isArray(confirmation.results)) blockers.push("HISTORICAL_CONFIRMATION_RESULTS_INVALID");
  if (confirmation && confirmation.results.length !== confirmation.lockedHypothesisCount) blockers.push(`HISTORICAL_CONFIRMATION_COUNT_MISMATCH:${confirmation.results.length}/${confirmation.lockedHypothesisCount}`);
  if (confirmation && confirmation.confirmedCount + confirmation.rejectedCount + confirmation.insufficientCount !== confirmation.results.length) blockers.push("HISTORICAL_CONFIRMATION_VERDICT_COUNTS_INVALID");
  if (confirmation?.authority.forwardLabelsUsedForConfirmation !== false) blockers.push("FORWARD_LABEL_AUTHORITY_INVALID");
  if (confirmation?.authority.automaticPromotionAuthorized !== false) blockers.push("CONFIRMATION_PROMOTION_AUTHORITY_INVALID");
  const ids = confirmation?.results.map((result) => result.hypothesisId) ?? [];
  if (new Set(ids).size !== ids.length) blockers.push("HISTORICAL_CONFIRMATION_DUPLICATE_HYPOTHESIS");

  const distribution = value.distributionEvidence;
  if (distribution !== undefined) {
    if (distribution.status !== "PASS") blockers.push("DISTRIBUTION_EVIDENCE_NOT_PASS");
    if (!digestMatches(distribution)) blockers.push("DISTRIBUTION_EVIDENCE_DIGEST_MISMATCH");
    if (distribution.authority.confirmationVerdictChanged !== false
      || distribution.authority.rejectionRescueAuthorized !== false
      || distribution.authority.automaticPromotionAuthorized !== false
      || distribution.authority.forwardLabelsUsed !== false) blockers.push("DISTRIBUTION_EVIDENCE_AUTHORITY_INVALID");
  }
  if (value.authority?.automaticPromotionAuthorized !== undefined && value.authority.automaticPromotionAuthorized !== false) blockers.push("HISTORICAL_REPORT_PROMOTION_AUTHORITY_INVALID");
  if (value.authority?.productionApplyAuthorized !== undefined && value.authority.productionApplyAuthorized !== false) blockers.push("HISTORICAL_REPORT_PRODUCTION_AUTHORITY_INVALID");

  return blockers.length > 0
    ? { artifact: null, blockers: unique(blockers) }
    : { artifact: value as N2HistoricalTestArtifact, blockers: [] };
}

export function buildN2GovernanceRejectionRecords(input: {
  sourceArtifactDigest: string;
  sourceGeneratedAt: string;
  audit: N2ConfounderRejectionAuditReport;
}): Rejection[] {
  return input.audit.rejectionEntries.map((entry) => ({
    rejectionId: `REJ-N2-${input.sourceArtifactDigest.slice(0, 12)}-${entry.entryDigest.slice(0, 12)}`,
    subjectType: "discovery",
    subjectId: entry.hypothesisId,
    reason: `N2 v1 holdout rejection: ${entry.reasonCode}; source=${entry.sourceTask}; auditEntry=${entry.entryDigest}; rescueByConfounderExplanationAllowed=false`,
    evidenceStage: "holdout",
    trialFamilyId: REJECTION_TRIAL_FAMILY,
    createdAt: input.sourceGeneratedAt,
  }));
}

function stripRegistryMetadata(record: Record<string, unknown>): Record<string, unknown> {
  const { _digest, _recordedAt, ...body } = record;
  return body;
}
export function preflightN2RejectionRegistry(registryRoot: string, planned: readonly Rejection[]) {
  const blockers: string[] = [];
  const plannedIds = planned.map((record) => record.rejectionId);
  if (new Set(plannedIds).size !== plannedIds.length) blockers.push("DUPLICATE_PLANNED_REJECTION_ID");
  for (const record of planned) {
    const blocker = rejectionSubjectIdentityBlocker(record);
    if (blocker) blockers.push(blocker);
  }
  if (blockers.length > 0) {
    return { ok: false, blockers: unique(blockers), alreadyRecordedCount: 0 };
  }
  let existing: Record<string, unknown>[];
  try { existing = listRecords<Record<string, unknown>>(registryRoot, "rejections"); }
  catch (error) {
    return { ok: false, blockers: [`REJECTION_REGISTRY_READ_FAILED:${error instanceof Error ? error.message.slice(0, 180) : "UNKNOWN"}`], alreadyRecordedCount: 0 };
  }
  const byId = new Map(existing.map((record) => [String(record.rejectionId), record]));
  let alreadyRecordedCount = 0;
  for (const record of planned) {
    const prior = byId.get(record.rejectionId);
    if (!prior) continue;
    const body = stripRegistryMetadata(prior);
    const storedDigest = typeof prior._digest === "string" ? prior._digest : contractDigest(body);
    const expectedDigest = contractDigest(record as unknown as Record<string, unknown>);
    if (storedDigest !== expectedDigest || contractDigest(body) !== expectedDigest) blockers.push(`REJECTION_REGISTRY_CONFLICT:${record.rejectionId}`);
    else alreadyRecordedCount += 1;
  }
  return { ok: blockers.length === 0, blockers: unique(blockers), alreadyRecordedCount };
}
function relativeRegistryOutput(repoRoot: string, absolutePath: string): string {
  const output = relative(repoRoot, absolutePath).replaceAll("\\", "/");
  if (!output.startsWith("research/registries/rejections/") || output.includes("..")) throw new Error(`REJECTION_REGISTRY_OUTPUT_OUTSIDE_ALLOWLIST:${output}`);
  return output;
}

export function createN2ConfounderAuditExecutor(): Executor {
  return (ctx) => {
    let source: N2HistoricalTestArtifact | null = null;
    let bridge: N2ConfounderDistributionBridgeReport | null = null;
    let audit: N2ConfounderRejectionAuditReport | null = null;
    let plannedRejections: Rejection[] = [];
    let preflightAlreadyRecordedCount = 0;
    const registryRoot = join(ctx.repoRoot, REGISTRY_ROOT_RELATIVE_PATH);
    const sdkCtx: SdkContext = {
      repoRoot: ctx.repoRoot, runId: ctx.runId, taskId: ctx.taskId, dataRoot: ctx.repoRoot, dryRun: ctx.dryRun,
      writeAllowlist: ["reports/n2/", "research/registries/rejections/"],
    };
    const spec: ExecutorSpec = {
      name: "confounder-audit", safetyLevel: "L0", implemented: true,
      inputContract: () => {
        if (ctx.taskStatuses["TASK-N2-041"] !== "PASS") return { ok: false, errors: [`DEPENDENCY_NOT_SATISFIED:TASK-N2-041=${ctx.taskStatuses["TASK-N2-041"] ?? "UNKNOWN"}`] };
        const read = readN2HistoricalTestArtifact(ctx.repoRoot);
        if (!read.artifact) return { ok: false, errors: read.blockers };
        source = read.artifact;
        bridge = buildN2ConfounderDistributionBridge({
          confirmationResults: source.confirmation.results,
          distributionEvidence: source.distributionEvidence ?? null,
        });
        if (bridge.status !== "PASS") return { ok: false, errors: bridge.blockers };
        audit = auditN2ConfoundersAndRejections({ confirmationResults: source.confirmation.results, confounderFlags: bridge.confounderFlags });
        if (audit.status !== "PASS") return { ok: false, errors: audit.blockers };
        plannedRejections = buildN2GovernanceRejectionRecords({ sourceArtifactDigest: source.outputDigest, sourceGeneratedAt: source.generatedAt, audit });
        const preflight = preflightN2RejectionRegistry(registryRoot, plannedRejections);
        preflightAlreadyRecordedCount = preflight.alreadyRecordedCount;
        return { ok: preflight.ok, errors: preflight.blockers };
      },
      executeReadOnly: () => {
        if (!source || !bridge || !audit) throw new Error("N2_CONFOUNDER_AUDIT_INPUT_NOT_READY");
        const summary = {
          reportVersion: "n2-confounder-audit-report-v2",
          executorContractVersion: N2_CONFOUNDER_AUDIT_EXECUTOR_VERSION,
          status: "PASS",
          sourceHistoricalTestDigest: source.outputDigest,
          sourceHistoricalTestGeneratedAt: source.generatedAt,
          sourceConfirmationDigest: source.confirmation.outputDigest,
          sourceDistributionEvidenceDigest: source.distributionEvidence?.outputDigest ?? null,
          auditedHypothesisCount: audit.itemCount,
          rejectedCount: audit.rejectedCount,
          insufficientCount: audit.insufficientCount,
          confirmedPendingCount: audit.confirmedPendingCount,
          confirmedBlockedCount: audit.confirmedBlockedCount,
          distributionBridge: bridge,
          audit,
          registryPlan: {
            registryKind: "rejections", appendOnly: true,
            plannedRejectionCount: plannedRejections.length,
            alreadyRecordedCount: preflightAlreadyRecordedCount,
            rejectionIds: plannedRejections.map((record) => record.rejectionId).sort(),
            rejectedHypothesisIds: plannedRejections.map((record) => record.subjectId).sort(),
            conflictingOverwriteAllowed: false,
          },
          confounderCoverage: {
            aggregateDistributionEvidenceAvailable: source.distributionEvidence !== undefined,
            concentrationPolicyVersion: bridge.policy?.policyVersion ?? null,
            confirmedWithoutBlockingConcentrationCount: bridge.confirmedWithoutBlockingConcentrationCount,
            confirmedBlockedByConcentrationCount: bridge.confirmedBlockedByConcentrationCount,
            confirmedBlockedByInsufficientDistributionCount: bridge.confirmedBlockedByInsufficientDistributionCount,
            confirmedBlockedByMissingDistributionCount: bridge.confirmedBlockedByMissingDistributionCount,
            rejectedHypothesisRescueAllowed: false,
          },
          authority: {
            automaticPromotionAuthorized: false,
            currentBuyConnectionAuthorized: false,
            lineConnectionAuthorized: false,
            publicPublishAuthorized: false,
            automatedBettingAuthorized: false,
            productionApplyAuthorized: false,
          },
          databaseWriteCount: 0,
          networkRequestCount: 0,
        };
        return { outputs: [REPORT_RELATIVE_PATH], digest: canonicalHash(summary), summary };
      },
      pitEvidence: (_sdk, artifact) => ({
        status: "PASS", validatorId: "n2-confounder-audit-holdout-lineage", validatorVersion: N2_CONFOUNDER_AUDIT_EXECUTOR_VERSION,
        checkedRecordCount: Number((artifact.summary as { auditedHypothesisCount?: unknown }).auditedHypothesisCount ?? 0),
        sameRaceViolationCount: 0, futureViolationCount: 0, ambiguousTimingCount: 0,
        evidencePath: REPORT_RELATIVE_PATH, evidenceDigest: artifact.digest, notApplicableReason: null,
      }),
      writeArtifacts: (sdk, artifact) => {
        const registryOutputs: string[] = [];
        for (const record of plannedRejections) {
          const result = appendRecordIdempotent(registryRoot, "rejections", record as unknown as Record<string, unknown>);
          if (!result.ok) return { ok: false, errors: [`${result.code}: ${result.errors.join("; ")}`], outputs: registryOutputs };
          if (result.path) {
            try { registryOutputs.push(relativeRegistryOutput(ctx.repoRoot, result.path)); }
            catch (error) { return { ok: false, errors: [error instanceof Error ? error.message : String(error)], outputs: registryOutputs }; }
          }
        }
        try {
          atomicWriteJson(join(sdk.repoRoot, REPORT_RELATIVE_PATH), {
            ...artifact.summary, runId: ctx.runId, requestId: ctx.requestId, taskId: ctx.taskId,
            executorVersion: N2_CONFOUNDER_AUDIT_EXECUTOR_VERSION, generatedAt: new Date().toISOString(), outputDigest: artifact.digest,
          }, true);
          return { ok: true, errors: [], outputs: [REPORT_RELATIVE_PATH, ...unique(registryOutputs)] };
        } catch (error) {
          return { ok: false, errors: [error instanceof Error ? error.message : String(error)], outputs: registryOutputs };
        }
      },
      verifyArtifacts: (sdk, artifact) => verifyJsonReadback(join(sdk.repoRoot, REPORT_RELATIVE_PATH), artifact.digest),
      recordEvidence: (_sdk, _artifact, outputs) => ({ ok: true, errors: [], outputs }),
      finalizeEvidence: (_sdk, _artifact, outputs) => ({ ok: true, errors: [], outputs }),
    };
    const outcome = runExecutorLifecycle(spec, sdkCtx);
    const result: ExecutorResult["result"] = outcome.result === "ENGINEERING_REQUIRED" ? "BLOCKED" : outcome.result;
    return { result, executorVersion: N2_CONFOUNDER_AUDIT_EXECUTOR_VERSION, summary: outcome.summary, outputs: outcome.outputs, outputDigest: outcome.digest || canonicalHash(outcome.summary), blocks: outcome.blocks };
  };
}
export const runN2ConfounderAuditExecutor = createN2ConfounderAuditExecutor();
