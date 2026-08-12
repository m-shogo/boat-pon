import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { resolve, sep } from "node:path";

import { readGovernanceFileUtf8Bounded } from "../research/governance/safeFs";
import {
  buildResearchDurableKnowledgeCompletenessReport,
  type ResearchDurableKnowledgeCompletenessReport,
  type ResearchDurableOutputAssessment,
  type ResearchDurableRunAssessment,
  type ResearchDurableRunClassification,
} from "./researchDurableKnowledgeCompleteness";

const LEGACY_V0_HISTORY_PATH = "reports/automation/history/30878594429-TASK-N2-003.json";
const LEGACY_V0_OUTPUT_PATH = "reports/n2/n2-win-refund-omission-audit.json";
const LEGACY_V0_WARNING = "LEGACY_HISTORY_V0_ATTESTED_NO_INTENT_IDEMPOTENCY_FULL_SHA";
const MAX_LEGACY_HISTORY_BYTES = 8_000_000;
const MAX_LEGACY_OUTPUT_BYTES = 32_000_000;
const SHA256_RE = /^[0-9a-f]{64}$/u;

const LEGACY_V0 = {
  runId: "30878594429",
  requestId: "REQ-20260804-46393c12ed",
  taskId: "TASK-N2-003",
  taskType: "readonly-audit",
  safetyLevel: "L0",
  executorVersion: "n2-task-executor-registry-v1",
  authoritySha: "3d2d31d",
  startedAt: "2026-08-04T04:45:32.951Z",
  completedAt: "2026-08-04T04:46:44.605Z",
  elapsedMs: 71654,
  outputDigest: "bd4bed76312255dd5434dc9668346ecb139934b05df2c48d86e8bece781987aa",
} as const;

const LEGACY_V0_TOP_LEVEL_KEYS = [
  "authoritySha",
  "blocks",
  "completedAt",
  "elapsedMs",
  "executed",
  "executorVersion",
  "outputDigest",
  "outputs",
  "requestId",
  "result",
  "runId",
  "safetyLevel",
  "startedAt",
  "summary",
  "taskId",
  "taskType",
] as const;

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  const object = objectValue(value);
  if (!object) return value;
  return Object.fromEntries(
    Object.entries(object)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]),
  );
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function resolveInside(repoRoot: string, relativePath: string): string | null {
  const root = resolve(repoRoot);
  const target = resolve(root, relativePath);
  if (target === root || target.startsWith(`${root}${sep}`)) return target;
  return null;
}

function readRegularText(repoRoot: string, relativePath: string, maxBytes: number): string | null {
  const path = resolveInside(repoRoot, relativePath);
  if (!path) return null;
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maxBytes) return null;
    return readGovernanceFileUtf8Bounded(path, maxBytes, repoRoot).text;
  } catch {
    return null;
  }
}

function legacyHistoryMatches(history: Record<string, unknown>): boolean {
  if (!canonicalEqual(Object.keys(history).sort(), [...LEGACY_V0_TOP_LEVEL_KEYS].sort())) return false;
  if ("intentId" in history || "idempotencyKey" in history) return false;
  if (history.runId !== LEGACY_V0.runId) return false;
  if (history.requestId !== LEGACY_V0.requestId) return false;
  if (history.taskId !== LEGACY_V0.taskId) return false;
  if (history.taskType !== LEGACY_V0.taskType) return false;
  if (history.safetyLevel !== LEGACY_V0.safetyLevel) return false;
  if (history.executorVersion !== LEGACY_V0.executorVersion) return false;
  if (history.authoritySha !== LEGACY_V0.authoritySha) return false;
  if (history.startedAt !== LEGACY_V0.startedAt || history.completedAt !== LEGACY_V0.completedAt) return false;
  if (history.elapsedMs !== LEGACY_V0.elapsedMs) return false;
  if (history.executed !== true || history.result !== "PASS") return false;
  if (!Array.isArray(history.blocks) || history.blocks.length !== 0) return false;
  if (!Array.isArray(history.outputs) || history.outputs.length !== 1 || history.outputs[0] !== LEGACY_V0_OUTPUT_PATH) return false;
  if (history.outputDigest !== LEGACY_V0.outputDigest || !SHA256_RE.test(String(history.outputDigest))) return false;
  return objectValue(history.summary) != null;
}

function legacyOutputAssessment(repoRoot: string, history: Record<string, unknown>): ResearchDurableOutputAssessment | null {
  const text = readRegularText(repoRoot, LEGACY_V0_OUTPUT_PATH, MAX_LEGACY_OUTPUT_BYTES);
  if (text == null) return null;
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = objectValue(JSON.parse(text));
  } catch {
    return null;
  }
  if (!parsed) return null;
  if (parsed.outputDigest !== LEGACY_V0.outputDigest) return null;
  if (parsed.runId !== LEGACY_V0.runId || parsed.requestId !== LEGACY_V0.requestId || parsed.taskId !== LEGACY_V0.taskId) return null;
  if (parsed.executorVersion !== LEGACY_V0.executorVersion) return null;
  const summary = objectValue(history.summary);
  if (!summary) return null;
  const reportPayload = { ...parsed };
  delete reportPayload.runId;
  delete reportPayload.requestId;
  delete reportPayload.taskId;
  delete reportPayload.executorVersion;
  delete reportPayload.generatedAt;
  delete reportPayload.outputDigest;
  if (!canonicalEqual(summary, reportPayload)) return null;
  return {
    relativePath: LEGACY_V0_OUTPUT_PATH,
    rootClass: "REPORT",
    integrity: "CURRENT_OUTPUT_DIGEST_MATCH",
    exists: true,
    regularFile: true,
    bytes: Buffer.byteLength(text, "utf8"),
    contentDigest: sha256Text(text),
    embeddedDigest: LEGACY_V0.outputDigest,
    historyDigestMatchesEmbedded: true,
    complete: true,
    issues: [],
    warnings: [LEGACY_V0_WARNING],
  };
}

function attestKnownLegacyV0(
  repoRoot: string,
  strictRun: ResearchDurableRunAssessment,
): ResearchDurableRunAssessment | null {
  if (strictRun.historyRelativePath !== LEGACY_V0_HISTORY_PATH) return null;
  if (strictRun.classification !== "INVALID_HISTORY") return null;
  const expectedIssues = [
    "HISTORY_AUTHORITY_SHA_INVALID",
    "HISTORY_IDEMPOTENCY_KEY_INVALID",
    "HISTORY_INTENT_ID_INVALID",
  ].sort();
  if (!canonicalEqual([...strictRun.issues].sort(), expectedIssues)) return null;
  const text = readRegularText(repoRoot, LEGACY_V0_HISTORY_PATH, MAX_LEGACY_HISTORY_BYTES);
  if (text == null) return null;
  let history: Record<string, unknown> | null = null;
  try {
    history = objectValue(JSON.parse(text));
  } catch {
    return null;
  }
  if (!history || !legacyHistoryMatches(history)) return null;
  const output = legacyOutputAssessment(repoRoot, history);
  if (!output) return null;
  return {
    historyRelativePath: strictRun.historyRelativePath,
    historyContentDigest: strictRun.historyContentDigest,
    runId: LEGACY_V0.runId,
    requestId: LEGACY_V0.requestId,
    intentId: null,
    taskId: LEGACY_V0.taskId,
    taskType: LEGACY_V0.taskType,
    result: "PASS",
    executed: true,
    startedAt: LEGACY_V0.startedAt,
    completedAt: LEGACY_V0.completedAt,
    outputDigest: LEGACY_V0.outputDigest,
    outputCount: 1,
    verifiedOutputCount: 1,
    mutableSupersededReferenceCount: 0,
    registryOutputCount: 0,
    explicitNoChange: false,
    classification: "PASS_DURABLE_OUTPUTS",
    durableComplete: true,
    strongDurableComplete: false,
    issues: [],
    warnings: [LEGACY_V0_WARNING],
    outputs: [output],
  };
}

function classificationCounts(runs: ResearchDurableRunAssessment[]): Record<ResearchDurableRunClassification, number> {
  const counts: Record<ResearchDurableRunClassification, number> = {
    PASS_DURABLE_OUTPUTS: 0,
    PASS_NO_CHANGE_HISTORY: 0,
    NON_PASS_DURABLE_HISTORY: 0,
    INCOMPLETE_PASS_NO_OUTPUT: 0,
    INVALID_PERSISTED_DRY_RUN: 0,
    INVALID_HISTORY: 0,
    INCOMPLETE_OUTPUT_REFERENCE: 0,
  };
  for (const run of runs) counts[run.classification] += 1;
  return counts;
}

function rebuildReport(
  strict: ResearchDurableKnowledgeCompletenessReport,
  runs: ResearchDurableRunAssessment[],
  legacyCompatibilityCount: number,
): ResearchDurableKnowledgeCompletenessReport {
  const classifications = classificationCounts(runs);
  const taskTypeCounts: Record<string, number> = {};
  for (const run of runs) {
    if (run.taskType) taskTypeCounts[run.taskType] = (taskTypeCounts[run.taskType] ?? 0) + 1;
  }
  const validTimes = runs
    .map((run) => run.completedAt)
    .filter((value): value is string => value != null && Number.isFinite(Date.parse(value)))
    .map((value) => new Date(Date.parse(value)).toISOString())
    .sort();
  const invalidHistoryCount = classifications.INVALID_HISTORY;
  const persistedDryRunCount = classifications.INVALID_PERSISTED_DRY_RUN;
  const incompleteCount = runs.filter((run) => !run.durableComplete).length;
  const outputs = runs.flatMap((run) => run.outputs);
  const missingOutputReferenceCount = outputs.filter((output) => !output.exists).length;
  const invalidOutputReferenceCount = outputs.filter((output) => output.exists && !output.complete).length;
  const mutableSupersededReferenceCount = runs.reduce((sum, run) => sum + run.mutableSupersededReferenceCount, 0);
  const blockedStructural = invalidHistoryCount > 0 || persistedDryRunCount > 0 || invalidOutputReferenceCount > 0;
  const degraded = incompleteCount > 0 || missingOutputReferenceCount > 0 || mutableSupersededReferenceCount > 0 || legacyCompatibilityCount > 0;
  const status = runs.length === 0
    ? "NO_HISTORY" as const
    : blockedStructural
      ? "BLOCKED" as const
      : degraded
        ? "DEGRADED" as const
        : "PASS" as const;
  const { outputDigest: _oldDigest, ...strictWithoutDigest } = strict;
  const core = {
    ...strictWithoutDigest,
    status,
    historyFileCount: runs.length,
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
    currentOutputDigestMatchCount: outputs.filter((output) => output.integrity === "CURRENT_OUTPUT_DIGEST_MATCH").length,
    earliestCompletedAt: validTimes.at(0) ?? null,
    latestCompletedAt: validTimes.at(-1) ?? null,
    taskTypeCounts: Object.fromEntries(Object.entries(taskTypeCounts).sort(([a], [b]) => a.localeCompare(b))),
    classificationCounts: classifications,
    runs,
  };
  return { ...core, outputDigest: sha256Text(JSON.stringify(core)) };
}

export function buildResearchDurableKnowledgeCompletenessReportWithLegacyCompatibility(input: {
  repoRoot: string;
  generatedAt?: string;
}): ResearchDurableKnowledgeCompletenessReport {
  const strict = buildResearchDurableKnowledgeCompletenessReport(input);
  let legacyCompatibilityCount = 0;
  const runs = strict.runs.map((run) => {
    const attested = attestKnownLegacyV0(input.repoRoot, run);
    if (!attested) return run;
    legacyCompatibilityCount += 1;
    return attested;
  });
  return legacyCompatibilityCount === 0
    ? strict
    : rebuildReport(strict, runs, legacyCompatibilityCount);
}

export function countAttestedLegacyDurableRuns(report: ResearchDurableKnowledgeCompletenessReport): number {
  return report.runs.filter((run) => run.warnings.includes(LEGACY_V0_WARNING)).length;
}
