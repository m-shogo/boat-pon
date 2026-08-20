import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { canonicalHash } from "../research-replay/canonical";
import {
  buildOfficialProgramCanaryManifest,
  resolveOfficialProgramCanaryGate,
} from "../research-replay/n2OfficialProgramCanary";
import { readOfficialProgramCanarySource } from "../research-replay/n2OfficialProgramCanaryReader";
import { buildOfficialProgramCanaryReviewBundle } from "../research-replay/n2OfficialProgramCanaryReviewBundle";
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

export const N2_OFFICIAL_PROGRAM_CANARY_REVIEW_EXECUTOR_VERSION =
  "n2-official-program-canary-review-executor-v2";
const REPORT_RELATIVE_PATH = "reports/n2/n2-official-program-canary-review-bundle.json";
const PRIMARY_DB_FILENAME = "boat.sqlite";

function databaseBlocks(path: string, code: string): string[] {
  if (!existsSync(path)) return [`${code}_NOT_FOUND`];
  const wal = `${path}-wal`;
  return existsSync(wal) && statSync(wal).size > 0 ? [`${code}_ACTIVE_WAL`] : [];
}

function openImmutable(path: string): DatabaseSync {
  const db = new DatabaseSync(`${pathToFileURL(path).href}?immutable=1`, { readOnly: true } as never);
  db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000");
  return db;
}

function checkoutSha(repoRoot: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

export const runN2OfficialProgramCanaryReviewBundleExecutor: Executor = (ctx) => {
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
    name: "official-program-canary-review-bundle",
    safetyLevel: "L0",
    implemented: true,
    inputContract: () => {
      const errors: string[] = [];
      if (ctx.taskStatuses["TASK-N2-012"] !== "PASS") {
        errors.push(`DEPENDENCY_NOT_SATISFIED:TASK-N2-012=${ctx.taskStatuses["TASK-N2-012"] ?? "UNKNOWN"}`);
      }
      errors.push(...databaseBlocks(primaryDbPath, "PRIMARY_DB"));
      errors.push(...databaseBlocks(ctx.sidecarPath, "SIDECAR"));
      return { ok: errors.length === 0, errors };
    },
    executeReadOnly: () => {
      const generatedAt = new Date().toISOString();
      const codeGitSha = checkoutSha(ctx.repoRoot);
      const source = readOfficialProgramCanarySource({ primaryDbPath });
      const manifest = buildOfficialProgramCanaryManifest({
        rows: source.rows,
        cohort: source.cohort,
        sourceReadTruncated: source.truncated,
        maxRaces: 20,
        codeGitSha,
        generatedAt,
      });
      const readinessRead = readN2ObservationIngestReadiness({
        primaryDbPath,
        sidecarDbPath: ctx.sidecarPath,
      });
      const rolloutState = readCanonicalRolloutState(ctx.sidecarPath);
      const readiness = buildN2ObservationIngestReadiness({
        ...readinessRead.input,
        rollout: {
          ...readinessRead.input.rollout,
          ...rolloutState,
        },
      });
      const sidecar = openImmutable(ctx.sidecarPath);
      try {
        const gatePreview = resolveOfficialProgramCanaryGate(sidecar, {
          manifest,
          executionMode: "production",
          rolloutStartedAt: generatedAt,
          onDisk: {
            codeGitSha,
            hasActiveWal: false,
            diskFreeBytes: Number.MAX_SAFE_INTEGER,
            neededBytes: 1,
            shadowWriteEnabled: readiness.rollout.shadowWriteEnabled,
            killSwitchEngaged: readiness.rollout.killSwitchEngaged,
          },
        });
        const bundle = buildOfficialProgramCanaryReviewBundle({
          manifest,
          authoritySha: codeGitSha,
          generatedAt,
          currentOfficialProgramObservationCount: readiness.sidecar.officialProgramObservationCount,
          currentTrifectaMarketObservationCount: readiness.sidecar.trifectaMarketObservationCount,
          currentGlobalShadowWriteEnabled: readiness.rollout.shadowWriteEnabled,
          currentKillSwitchEngaged: readiness.rollout.killSwitchEngaged,
          approvalPreview: {
            approved: gatePreview.approved,
            code: gatePreview.approval.code,
            approvalId: gatePreview.approval.approvalId,
            blocks: gatePreview.blocks,
          },
        });
        const summary = {
          ...bundle,
          sourceIdentity: {
            primaryTable: "official_programs",
            sourceReaderVersion: source.readerVersion,
            readinessReaderVersion: readinessRead.sourceIdentity.readerVersion,
          },
          sourceReadOnly: source.readOnly,
          sourceQueryOnly: source.queryOnly,
          primaryDatabaseWriteCount: 0,
          sidecarDatabaseWriteCount: 0,
          approvalWriteCount: 0,
          productionApplyExecuted: false,
          executorContractVersion: N2_OFFICIAL_PROGRAM_CANARY_REVIEW_EXECUTOR_VERSION,
        };
        return {
          outputs: [REPORT_RELATIVE_PATH],
          digest: canonicalHash(bundle.binding),
          summary,
        };
      } finally {
        sidecar.close();
      }
    },
    pitEvidence: (_sdk, artifact) => ({
      status: "NOT_APPLICABLE",
      validatorId: "n2-official-program-canary-review-pit-applicability",
      validatorVersion: N2_OFFICIAL_PROGRAM_CANARY_REVIEW_EXECUTOR_VERSION,
      checkedRecordCount: Number(
        (artifact.summary.manifest as { binding?: { sourceRowCount?: number } } | undefined)
          ?.binding?.sourceRowCount ?? 0,
      ),
      sameRaceViolationCount: 0,
      futureViolationCount: 0,
      ambiguousTimingCount: 0,
      evidencePath: null,
      evidenceDigest: null,
      notApplicableReason: "review bundle generation does not join outcomes or authorize prediction-time writes",
    }),
    writeArtifacts: (sdk, artifact) => {
      try {
        const payload = {
          ...artifact.summary,
          runId: ctx.runId,
          requestId: ctx.requestId,
          taskId: ctx.taskId,
          executorVersion: N2_OFFICIAL_PROGRAM_CANARY_REVIEW_EXECUTOR_VERSION,
          outputDigest: artifact.digest,
        };
        atomicWriteJson(join(sdk.repoRoot, REPORT_RELATIVE_PATH), payload, true);
        return { ok: true, errors: [], outputs: [REPORT_RELATIVE_PATH] };
      } catch (error) {
        return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
      }
    },
    verifyArtifacts: (sdk, artifact) => verifyJsonReadback(
      join(sdk.repoRoot, REPORT_RELATIVE_PATH),
      artifact.digest,
    ),
    recordEvidence: (_sdk, _artifact, outputs) => ({ ok: true, errors: [], outputs }),
    finalizeEvidence: (_sdk, _artifact, outputs) => ({ ok: true, errors: [], outputs }),
  };

  const outcome = runExecutorLifecycle(spec, sdkContext);
  const result: ExecutorResult["result"] = outcome.result === "ENGINEERING_REQUIRED"
    ? "BLOCKED"
    : outcome.result;
  return {
    result,
    executorVersion: N2_OFFICIAL_PROGRAM_CANARY_REVIEW_EXECUTOR_VERSION,
    summary: outcome.summary,
    outputs: outcome.outputs,
    outputDigest: outcome.digest || canonicalHash(outcome.summary),
    blocks: outcome.blocks,
  };
};
