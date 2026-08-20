import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalHash } from "../research-replay/canonical";
import { readLifecycleValidApprovalScopes } from "../research-replay/n2ObservationIngestApprovalScopes";
import { buildN2ObservationIngestReadiness } from "../research-replay/n2ObservationIngestReadiness";
import { readN2ObservationIngestReadiness } from "../research-replay/n2ObservationIngestReadinessReader";
import { readCanonicalRolloutState } from "../research-replay/n2ObservationIngestRolloutState";
import {
  atomicWriteJson,
  runExecutorLifecycle,
  verifyJsonReadback,
  type ExecutorSpec,
  type SdkContext,
} from "../research/governance/executorSdk";
import type { Executor, ExecutorResult } from "./taskExecutors";

export const N2_OBSERVATION_INGEST_READINESS_EXECUTOR_VERSION = "n2-observation-ingest-readiness-executor-v1";
const REPORT_RELATIVE_PATH = "reports/n2/n2-observation-ingest-readiness.json";
const PRIMARY_DB_FILENAME = "boat.sqlite";

function dbBlocks(path: string, code: string): string[] {
  if (!existsSync(path)) return [`${code}_NOT_FOUND`];
  const wal = `${path}-wal`;
  return existsSync(wal) && statSync(wal).size > 0 ? [`${code}_ACTIVE_WAL`] : [];
}

export const runN2ObservationIngestReadinessExecutor: Executor = (ctx) => {
  const primaryDbPath = join(dirname(ctx.sidecarPath), PRIMARY_DB_FILENAME);
  const sdkContext: SdkContext = {
    repoRoot: ctx.repoRoot,
    runId: ctx.runId,
    taskId: ctx.taskId,
    dataRoot: ctx.sidecarPath,
    dryRun: ctx.dryRun,
    writeAllowlist: ["reports/n2/"],
  };
  const spec: ExecutorSpec = {
    name: "observation-ingest-readiness",
    safetyLevel: "L0",
    implemented: true,
    inputContract: () => {
      const errors: string[] = [];
      if (ctx.taskStatuses["TASK-N2-010"] !== "PASS") {
        errors.push(`DEPENDENCY_NOT_SATISFIED:TASK-N2-010=${ctx.taskStatuses["TASK-N2-010"] ?? "UNKNOWN"}`);
      }
      errors.push(...dbBlocks(ctx.sidecarPath, "SIDECAR"));
      errors.push(...dbBlocks(primaryDbPath, "PRIMARY_DB"));
      return { ok: errors.length === 0, errors };
    },
    executeReadOnly: () => {
      const read = readN2ObservationIngestReadiness({
        primaryDbPath,
        sidecarDbPath: ctx.sidecarPath,
      });
      const rolloutState = readCanonicalRolloutState(ctx.sidecarPath);
      const readinessInput = {
        ...read.input,
        rollout: {
          ...rolloutState,
          approvalScopes: readLifecycleValidApprovalScopes(ctx.sidecarPath),
        },
      };
      const readiness = buildN2ObservationIngestReadiness(readinessInput);
      const checkedSourceRecordCount = readiness.officialProgram.sourceRows
        + readiness.trifectaMarket.sourceRows;
      const summary = {
        ...readiness,
        sourceIdentity: read.sourceIdentity,
        checkedSourceRecordCount,
        executorContractVersion: N2_OBSERVATION_INGEST_READINESS_EXECUTOR_VERSION,
        readOnly: true,
        queryOnly: true,
        primaryDbWriteCount: 0,
        sidecarWriteCount: 0,
        productionApplyExecuted: false,
      };
      return {
        outputs: [REPORT_RELATIVE_PATH],
        digest: canonicalHash(summary),
        summary,
      };
    },
    pitEvidence: (_sdk, artifact) => ({
      status: "NOT_APPLICABLE",
      validatorId: "n2-observation-ingest-readiness-pit-applicability",
      validatorVersion: N2_OBSERVATION_INGEST_READINESS_EXECUTOR_VERSION,
      checkedRecordCount: Number(artifact.summary.checkedSourceRecordCount ?? 0),
      sameRaceViolationCount: 0,
      futureViolationCount: 0,
      ambiguousTimingCount: 0,
      evidencePath: null,
      evidenceDigest: null,
      notApplicableReason: "readiness inventory does not join labels or emit prediction features",
    }),
    writeArtifacts: (sdk, artifact) => {
      try {
        const payload = {
          ...artifact.summary,
          runId: ctx.runId,
          requestId: ctx.requestId,
          taskId: ctx.taskId,
          executorVersion: N2_OBSERVATION_INGEST_READINESS_EXECUTOR_VERSION,
          generatedAt: new Date().toISOString(),
          outputDigest: artifact.digest,
        };
        atomicWriteJson(join(sdk.repoRoot, REPORT_RELATIVE_PATH), payload, true);
        return { ok: true, errors: [], outputs: [REPORT_RELATIVE_PATH] };
      } catch (error) {
        return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
      }
    },
    verifyArtifacts: (sdk, artifact) => verifyJsonReadback(
      join(sdk.repoRoot, REPORT_RELATIVE_PATH), artifact.digest,
    ),
    recordEvidence: (_sdk, _artifact, outputs) => ({ ok: true, errors: [], outputs }),
    finalizeEvidence: (_sdk, _artifact, outputs) => ({ ok: true, errors: [], outputs }),
  };

  const outcome = runExecutorLifecycle(spec, sdkContext);
  const result: ExecutorResult["result"] = outcome.result === "ENGINEERING_REQUIRED" ? "BLOCKED" : outcome.result;
  return {
    result,
    executorVersion: N2_OBSERVATION_INGEST_READINESS_EXECUTOR_VERSION,
    summary: outcome.summary,
    outputs: outcome.outputs,
    outputDigest: outcome.digest || canonicalHash(outcome.summary),
    blocks: outcome.blocks,
  };
};