import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

export const N2_PIT_AUDIT_EXECUTOR_VERSION = "n2-pit-audit-executor-v3";
const REPORT_RELATIVE_PATH = "reports/n2/n2-pit-audit.json";
const MANIFEST_RELATIVE_PATH = "reports/n2/n2-dataset-manifest.json";
const MANIFEST_PATH_ENV = "BOAT_PON_N2_DATASET_MANIFEST_PATH";
const MAX_MANIFEST_BYTES = 2_097_152;
const PRIMARY_DB_FILENAME = "boat.sqlite";
const DATASET_PIT_VALIDATOR_ID = "settlement-inventory-pit-applicability";
const DATASET_PIT_VALIDATOR_VERSION = "v1";
const DATASET_PIT_NOT_APPLICABLE_REASON = "settlement inventory does not join prediction-time features";
const MANIFEST_METADATA_KEYS = [
  "runId",
  "requestId",
  "taskId",
  "executorVersion",
  "generatedAt",
  "outputDigest",
  "pitEvidence",
] as const;

type DatasetPitEvidence = {
  status: "NOT_APPLICABLE";
  validatorId: string;
  validatorVersion: string;
  checkedRecordCount: number;
  sameRaceViolationCount: number;
  futureViolationCount: number;
  ambiguousTimingCount: number;
  evidencePath: null;
  evidenceDigest: null;
  notApplicableReason: string;
};

function dbBlocks(path: string, code: string): string[] {
  if (!existsSync(path)) return [`${code}_NOT_FOUND`];
  const wal = `${path}-wal`;
  return existsSync(wal) && statSync(wal).size > 0 ? [`${code}_ACTIVE_WAL`] : [];
}

function resolveManifestPath(repoRoot: string): string {
  const configured = process.env[MANIFEST_PATH_ENV]?.trim();
  return configured ? resolve(configured) : join(repoRoot, MANIFEST_RELATIVE_PATH);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validateDatasetPitEnvelope(parsed: Record<string, unknown>, expectedCount: number | null): {
  evidence: DatasetPitEvidence | null;
  errors: string[];
} {
  const errors: string[] = [];
  const raw = asRecord(parsed.pitEvidence);
  if (!raw) {
    return { evidence: null, errors: ["N2_DATASET_MANIFEST_PIT_EVIDENCE_MISSING"] };
  }
  if (raw.status !== "NOT_APPLICABLE") errors.push("N2_DATASET_MANIFEST_PIT_STATUS_INVALID");
  if (raw.validatorId !== DATASET_PIT_VALIDATOR_ID) errors.push("N2_DATASET_MANIFEST_PIT_VALIDATOR_ID_MISMATCH");
  if (raw.validatorVersion !== DATASET_PIT_VALIDATOR_VERSION) errors.push("N2_DATASET_MANIFEST_PIT_VALIDATOR_VERSION_MISMATCH");
  if (!isNonNegativeInteger(raw.checkedRecordCount)) {
    errors.push("N2_DATASET_MANIFEST_PIT_CHECKED_COUNT_INVALID");
  } else if (expectedCount !== null && raw.checkedRecordCount !== expectedCount) {
    errors.push("N2_DATASET_MANIFEST_PIT_CHECKED_COUNT_MISMATCH");
  }
  for (const [field, code] of [
    ["sameRaceViolationCount", "N2_DATASET_MANIFEST_PIT_SAME_RACE_VIOLATION"],
    ["futureViolationCount", "N2_DATASET_MANIFEST_PIT_FUTURE_VIOLATION"],
    ["ambiguousTimingCount", "N2_DATASET_MANIFEST_PIT_AMBIGUOUS_TIMING"],
  ] as const) {
    if (!isNonNegativeInteger(raw[field]) || raw[field] !== 0) errors.push(code);
  }
  if (raw.evidencePath !== null) errors.push("N2_DATASET_MANIFEST_PIT_EVIDENCE_PATH_INVALID");
  if (raw.evidenceDigest !== null) errors.push("N2_DATASET_MANIFEST_PIT_EVIDENCE_DIGEST_INVALID");
  if (raw.notApplicableReason !== DATASET_PIT_NOT_APPLICABLE_REASON) {
    errors.push("N2_DATASET_MANIFEST_PIT_REASON_MISMATCH");
  }
  if (errors.length > 0) return { evidence: null, errors };
  return { evidence: raw as unknown as DatasetPitEvidence, errors: [] };
}

function loadAndValidateManifest(repoRoot: string): {
  ok: boolean;
  errors: string[];
  outputDigest: string | null;
  datasetVersion: string | null;
  pitEvidence: DatasetPitEvidence | null;
} {
  const path = resolveManifestPath(repoRoot);
  if (!existsSync(path)) {
    return {
      ok: false,
      errors: ["N2_DATASET_MANIFEST_MISSING"],
      outputDigest: null,
      datasetVersion: null,
      pitEvidence: null,
    };
  }
  if (lstatSync(path).isSymbolicLink()) {
    return {
      ok: false,
      errors: ["N2_DATASET_MANIFEST_SYMLINK"],
      outputDigest: null,
      datasetVersion: null,
      pitEvidence: null,
    };
  }
  if (statSync(path).size > MAX_MANIFEST_BYTES) {
    return {
      ok: false,
      errors: ["N2_DATASET_MANIFEST_TOO_LARGE"],
      outputDigest: null,
      datasetVersion: null,
      pitEvidence: null,
    };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      errors: ["N2_DATASET_MANIFEST_INVALID_JSON"],
      outputDigest: null,
      datasetVersion: null,
      pitEvidence: null,
    };
  }

  const errors: string[] = [];
  if (parsed.datasetManifestVersion !== "n2-dataset-manifest-v2") errors.push("N2_DATASET_MANIFEST_VERSION_MISMATCH");
  if (typeof parsed.datasetVersion !== "string" || parsed.datasetVersion.length === 0) errors.push("N2_DATASET_VERSION_MISSING");
  if (parsed.holdoutExcludedFromResearchCohort !== true) errors.push("N2_HOLDOUT_NOT_EXCLUDED");
  if (parsed.readOnly !== true) errors.push("N2_DATASET_MANIFEST_NOT_READ_ONLY");

  const inventoryTotals = asRecord(parsed.inventoryTotals);
  const candidateCount = inventoryTotals && isNonNegativeInteger(inventoryTotals.candidates)
    ? inventoryTotals.candidates
    : null;
  if (candidateCount === null) errors.push("N2_DATASET_MANIFEST_INVENTORY_CANDIDATES_INVALID");

  const pit = validateDatasetPitEnvelope(parsed, candidateCount);
  errors.push(...pit.errors);

  if (typeof parsed.outputDigest !== "string" || !/^[0-9a-f]{64}$/.test(parsed.outputDigest)) {
    errors.push("N2_DATASET_MANIFEST_OUTPUT_DIGEST_INVALID");
  } else {
    // N2-010 fixes the digest over the executor artifact summary. The SDK then
    // appends PIT evidence before persistence. Validate that envelope separately
    // above, and recompute the producer's original core-summary digest here.
    const digestable = { ...parsed };
    for (const key of MANIFEST_METADATA_KEYS) delete digestable[key];
    if (canonicalHash(digestable) !== parsed.outputDigest) {
      errors.push("N2_DATASET_MANIFEST_OUTPUT_DIGEST_MISMATCH");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    outputDigest: typeof parsed.outputDigest === "string" ? parsed.outputDigest : null,
    datasetVersion: typeof parsed.datasetVersion === "string" ? parsed.datasetVersion : null,
    pitEvidence: pit.evidence,
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
        datasetManifestPitValidatorId: manifestIdentity!.pitEvidence!.validatorId,
        datasetManifestPitCheckedRecordCount: manifestIdentity!.pitEvidence!.checkedRecordCount,
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
