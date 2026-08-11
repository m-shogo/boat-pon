import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";

import { contractDigest } from "../research/governance/contracts";
import { readGovernanceFileUtf8Bounded } from "../research/governance/safeFs";

export const RESEARCH_DURABLE_KNOWLEDGE_COMPLETENESS_VERSION =
  "research-durable-knowledge-completeness-v1" as const;

const HISTORY_RELATIVE_DIR = "reports/automation/history";
const MAX_HISTORY_BYTES = 8_000_000;
const MAX_OUTPUT_BYTES = 32_000_000;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const GIT_SHA_RE = /^[0-9a-f]{40}$/u;
const RUN_ID_RE = /^[0-9]+$/u;
const TASK_ID_RE = /^TASK-[0-9A-Za-z._-]+$/u;
const RESULTS = ["PASS", "DRY_RUN_OK", "CONDITIONAL", "BLOCKED", "FAILED"] as const;
const ALLOWED_OUTPUT_ROOTS = [
  "reports/n2/",
  "reports/automation/",
  "research/registries/",
  "automation/control/",
] as const;

export type ResearchAutomationHistoryResult = (typeof RESULTS)[number];

export type ResearchDurableOutputIntegrity =
  | "RETAINED_CONTENT_DIGEST_VERIFIED"
  | "REGISTRY_SELF_DIGEST_VERIFIED"
  | "CURRENT_OUTPUT_DIGEST_MATCH"
  | "CURRENT_OUTPUT_DIGEST_SUPERSEDED"
  | "JSON_PRESENT_NO_OUTPUT_DIGEST"
  | "TEXT_PRESENT";

export type ResearchDurableOutputAssessment = {
  relativePath: string;
  rootClass: "REPORT" | "REGISTRY" | "CONTROL" | "RETAINED";
  integrity: ResearchDurableOutputIntegrity | null;
  exists: boolean;
  regularFile: boolean;
  bytes: number | null;
  contentDigest: string | null;
  embeddedDigest: string | null;
  historyDigestMatchesEmbedded: boolean | null;
  complete: boolean;
  issues: string[];
  warnings: string[];
};

export type ResearchDurableRunClassification =
  | "PASS_DURABLE_OUTPUTS"
  | "PASS_NO_CHANGE_HISTORY"
  | "NON_PASS_DURABLE_HISTORY"
  | "INCOMPLETE_PASS_NO_OUTPUT"
  | "INVALID_PERSISTED_DRY_RUN"
  | "INVALID_HISTORY"
  | "INCOMPLETE_OUTPUT_REFERENCE";

export type ResearchDurableRunAssessment = {
  historyRelativePath: string;
  historyContentDigest: string;
  runId: string | null;
  requestId: string | null;
  intentId: string | null;
  taskId: string | null;
  taskType: string | null;
  result: ResearchAutomationHistoryResult | null;
  executed: boolean | null;
  startedAt: string | null;
  completedAt: string | null;
  outputDigest: string | null;
  outputCount: number;
  verifiedOutputCount: number;
  mutableSupersededReferenceCount: number;
  registryOutputCount: number;
  explicitNoChange: boolean;
  classification: ResearchDurableRunClassification;
  durableComplete: boolean;
  strongDurableComplete: boolean;
  issues: string[];
  warnings: string[];
  outputs: ResearchDurableOutputAssessment[];
};

export type ResearchDurableKnowledgeCompletenessReport = {
  reportVersion: typeof RESEARCH_DURABLE_KNOWLEDGE_COMPLETENESS_VERSION;
  evidenceRole: "RESEARCH_KNOWLEDGE_RETENTION_AUDIT_ONLY";
  generatedAt: string;
  historyRelativeDir: typeof HISTORY_RELATIVE_DIR;
  status: "PASS" | "DEGRADED" | "BLOCKED" | "NO_HISTORY";
  historyFileCount: number;
  assessedRunCount: number;
  passCount: number;
  conditionalCount: number;
  blockedCount: number;
  failedCount: number;
  persistedDryRunCount: number;
  durableCompleteCount: number;
  strongDurableCompleteCount: number;
  incompleteCount: number;
  invalidHistoryCount: number;
  passWithDurableOutputsCount: number;
  passNoChangeHistoryCount: number;
  nonPassDurableHistoryCount: number;
  missingOutputReferenceCount: number;
  invalidOutputReferenceCount: number;
  mutableSupersededReferenceCount: number;
  registryOutputCount: number;
  currentOutputDigestMatchCount: number;
  earliestCompletedAt: string | null;
  latestCompletedAt: string | null;
  taskTypeCounts: Record<string, number>;
  classificationCounts: Record<ResearchDurableRunClassification, number>;
  runs: ResearchDurableRunAssessment[];
  automaticPromotionAuthorized: false;
  currentBuyConnectionAuthorized: false;
  lineConnectionAuthorized: false;
  publicPublishAuthorized: false;
  databaseWriteAuthorized: false;
  automatedBettingAuthorized: false;
  productionApplyAuthorized: false;
  outputDigest: string;
};

type HistoryLike = {
  runId?: unknown;
  requestId?: unknown;
  intentId?: unknown;
  taskId?: unknown;
  taskType?: unknown;
  safetyLevel?: unknown;
  executorVersion?: unknown;
  executed?: unknown;
  result?: unknown;
  blocks?: unknown;
  outputs?: unknown;
  outputDigest?: unknown;
  summary?: unknown;
  authoritySha?: unknown;
  idempotencyKey?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
  elapsedMs?: unknown;
};

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function parseInstant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveInside(rootDir: string, relativePath: string): string {
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error("DURABLE_KNOWLEDGE_PATH_UNSAFE");
  }
  const root = resolve(rootDir);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("DURABLE_KNOWLEDGE_PATH_ESCAPES_ROOT");
  }
  return target;
}

function safeRelativeOutputPath(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.startsWith("/") || value.includes("\0")) return null;
  if (value.split("/").some((part) => part === "..")) return null;
  if (value.startsWith(`${HISTORY_RELATIVE_DIR}/`)) return null;
  return ALLOWED_OUTPUT_ROOTS.some((root) => value.startsWith(root)) ? value : null;
}

function outputRootClass(relativePath: string): ResearchDurableOutputAssessment["rootClass"] {
  if (relativePath.startsWith("reports/automation/retained-outputs/")) return "RETAINED";
  if (relativePath.startsWith("research/registries/")) return "REGISTRY";
  if (relativePath.startsWith("automation/control/")) return "CONTROL";
  return "REPORT";
}

function hasStrongOutputIntegrity(output: ResearchDurableOutputAssessment): boolean {
  return output.integrity === "RETAINED_CONTENT_DIGEST_VERIFIED"
    || output.integrity === "REGISTRY_SELF_DIGEST_VERIFIED"
    || output.integrity === "CURRENT_OUTPUT_DIGEST_MATCH";
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function explicitNoChange(summary: unknown): boolean {
  const value = objectValue(summary);
  if (!value) return false;
  if (value.noChange === true || value.noChangeEngineeringRequired === true) return true;
  for (const key of ["status", "result", "state"]) {
    const text = value[key];
    if (typeof text === "string" && /^NO_CHANGE(?:_|$)/u.test(text)) return true;
  }
  return false;
}

function verifyRegistryDigest(value: Record<string, unknown>): boolean {
  if (typeof value._digest !== "string" || !SHA256_RE.test(value._digest)) return false;
  const { _digest, _recordedAt, ...body } = value;
  return contractDigest(body) === _digest;
}

function assessOutput(input: {
  repoRoot: string;
  relativePath: string;
  historyOutputDigest: string;
}): ResearchDurableOutputAssessment {
  const rootClass = outputRootClass(input.relativePath);
  const issues: string[] = [];
  const warnings: string[] = [];
  let absolutePath: string;
  try {
    absolutePath = resolveInside(input.repoRoot, input.relativePath);
  } catch (error) {
    return {
      relativePath: input.relativePath,
      rootClass,
      integrity: null,
      exists: false,
      regularFile: false,
      bytes: null,
      contentDigest: null,
      embeddedDigest: null,
      historyDigestMatchesEmbedded: null,
      complete: false,
      issues: [error instanceof Error ? error.message : String(error)],
      warnings,
    };
  }
  if (!existsSync(absolutePath)) {
    return {
      relativePath: input.relativePath,
      rootClass,
      integrity: null,
      exists: false,
      regularFile: false,
      bytes: null,
      contentDigest: null,
      embeddedDigest: null,
      historyDigestMatchesEmbedded: null,
      complete: false,
      issues: ["DURABLE_OUTPUT_MISSING"],
      warnings,
    };
  }
  const lst = lstatSync(absolutePath);
  if (lst.isSymbolicLink() || !lst.isFile()) {
    return {
      relativePath: input.relativePath,
      rootClass,
      integrity: null,
      exists: true,
      regularFile: false,
      bytes: null,
      contentDigest: null,
      embeddedDigest: null,
      historyDigestMatchesEmbedded: null,
      complete: false,
      issues: ["DURABLE_OUTPUT_FILE_TYPE_INVALID"],
      warnings,
    };
  }
  const stat = statSync(absolutePath);
  if (stat.size <= 0 || stat.size > MAX_OUTPUT_BYTES) {
    return {
      relativePath: input.relativePath,
      rootClass,
      integrity: null,
      exists: true,
      regularFile: true,
      bytes: stat.size,
      contentDigest: null,
      embeddedDigest: null,
      historyDigestMatchesEmbedded: null,
      complete: false,
      issues: ["DURABLE_OUTPUT_SIZE_INVALID"],
      warnings,
    };
  }
  const text = readGovernanceFileUtf8Bounded(absolutePath, MAX_OUTPUT_BYTES).text;
  const contentDigest = sha256Text(text);
  if (rootClass === "RETAINED") {
    const retainedMatch = input.relativePath.match(
      /^reports\/automation\/retained-outputs\/[0-9A-Za-z._-]+\/([0-9a-f]{64})-[^/]+$/u,
    );
    const expectedContentDigest = retainedMatch?.[1] ?? null;
    if (expectedContentDigest == null) {
      return {
        relativePath: input.relativePath, rootClass, integrity: null, exists: true, regularFile: true,
        bytes: stat.size, contentDigest, embeddedDigest: null, historyDigestMatchesEmbedded: null,
        complete: false, issues: ["DURABLE_RETAINED_PATH_INVALID"], warnings,
      };
    }
    if (expectedContentDigest !== contentDigest) {
      return {
        relativePath: input.relativePath, rootClass, integrity: null, exists: true, regularFile: true,
        bytes: stat.size, contentDigest, embeddedDigest: null, historyDigestMatchesEmbedded: null,
        complete: false, issues: ["DURABLE_RETAINED_CONTENT_DIGEST_MISMATCH"], warnings,
      };
    }
    let retainedEmbeddedDigest: string | null = null;
    if (input.relativePath.endsWith(".json")) {
      try {
        const retainedValue = objectValue(JSON.parse(text) as unknown);
        if (!retainedValue) throw new Error("not object");
        retainedEmbeddedDigest = typeof retainedValue.outputDigest === "string" && SHA256_RE.test(retainedValue.outputDigest)
          ? retainedValue.outputDigest
          : null;
      } catch {
        return {
          relativePath: input.relativePath, rootClass, integrity: null, exists: true, regularFile: true,
          bytes: stat.size, contentDigest, embeddedDigest: null, historyDigestMatchesEmbedded: null,
          complete: false, issues: ["DURABLE_OUTPUT_JSON_INVALID"], warnings,
        };
      }
    }
    if (retainedEmbeddedDigest != null && retainedEmbeddedDigest !== input.historyOutputDigest) {
      return {
        relativePath: input.relativePath, rootClass, integrity: null, exists: true, regularFile: true,
        bytes: stat.size, contentDigest, embeddedDigest: retainedEmbeddedDigest, historyDigestMatchesEmbedded: false,
        complete: false, issues: ["DURABLE_RETAINED_HISTORY_DIGEST_MISMATCH"], warnings,
      };
    }
    return {
      relativePath: input.relativePath, rootClass, integrity: "RETAINED_CONTENT_DIGEST_VERIFIED",
      exists: true, regularFile: true, bytes: stat.size, contentDigest, embeddedDigest: retainedEmbeddedDigest,
      historyDigestMatchesEmbedded: retainedEmbeddedDigest == null ? null : true,
      complete: true, issues, warnings,
    };
  }
  if (!input.relativePath.endsWith(".json")) {
    return {
      relativePath: input.relativePath,
      rootClass,
      integrity: "TEXT_PRESENT",
      exists: true,
      regularFile: true,
      bytes: stat.size,
      contentDigest,
      embeddedDigest: null,
      historyDigestMatchesEmbedded: null,
      complete: true,
      issues,
      warnings,
    };
  }

  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(text) as unknown;
    const object = objectValue(value);
    if (!object) throw new Error("not object");
    parsed = object;
  } catch {
    return {
      relativePath: input.relativePath,
      rootClass,
      integrity: null,
      exists: true,
      regularFile: true,
      bytes: stat.size,
      contentDigest,
      embeddedDigest: null,
      historyDigestMatchesEmbedded: null,
      complete: false,
      issues: ["DURABLE_OUTPUT_JSON_INVALID"],
      warnings,
    };
  }

  if (rootClass === "REGISTRY") {
    if (!verifyRegistryDigest(parsed)) {
      issues.push("DURABLE_REGISTRY_SELF_DIGEST_INVALID");
      return {
        relativePath: input.relativePath,
        rootClass,
        integrity: null,
        exists: true,
        regularFile: true,
        bytes: stat.size,
        contentDigest,
        embeddedDigest: typeof parsed._digest === "string" ? parsed._digest : null,
        historyDigestMatchesEmbedded: null,
        complete: false,
        issues,
        warnings,
      };
    }
    return {
      relativePath: input.relativePath,
      rootClass,
      integrity: "REGISTRY_SELF_DIGEST_VERIFIED",
      exists: true,
      regularFile: true,
      bytes: stat.size,
      contentDigest,
      embeddedDigest: parsed._digest as string,
      historyDigestMatchesEmbedded: null,
      complete: true,
      issues,
      warnings,
    };
  }

  const embeddedDigest = typeof parsed.outputDigest === "string" && SHA256_RE.test(parsed.outputDigest)
    ? parsed.outputDigest
    : null;
  if (embeddedDigest == null) {
    warnings.push("DURABLE_OUTPUT_EMBEDDED_DIGEST_UNAVAILABLE");
    return {
      relativePath: input.relativePath,
      rootClass,
      integrity: "JSON_PRESENT_NO_OUTPUT_DIGEST",
      exists: true,
      regularFile: true,
      bytes: stat.size,
      contentDigest,
      embeddedDigest: null,
      historyDigestMatchesEmbedded: null,
      complete: true,
      issues,
      warnings,
    };
  }
  const matches = embeddedDigest === input.historyOutputDigest;
  if (!matches) warnings.push("DURABLE_MUTABLE_OUTPUT_SUPERSEDED");
  return {
    relativePath: input.relativePath,
    rootClass,
    integrity: matches ? "CURRENT_OUTPUT_DIGEST_MATCH" : "CURRENT_OUTPUT_DIGEST_SUPERSEDED",
    exists: true,
    regularFile: true,
    bytes: stat.size,
    contentDigest,
    embeddedDigest,
    historyDigestMatchesEmbedded: matches,
    complete: true,
    issues,
    warnings,
  };
}

function invalidRunAssessment(input: {
  relativePath: string;
  contentDigest: string;
  partial: HistoryLike;
  issues: string[];
}): ResearchDurableRunAssessment {
  return {
    historyRelativePath: input.relativePath,
    historyContentDigest: input.contentDigest,
    runId: typeof input.partial.runId === "string" ? input.partial.runId : null,
    requestId: typeof input.partial.requestId === "string" ? input.partial.requestId : null,
    intentId: typeof input.partial.intentId === "string" ? input.partial.intentId : null,
    taskId: typeof input.partial.taskId === "string" ? input.partial.taskId : null,
    taskType: typeof input.partial.taskType === "string" ? input.partial.taskType : null,
    result: RESULTS.includes(input.partial.result as ResearchAutomationHistoryResult)
      ? input.partial.result as ResearchAutomationHistoryResult
      : null,
    executed: typeof input.partial.executed === "boolean" ? input.partial.executed : null,
    startedAt: typeof input.partial.startedAt === "string" ? input.partial.startedAt : null,
    completedAt: typeof input.partial.completedAt === "string" ? input.partial.completedAt : null,
    outputDigest: typeof input.partial.outputDigest === "string" ? input.partial.outputDigest : null,
    outputCount: Array.isArray(input.partial.outputs) ? input.partial.outputs.length : 0,
    verifiedOutputCount: 0,
    mutableSupersededReferenceCount: 0,
    registryOutputCount: 0,
    explicitNoChange: explicitNoChange(input.partial.summary),
    classification: "INVALID_HISTORY",
    durableComplete: false,
    strongDurableComplete: false,
    issues: [...new Set(input.issues)].sort(),
    warnings: [],
    outputs: [],
  };
}

function assessHistoryFile(input: {
  repoRoot: string;
  historyRelativePath: string;
}): ResearchDurableRunAssessment {
  const absolutePath = resolveInside(input.repoRoot, input.historyRelativePath);
  const stat = lstatSync(absolutePath);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > MAX_HISTORY_BYTES) {
    return invalidRunAssessment({
      relativePath: input.historyRelativePath,
      contentDigest: "",
      partial: {},
      issues: ["HISTORY_FILE_SIZE_OR_TYPE_INVALID"],
    });
  }
  const text = readGovernanceFileUtf8Bounded(absolutePath, MAX_HISTORY_BYTES).text;
  const contentDigest = sha256Text(text);
  let history: HistoryLike;
  try {
    const parsed = JSON.parse(text) as unknown;
    const object = objectValue(parsed);
    if (!object) throw new Error("not object");
    history = object as HistoryLike;
  } catch {
    return invalidRunAssessment({
      relativePath: input.historyRelativePath,
      contentDigest,
      partial: {},
      issues: ["HISTORY_JSON_INVALID"],
    });
  }

  const issues: string[] = [];
  if (typeof history.runId !== "string" || !RUN_ID_RE.test(history.runId)) issues.push("HISTORY_RUN_ID_INVALID");
  if (typeof history.requestId !== "string" || history.requestId.length === 0) issues.push("HISTORY_REQUEST_ID_INVALID");
  if (typeof history.intentId !== "string" || history.intentId.length === 0) issues.push("HISTORY_INTENT_ID_INVALID");
  if (typeof history.taskId !== "string" || !TASK_ID_RE.test(history.taskId)) issues.push("HISTORY_TASK_ID_INVALID");
  if (typeof history.taskType !== "string" || history.taskType.length === 0) issues.push("HISTORY_TASK_TYPE_INVALID");
  if (typeof history.safetyLevel !== "string" || !/^L[0-3]$/u.test(history.safetyLevel)) issues.push("HISTORY_SAFETY_LEVEL_INVALID");
  if (typeof history.executorVersion !== "string" || history.executorVersion.length === 0) issues.push("HISTORY_EXECUTOR_VERSION_INVALID");
  if (history.executed !== true) issues.push("HISTORY_EXECUTED_NOT_TRUE");
  if (!RESULTS.includes(history.result as ResearchAutomationHistoryResult)) issues.push("HISTORY_RESULT_INVALID");
  if (!Array.isArray(history.blocks) || history.blocks.some((value) => typeof value !== "string")) issues.push("HISTORY_BLOCKS_INVALID");
  if (!Array.isArray(history.outputs) || history.outputs.some((value) => typeof value !== "string")) issues.push("HISTORY_OUTPUTS_INVALID");
  if (typeof history.outputDigest !== "string" || !SHA256_RE.test(history.outputDigest)) issues.push("HISTORY_OUTPUT_DIGEST_INVALID");
  if (!objectValue(history.summary)) issues.push("HISTORY_SUMMARY_INVALID");
  if (typeof history.authoritySha !== "string" || !GIT_SHA_RE.test(history.authoritySha)) issues.push("HISTORY_AUTHORITY_SHA_INVALID");
  if (typeof history.idempotencyKey !== "string" || !SHA256_RE.test(history.idempotencyKey)) issues.push("HISTORY_IDEMPOTENCY_KEY_INVALID");
  const startedAtMs = parseInstant(history.startedAt);
  const completedAtMs = parseInstant(history.completedAt);
  if (startedAtMs == null) issues.push("HISTORY_STARTED_AT_INVALID");
  if (completedAtMs == null) issues.push("HISTORY_COMPLETED_AT_INVALID");
  if (startedAtMs != null && completedAtMs != null && completedAtMs < startedAtMs) issues.push("HISTORY_TIME_ORDER_INVALID");
  if (!Number.isSafeInteger(history.elapsedMs) || (history.elapsedMs as number) < 0) issues.push("HISTORY_ELAPSED_MS_INVALID");
  if (typeof history.runId === "string" && typeof history.taskId === "string") {
    const expectedName = `${history.runId}-${history.taskId}.json`;
    const actualName = input.historyRelativePath.slice(input.historyRelativePath.lastIndexOf("/") + 1);
    if (actualName !== expectedName) issues.push("HISTORY_FILENAME_IDENTITY_MISMATCH");
  }
  if (Array.isArray(history.outputs)) {
    const safeOutputs = history.outputs.map(safeRelativeOutputPath);
    if (safeOutputs.some((value) => value == null)) issues.push("HISTORY_OUTPUT_PATH_NOT_APPROVED");
    const strings = history.outputs.filter((value): value is string => typeof value === "string");
    if (new Set(strings).size !== strings.length) issues.push("HISTORY_OUTPUT_PATH_DUPLICATE");
  }
  if (history.result === "PASS" && Array.isArray(history.blocks) && history.blocks.length > 0) {
    issues.push("HISTORY_PASS_HAS_BLOCKS");
  }
  if ((history.result === "BLOCKED" || history.result === "FAILED")
    && Array.isArray(history.blocks) && history.blocks.length === 0) {
    issues.push("HISTORY_NONPASS_BLOCKS_EMPTY");
  }
  if (issues.length > 0) {
    return invalidRunAssessment({
      relativePath: input.historyRelativePath,
      contentDigest,
      partial: history,
      issues,
    });
  }

  const result = history.result as ResearchAutomationHistoryResult;
  const outputDigest = history.outputDigest as string;
  const outputPaths = (history.outputs as string[]).map((value) => safeRelativeOutputPath(value)!);
  const outputs = outputPaths.map((relativePath) => assessOutput({
    repoRoot: input.repoRoot,
    relativePath,
    historyOutputDigest: outputDigest,
  }));
  const outputIssues = outputs.flatMap((output) => output.issues.map((issue) => `${output.relativePath}:${issue}`));
  const outputWarnings = outputs.flatMap((output) => output.warnings.map((warning) => `${output.relativePath}:${warning}`));
  const verifiedOutputCount = outputs.filter((output) => output.complete).length;
  const superseded = outputs.filter((output) => output.integrity === "CURRENT_OUTPUT_DIGEST_SUPERSEDED").length;
  const registryOutputCount = outputs.filter((output) => output.rootClass === "REGISTRY").length;
  const noChange = explicitNoChange(history.summary);

  if (result === "DRY_RUN_OK") {
    return {
      historyRelativePath: input.historyRelativePath,
      historyContentDigest: contentDigest,
      runId: history.runId as string,
      requestId: history.requestId as string,
      intentId: history.intentId as string,
      taskId: history.taskId as string,
      taskType: history.taskType as string,
      result,
      executed: true,
      startedAt: history.startedAt as string,
      completedAt: history.completedAt as string,
      outputDigest,
      outputCount: outputPaths.length,
      verifiedOutputCount,
      mutableSupersededReferenceCount: superseded,
      registryOutputCount,
      explicitNoChange: noChange,
      classification: "INVALID_PERSISTED_DRY_RUN",
      durableComplete: false,
      strongDurableComplete: false,
      issues: ["PERSISTED_DRY_RUN_NOT_ALLOWED", ...outputIssues],
      warnings: outputWarnings,
      outputs,
    };
  }

  if (result === "PASS") {
    if (outputPaths.length === 0) {
      return {
        historyRelativePath: input.historyRelativePath,
        historyContentDigest: contentDigest,
        runId: history.runId as string,
        requestId: history.requestId as string,
        intentId: history.intentId as string,
        taskId: history.taskId as string,
        taskType: history.taskType as string,
        result,
        executed: true,
        startedAt: history.startedAt as string,
        completedAt: history.completedAt as string,
        outputDigest,
        outputCount: 0,
        verifiedOutputCount: 0,
        mutableSupersededReferenceCount: 0,
        registryOutputCount: 0,
        explicitNoChange: noChange,
        classification: noChange ? "PASS_NO_CHANGE_HISTORY" : "INCOMPLETE_PASS_NO_OUTPUT",
        durableComplete: noChange,
        strongDurableComplete: noChange,
        issues: noChange ? [] : ["PASS_HAS_NO_DURABLE_OUTPUT"],
        warnings: [],
        outputs: [],
      };
    }
    const allOutputsComplete = verifiedOutputCount === outputPaths.length;
    const allOutputsStrong = outputs.every(hasStrongOutputIntegrity);
    return {
      historyRelativePath: input.historyRelativePath,
      historyContentDigest: contentDigest,
      runId: history.runId as string,
      requestId: history.requestId as string,
      intentId: history.intentId as string,
      taskId: history.taskId as string,
      taskType: history.taskType as string,
      result,
      executed: true,
      startedAt: history.startedAt as string,
      completedAt: history.completedAt as string,
      outputDigest,
      outputCount: outputPaths.length,
      verifiedOutputCount,
      mutableSupersededReferenceCount: superseded,
      registryOutputCount,
      explicitNoChange: noChange,
      classification: allOutputsComplete ? "PASS_DURABLE_OUTPUTS" : "INCOMPLETE_OUTPUT_REFERENCE",
      durableComplete: allOutputsComplete,
      strongDurableComplete: allOutputsComplete && allOutputsStrong,
      issues: outputIssues,
      warnings: outputWarnings,
      outputs,
    };
  }

  const nonPassHasDurableHistory = result === "CONDITIONAL"
    ? ((history.blocks as string[]).length > 0 || Object.keys(history.summary as Record<string, unknown>).length > 0 || outputPaths.length > 0)
    : (history.blocks as string[]).length > 0;
  const outputComplete = outputIssues.length === 0;
  return {
    historyRelativePath: input.historyRelativePath,
    historyContentDigest: contentDigest,
    runId: history.runId as string,
    requestId: history.requestId as string,
    intentId: history.intentId as string,
    taskId: history.taskId as string,
    taskType: history.taskType as string,
    result,
    executed: true,
    startedAt: history.startedAt as string,
    completedAt: history.completedAt as string,
    outputDigest,
    outputCount: outputPaths.length,
    verifiedOutputCount,
    mutableSupersededReferenceCount: superseded,
    registryOutputCount,
    explicitNoChange: noChange,
    classification: nonPassHasDurableHistory && outputComplete
      ? "NON_PASS_DURABLE_HISTORY"
      : "INCOMPLETE_OUTPUT_REFERENCE",
    durableComplete: nonPassHasDurableHistory && outputComplete,
    strongDurableComplete: nonPassHasDurableHistory && outputComplete && superseded === 0,
    issues: [
      ...(!nonPassHasDurableHistory ? ["NONPASS_DURABLE_EVIDENCE_EMPTY"] : []),
      ...outputIssues,
    ],
    warnings: outputWarnings,
    outputs,
  };
}

function emptyClassificationCounts(): Record<ResearchDurableRunClassification, number> {
  return {
    PASS_DURABLE_OUTPUTS: 0,
    PASS_NO_CHANGE_HISTORY: 0,
    NON_PASS_DURABLE_HISTORY: 0,
    INCOMPLETE_PASS_NO_OUTPUT: 0,
    INVALID_PERSISTED_DRY_RUN: 0,
    INVALID_HISTORY: 0,
    INCOMPLETE_OUTPUT_REFERENCE: 0,
  };
}

export function buildResearchDurableKnowledgeCompletenessReport(input: {
  repoRoot: string;
  generatedAt?: string;
}): ResearchDurableKnowledgeCompletenessReport {
  const generatedAtMs = parseInstant(input.generatedAt ?? new Date().toISOString());
  if (generatedAtMs == null) throw new Error("DURABLE_KNOWLEDGE_GENERATED_AT_INVALID");
  const generatedAt = new Date(generatedAtMs).toISOString();
  const historyDir = resolveInside(input.repoRoot, HISTORY_RELATIVE_DIR);
  if (!existsSync(historyDir)) {
    const core = {
      reportVersion: RESEARCH_DURABLE_KNOWLEDGE_COMPLETENESS_VERSION,
      evidenceRole: "RESEARCH_KNOWLEDGE_RETENTION_AUDIT_ONLY" as const,
      generatedAt,
      historyRelativeDir: HISTORY_RELATIVE_DIR as typeof HISTORY_RELATIVE_DIR,
      status: "NO_HISTORY" as const,
      historyFileCount: 0,
      assessedRunCount: 0,
      passCount: 0,
      conditionalCount: 0,
      blockedCount: 0,
      failedCount: 0,
      persistedDryRunCount: 0,
      durableCompleteCount: 0,
      strongDurableCompleteCount: 0,
      incompleteCount: 0,
      invalidHistoryCount: 0,
      passWithDurableOutputsCount: 0,
      passNoChangeHistoryCount: 0,
      nonPassDurableHistoryCount: 0,
      missingOutputReferenceCount: 0,
      invalidOutputReferenceCount: 0,
      mutableSupersededReferenceCount: 0,
      registryOutputCount: 0,
      currentOutputDigestMatchCount: 0,
      earliestCompletedAt: null,
      latestCompletedAt: null,
      taskTypeCounts: {} as Record<string, number>,
      classificationCounts: emptyClassificationCounts(),
      runs: [] as ResearchDurableRunAssessment[],
      automaticPromotionAuthorized: false as const,
      currentBuyConnectionAuthorized: false as const,
      lineConnectionAuthorized: false as const,
      publicPublishAuthorized: false as const,
      databaseWriteAuthorized: false as const,
      automatedBettingAuthorized: false as const,
      productionApplyAuthorized: false as const,
    };
    return { ...core, outputDigest: sha256Text(JSON.stringify(core)) };
  }
  const dirStat = lstatSync(historyDir);
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
    throw new Error("DURABLE_KNOWLEDGE_HISTORY_DIR_INVALID");
  }
  const files = readdirSync(historyDir).sort();
  const unexpected = files.filter((file) => !/^\d+-TASK-[0-9A-Za-z._-]+\.json$/u.test(file));
  if (unexpected.length > 0) {
    throw new Error(`DURABLE_KNOWLEDGE_HISTORY_FILENAME_INVALID:${unexpected.join(",")}`);
  }
  const runs = files.map((file) => assessHistoryFile({
    repoRoot: input.repoRoot,
    historyRelativePath: `${HISTORY_RELATIVE_DIR}/${file}`,
  }));
  runs.sort((left, right) => {
    const leftTime = left.completedAt == null ? 0 : Date.parse(left.completedAt);
    const rightTime = right.completedAt == null ? 0 : Date.parse(right.completedAt);
    return leftTime - rightTime || left.historyRelativePath.localeCompare(right.historyRelativePath);
  });

  const classifications = emptyClassificationCounts();
  const taskTypeCounts: Record<string, number> = {};
  for (const run of runs) {
    classifications[run.classification] += 1;
    if (run.taskType) taskTypeCounts[run.taskType] = (taskTypeCounts[run.taskType] ?? 0) + 1;
  }
  const validTimes = runs.map((run) => run.completedAt).filter((value): value is string => value != null)
    .map((value) => new Date(Date.parse(value)).toISOString()).sort();
  const invalidHistoryCount = classifications.INVALID_HISTORY;
  const persistedDryRunCount = classifications.INVALID_PERSISTED_DRY_RUN;
  const incompleteCount = runs.filter((run) => !run.durableComplete).length;
  const missingOutputReferenceCount = runs.flatMap((run) => run.outputs).filter((output) => !output.exists).length;
  const invalidOutputReferenceCount = runs.flatMap((run) => run.outputs)
    .filter((output) => output.exists && !output.complete).length;
  const mutableSupersededReferenceCount = runs.reduce((sum, run) => sum + run.mutableSupersededReferenceCount, 0);
  const blockedStructural = invalidHistoryCount > 0 || persistedDryRunCount > 0 || invalidOutputReferenceCount > 0;
  const degraded = incompleteCount > 0 || missingOutputReferenceCount > 0 || mutableSupersededReferenceCount > 0;
  const status = runs.length === 0
    ? "NO_HISTORY" as const
    : blockedStructural
      ? "BLOCKED" as const
      : degraded
        ? "DEGRADED" as const
        : "PASS" as const;
  const core = {
    reportVersion: RESEARCH_DURABLE_KNOWLEDGE_COMPLETENESS_VERSION,
    evidenceRole: "RESEARCH_KNOWLEDGE_RETENTION_AUDIT_ONLY" as const,
    generatedAt,
    historyRelativeDir: HISTORY_RELATIVE_DIR as typeof HISTORY_RELATIVE_DIR,
    status,
    historyFileCount: files.length,
    assessedRunCount: runs.length,
    passCount: runs.filter((run) => run.result === "PASS").length,
    conditionalCount: runs.filter((run) => run.result === "CONDITIONAL").length,
    blockedCount: runs.filter((run) => run.result === "BLOCKED").length,
    failedCount: runs.filter((run) => run.result === "FAILED").length,
    persistedDryRunCount,
    durableCompleteCount: runs.filter((run) => run.durableComplete).length,
    strongDurableCompleteCount: runs.filter((run) => run.strongDurableComplete).length,
    incompleteCount,
    invalidHistoryCount,
    passWithDurableOutputsCount: classifications.PASS_DURABLE_OUTPUTS,
    passNoChangeHistoryCount: classifications.PASS_NO_CHANGE_HISTORY,
    nonPassDurableHistoryCount: classifications.NON_PASS_DURABLE_HISTORY,
    missingOutputReferenceCount,
    invalidOutputReferenceCount,
    mutableSupersededReferenceCount,
    registryOutputCount: runs.reduce((sum, run) => sum + run.registryOutputCount, 0),
    currentOutputDigestMatchCount: runs.flatMap((run) => run.outputs)
      .filter((output) => output.integrity === "CURRENT_OUTPUT_DIGEST_MATCH").length,
    earliestCompletedAt: validTimes.at(0) ?? null,
    latestCompletedAt: validTimes.at(-1) ?? null,
    taskTypeCounts: Object.fromEntries(Object.entries(taskTypeCounts).sort(([a], [b]) => a.localeCompare(b))),
    classificationCounts: classifications,
    runs,
    automaticPromotionAuthorized: false as const,
    currentBuyConnectionAuthorized: false as const,
    lineConnectionAuthorized: false as const,
    publicPublishAuthorized: false as const,
    databaseWriteAuthorized: false as const,
    automatedBettingAuthorized: false as const,
    productionApplyAuthorized: false as const,
  };
  return { ...core, outputDigest: sha256Text(JSON.stringify(core)) };
}
