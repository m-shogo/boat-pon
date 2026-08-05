import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalHash } from "../research-replay/canonical";
import { buildN2PitAuditSummary } from "../research-replay/n2PitAudit";
import { readN2PitAuditObservations } from "../research-replay/n2PitAuditReader";
import {
  atomicWriteJson,
  runExecutorLifecycle,
  verifyJsonReadback,
  type ExecutorSpec,
  type SdkContext,
} from "../research/governance/executorSdk";
import type { Executor, ExecutorResult } from "./taskExecutors";

export const N2_PIT_AUDIT_EXECUTOR_VERSION = "n2-pit-audit-executor-v1";
const REPORT_RELATIVE_PATH = "reports/n2/n2-pit-audit.json";
const MANIFEST_RELATIVE_PATH = "reports/n2/n2-dataset-manifest.json";
const PRIMARY_DB_FILENAME = "boat.sqlite";

function dbBlocks(path: string, code: string): string[] {
  if (!existsSync(path)) return [`${code}_NOT_FOUND`];
  const wal = `${path}-wal`;
  return existsSync(wal) && statSync(wal).size > 0 ? [`${code}_ACTIVE_WAL`] : [];
}

function loadAndValidateManifest(repoRoot: string): {
  ok: boolean;
  errors: string[];
  outputDigest: string | null;
  datasetVersion: string | null;
} {
  const path = join(repoRoot, MANIFEST_RELATIVE_PATH);
  if (!existsSync(path)) {
    return { ok: false, errors: ["N2_DATASET_MANIFEST_MISSING"], outputDigest: null, datasetVersion: null };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return { ok: false, errors: ["N2_DATASET_MANIFEST_INVALID_JSON"], outputDigest: null, datasetVersion: null };
  }
  const errors: string[] = [];
  if (parsed.datasetManifestVersion !== "n2-dataset-manifest-v2") errors.push("N2_DATASET_MANIFEST_VERSION_MISMATCH");
  if (typeof parsed.datasetVersion !== "string" || parsed.datasetVersion.length === 0) errors.push("N2_DATASET_VERSION_MISSING");
  if (parsed.holdoutExcludedFromResearchCohort !== true) errors.push("N2_HOLDOUT_NOT_EXCLUDED");
  if (parsed.readOnly !== true) errors.push("N2_DATASET_MANIFEST_NOT_READ_ONLY");
  if (typeof parsed.outputDigest !== "string" || !/^[0-9a-f]{64}$/.test(parsed.outputDigest)) {
    errors.push("N2_DATASET_MANIFEST_OUTPUT_DIGEST_INVALID");
  } else {
    const digestable = { ...parsed };
    for (const key of ["runId", "requestId", "taskId", "executorVersion", "generatedAt", "outputDigest"]) {
      delete digestable[key];
    }
    if (canonicalHash(digestable) !== parsed.outputDigest) errors.push("N2_DATASET_MANIFEST_OUTPUT_DIGEST_MISMATCH");
  }
  return {
    ok: errors.length === 0,
    errors,
    outputDigest: typeof parsed.outputDigest === "string" ? parsed.outputDigest : null,
    datasetVersion: typeof parsed.datasetVersion === "string" ? parsed.datasetVersion : null,
  };
}

export const runN2PitAuditExecutor: Executor = (ctx) => {
  const primaryDbPath = join(dirname(ctx.sidecarPath), PRIMARY_DB_FILENAME);
  let manifestIdentity: ReturnType<typeof loadAndValidateManifest> | null = null;
  const sdkCtx: SdkContext = {
    repoRoot: ctx.repoRoot,
    runId: ctx.runId,
    taskId: ctx.taskId,
    dataRoot: ctx.sidecarPath,
    dryRun: ctx.dryRun,
    writeAllowlist: ["reports/n2/"],
  };
  const spec: ExecutorSpec = {
    name: "pit-audit",
    safetyLevel: "L0",
    implemented: true,
    inputContract: () => {
      const errors: string[] = [];
      if (ctx.taskStatuses["TASK-N2-010"] !== "PASS") {
        errors.push(`DEPENDENCY_NOT_SATISFIED:TASK-N2-010=${ctx.taskStatuses["TASK-N2-010"] ?? "UNKNOWN"}`);
      }
      errors.push(...dbBlocks(ctx.sidecarPath, "SIDECAR"));
      errors.push(...dbBlocks(primaryDbPath, "PRIMARY_DB"));
      manifestIdentity = loadAndValidateManifest(ctx.repoRoot);
      errors.push(...manifestIdentity.errors);
      return { ok: errors.length === 0, errors };
    },
    executeReadOnly: () => {
      const read = readN2PitAuditObservations({
        primaryDbPath,
        sidecarDbPath: ctx.sidecarPath,
      });
      const audit = buildN2PitAuditSummary(read.observations);
      const summary = {
        ...audit,
        executorContractVersion: N2_PIT_AUDIT_EXECUTOR_VERSION,
        datasetVersion: manifestIdentity!.datasetVersion,
        datasetManifestOutputDigest: manifestIdentity!.outputDigest,
        boundedObservationLimit: 100_000,
        returnedObservationCount: read.returnedObservationCount,
        truncated: read.truncated,
        readOnly: read.readOnly,
        queryOnly: read.queryOnly,
        sourceTypesRead: read.sourceTypes,
        sidecarWriteCount: 0,
        primaryDbWriteCount: 0,
        productionApplyExecuted: false,
      };
      return {
        outputs: [REPORT_RELATIVE_PATH],
        digest: canonicalHash(summary),
        summary,
      };
    },
    pitEvidence: (_sdk, artifact) => ({
      status: "PASS",
      validatorId: "n2-pit-audit",
      validatorVersion: N2_PIT_AUDIT_EXECUTOR_VERSION,
      checkedRecordCount: Number(artifact.summary.auditedObservationCount ?? 0),
      sameRaceViolationCount: Number(artifact.summary.sameRaceViolationCount ?? 0),
      futureViolationCount: Number(artifact.summary.futureViolationCount ?? 0),
      ambiguousTimingCount: Number(artifact.summary.ambiguousTimingCount ?? 0)
        + (artifact.summary.truncated === true ? 1 : 0),
      evidencePath: REPORT_RELATIVE_PATH,
      evidenceDigest: artifact.digest,
      notApplicableReason: null,
    }),
    writeArtifacts: (sdk, artifact) => {
      try {
        const payload = {
          ...artifact.summary,
          runId: ctx.runId,
          requestId: ctx.requestId,
          taskId: ctx.taskId,
          executorVersion: N2_PIT_AUDIT_EXECUTOR_VERSION,
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

  const outcome = runExecutorLifecycle(spec, sdkCtx);
  let result: ExecutorResult["result"] = outcome.result === "ENGINEERING_REQUIRED" ? "BLOCKED" : outcome.result;
  if (result === "PASS" && outcome.summary.status === "CONDITIONAL") result = "CONDITIONAL";
  return {
    result,
    executorVersion: N2_PIT_AUDIT_EXECUTOR_VERSION,
    summary: outcome.summary,
    outputs: outcome.outputs,
    outputDigest: outcome.digest || canonicalHash(outcome.summary),
    blocks: outcome.blocks,
  };
};
