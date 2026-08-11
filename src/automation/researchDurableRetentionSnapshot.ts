import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

import type {
  ResearchDurableKnowledgeCompletenessReport,
  ResearchDurableRunAssessment,
} from "./researchDurableKnowledgeCompleteness";
import { countAttestedLegacyDurableRuns } from "./researchDurableKnowledgeLegacyCompatibility";

export const RESEARCH_DURABLE_RETENTION_SNAPSHOT_VERSION =
  "research-durable-retention-snapshot-v1" as const;
export const RESEARCH_DURABLE_RETENTION_POLICY_VERSION =
  "research-durable-retention-policy-v1" as const;

const RETENTION_RELATIVE_DIR = "reports/automation/retention/durable-knowledge";
const SHA256_RE = /^[0-9a-f]{64}$/u;
const GIT_SHA_RE = /^[0-9a-f]{40}$/u;
const MAX_EXISTING_SNAPSHOT_BYTES = 2_000_000;

export type ResearchDurableRetentionNonStrongRun = {
  runId: string | null;
  taskId: string | null;
  taskType: string | null;
  result: string | null;
  classification: string;
  durableComplete: boolean;
  strongDurableComplete: false;
  warnings: string[];
};

export type ResearchDurableRetentionSnapshot = {
  snapshotVersion: typeof RESEARCH_DURABLE_RETENTION_SNAPSHOT_VERSION;
  retentionPolicyVersion: typeof RESEARCH_DURABLE_RETENTION_POLICY_VERSION;
  evidenceRole: "RESEARCH_KNOWLEDGE_RETENTION_SNAPSHOT_ONLY";
  effectiveDateJst: string;
  firstObservedAt: string;
  sourceStateShaAtFirstObservation: string;
  mainAuthorityShaAtFirstObservation: string;
  auditReportVersion: ResearchDurableKnowledgeCompletenessReport["reportVersion"];
  auditStatus: ResearchDurableKnowledgeCompletenessReport["status"];
  evidenceDigest: string;
  historyFileCount: number;
  assessedRunCount: number;
  durableCompleteCount: number;
  strongDurableCompleteCount: number;
  incompleteCount: number;
  invalidHistoryCount: number;
  missingOutputReferenceCount: number;
  invalidOutputReferenceCount: number;
  mutableSupersededReferenceCount: number;
  legacyCompatibilityCount: number;
  classificationCounts: ResearchDurableKnowledgeCompletenessReport["classificationCounts"];
  nonStrongRuns: ResearchDurableRetentionNonStrongRun[];
  automaticPromotionAuthorized: false;
  currentBuyConnectionAuthorized: false;
  lineConnectionAuthorized: false;
  publicPublishAuthorized: false;
  databaseWriteAuthorized: false;
  automatedBettingAuthorized: false;
  productionApplyAuthorized: false;
  snapshotDigest: string;
};

export type ResearchDurableRetentionPersistResult = {
  changed: boolean;
  relativePath: string;
  snapshot: ResearchDurableRetentionSnapshot;
};

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

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function parseInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("DURABLE_RETENTION_FIRST_OBSERVED_AT_INVALID");
  return parsed;
}

function jstDate(iso: string): string {
  const parsed = parseInstant(iso);
  return new Date(parsed + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function resolveInside(rootDir: string, relativePath: string): string {
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error("DURABLE_RETENTION_PATH_UNSAFE");
  }
  const root = resolve(rootDir);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("DURABLE_RETENTION_PATH_ESCAPES_ROOT");
  }
  return target;
}

function lstatIfPresent(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function assertSafeParentPath(rootDir: string, absolutePath: string): void {
  const root = resolve(rootDir);
  const parents: string[] = [];
  let current = dirname(absolutePath);
  while (current !== root) {
    if (!current.startsWith(`${root}${sep}`)) {
      throw new Error("DURABLE_RETENTION_PATH_ESCAPES_ROOT");
    }
    parents.push(current);
    const next = dirname(current);
    if (next === current) throw new Error("DURABLE_RETENTION_PATH_ESCAPES_ROOT");
    current = next;
  }
  for (const parent of parents.reverse()) {
    const stat = lstatIfPresent(parent);
    if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("DURABLE_RETENTION_PARENT_PATH_INVALID");
    }
  }
}

function readExistingSnapshotText(absolutePath: string): string | null {
  let fd: number;
  try {
    fd = openSync(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    if (error instanceof Error && "code" in error && error.code === "ELOOP") {
      throw new Error("DURABLE_RETENTION_EXISTING_SNAPSHOT_INVALID");
    }
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_EXISTING_SNAPSHOT_BYTES) {
      throw new Error("DURABLE_RETENTION_EXISTING_SNAPSHOT_INVALID");
    }
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

function semanticRun(run: ResearchDurableRunAssessment): Record<string, unknown> {
  return {
    historyRelativePath: run.historyRelativePath,
    historyContentDigest: run.historyContentDigest,
    runId: run.runId,
    requestId: run.requestId,
    intentId: run.intentId,
    taskId: run.taskId,
    taskType: run.taskType,
    result: run.result,
    completedAt: run.completedAt,
    outputDigest: run.outputDigest,
    outputCount: run.outputCount,
    verifiedOutputCount: run.verifiedOutputCount,
    mutableSupersededReferenceCount: run.mutableSupersededReferenceCount,
    registryOutputCount: run.registryOutputCount,
    explicitNoChange: run.explicitNoChange,
    classification: run.classification,
    durableComplete: run.durableComplete,
    strongDurableComplete: run.strongDurableComplete,
    issues: [...run.issues],
    warnings: [...run.warnings],
    outputs: run.outputs.map((output) => ({
      relativePath: output.relativePath,
      rootClass: output.rootClass,
      integrity: output.integrity,
      exists: output.exists,
      regularFile: output.regularFile,
      contentDigest: output.contentDigest,
      embeddedDigest: output.embeddedDigest,
      historyDigestMatchesEmbedded: output.historyDigestMatchesEmbedded,
      complete: output.complete,
      issues: [...output.issues],
      warnings: [...output.warnings],
    })),
  };
}

export function computeResearchDurableRetentionEvidenceDigest(
  report: ResearchDurableKnowledgeCompletenessReport,
): string {
  const semantic = {
    retentionPolicyVersion: RESEARCH_DURABLE_RETENTION_POLICY_VERSION,
    auditReportVersion: report.reportVersion,
    auditStatus: report.status,
    historyFileCount: report.historyFileCount,
    assessedRunCount: report.assessedRunCount,
    passCount: report.passCount,
    conditionalCount: report.conditionalCount,
    blockedCount: report.blockedCount,
    failedCount: report.failedCount,
    persistedDryRunCount: report.persistedDryRunCount,
    durableCompleteCount: report.durableCompleteCount,
    strongDurableCompleteCount: report.strongDurableCompleteCount,
    incompleteCount: report.incompleteCount,
    invalidHistoryCount: report.invalidHistoryCount,
    passWithDurableOutputsCount: report.passWithDurableOutputsCount,
    passNoChangeHistoryCount: report.passNoChangeHistoryCount,
    nonPassDurableHistoryCount: report.nonPassDurableHistoryCount,
    missingOutputReferenceCount: report.missingOutputReferenceCount,
    invalidOutputReferenceCount: report.invalidOutputReferenceCount,
    mutableSupersededReferenceCount: report.mutableSupersededReferenceCount,
    registryOutputCount: report.registryOutputCount,
    currentOutputDigestMatchCount: report.currentOutputDigestMatchCount,
    classificationCounts: report.classificationCounts,
    runs: report.runs.map(semanticRun),
    protectedAuthority: {
      automaticPromotionAuthorized: report.automaticPromotionAuthorized,
      currentBuyConnectionAuthorized: report.currentBuyConnectionAuthorized,
      lineConnectionAuthorized: report.lineConnectionAuthorized,
      publicPublishAuthorized: report.publicPublishAuthorized,
      databaseWriteAuthorized: report.databaseWriteAuthorized,
      automatedBettingAuthorized: report.automatedBettingAuthorized,
      productionApplyAuthorized: report.productionApplyAuthorized,
    },
  };
  return sha256Text(canonicalJson(semantic));
}

function assertProtectedAuthority(report: ResearchDurableKnowledgeCompletenessReport): void {
  if (
    report.automaticPromotionAuthorized !== false
    || report.currentBuyConnectionAuthorized !== false
    || report.lineConnectionAuthorized !== false
    || report.publicPublishAuthorized !== false
    || report.databaseWriteAuthorized !== false
    || report.automatedBettingAuthorized !== false
    || report.productionApplyAuthorized !== false
  ) {
    throw new Error("DURABLE_RETENTION_PROTECTED_AUTHORITY_NOT_FALSE");
  }
}

function nonStrongRun(run: ResearchDurableRunAssessment): ResearchDurableRetentionNonStrongRun {
  return {
    runId: run.runId,
    taskId: run.taskId,
    taskType: run.taskType,
    result: run.result,
    classification: run.classification,
    durableComplete: run.durableComplete,
    strongDurableComplete: false,
    warnings: [...run.warnings],
  };
}

export function buildResearchDurableRetentionSnapshot(input: {
  report: ResearchDurableKnowledgeCompletenessReport;
  sourceStateSha: string;
  mainAuthoritySha: string;
  firstObservedAt: string;
}): ResearchDurableRetentionSnapshot {
  if (!GIT_SHA_RE.test(input.sourceStateSha)) throw new Error("DURABLE_RETENTION_SOURCE_STATE_SHA_INVALID");
  if (!GIT_SHA_RE.test(input.mainAuthoritySha)) throw new Error("DURABLE_RETENTION_MAIN_AUTHORITY_SHA_INVALID");
  const firstObservedAtMs = parseInstant(input.firstObservedAt);
  const firstObservedAt = new Date(firstObservedAtMs).toISOString();
  assertProtectedAuthority(input.report);
  const evidenceDigest = computeResearchDurableRetentionEvidenceDigest(input.report);
  const core = {
    snapshotVersion: RESEARCH_DURABLE_RETENTION_SNAPSHOT_VERSION,
    retentionPolicyVersion: RESEARCH_DURABLE_RETENTION_POLICY_VERSION,
    evidenceRole: "RESEARCH_KNOWLEDGE_RETENTION_SNAPSHOT_ONLY" as const,
    effectiveDateJst: jstDate(firstObservedAt),
    firstObservedAt,
    sourceStateShaAtFirstObservation: input.sourceStateSha,
    mainAuthorityShaAtFirstObservation: input.mainAuthoritySha,
    auditReportVersion: input.report.reportVersion,
    auditStatus: input.report.status,
    evidenceDigest,
    historyFileCount: input.report.historyFileCount,
    assessedRunCount: input.report.assessedRunCount,
    durableCompleteCount: input.report.durableCompleteCount,
    strongDurableCompleteCount: input.report.strongDurableCompleteCount,
    incompleteCount: input.report.incompleteCount,
    invalidHistoryCount: input.report.invalidHistoryCount,
    missingOutputReferenceCount: input.report.missingOutputReferenceCount,
    invalidOutputReferenceCount: input.report.invalidOutputReferenceCount,
    mutableSupersededReferenceCount: input.report.mutableSupersededReferenceCount,
    legacyCompatibilityCount: countAttestedLegacyDurableRuns(input.report),
    classificationCounts: input.report.classificationCounts,
    nonStrongRuns: input.report.runs
      .filter((run) => !run.strongDurableComplete)
      .map(nonStrongRun),
    automaticPromotionAuthorized: false as const,
    currentBuyConnectionAuthorized: false as const,
    lineConnectionAuthorized: false as const,
    publicPublishAuthorized: false as const,
    databaseWriteAuthorized: false as const,
    automatedBettingAuthorized: false as const,
    productionApplyAuthorized: false as const,
  };
  return { ...core, snapshotDigest: sha256Text(canonicalJson(core)) };
}

export function durableRetentionSnapshotRelativePath(snapshot: ResearchDurableRetentionSnapshot): string {
  return `${RETENTION_RELATIVE_DIR}/${snapshot.effectiveDateJst}/${snapshot.evidenceDigest}.json`;
}

export function validateResearchDurableRetentionSnapshot(value: unknown): ResearchDurableRetentionSnapshot {
  const object = objectValue(value);
  if (!object) throw new Error("DURABLE_RETENTION_SNAPSHOT_INVALID");
  if (object.snapshotVersion !== RESEARCH_DURABLE_RETENTION_SNAPSHOT_VERSION) throw new Error("DURABLE_RETENTION_SNAPSHOT_VERSION_INVALID");
  if (object.retentionPolicyVersion !== RESEARCH_DURABLE_RETENTION_POLICY_VERSION) throw new Error("DURABLE_RETENTION_POLICY_VERSION_INVALID");
  if (object.evidenceRole !== "RESEARCH_KNOWLEDGE_RETENTION_SNAPSHOT_ONLY") throw new Error("DURABLE_RETENTION_EVIDENCE_ROLE_INVALID");
  if (typeof object.effectiveDateJst !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(object.effectiveDateJst)) throw new Error("DURABLE_RETENTION_DATE_INVALID");
  if (typeof object.firstObservedAt !== "string") throw new Error("DURABLE_RETENTION_FIRST_OBSERVED_AT_INVALID");
  parseInstant(object.firstObservedAt);
  if (jstDate(object.firstObservedAt) !== object.effectiveDateJst) throw new Error("DURABLE_RETENTION_DATE_MISMATCH");
  if (typeof object.sourceStateShaAtFirstObservation !== "string" || !GIT_SHA_RE.test(object.sourceStateShaAtFirstObservation)) throw new Error("DURABLE_RETENTION_SOURCE_STATE_SHA_INVALID");
  if (typeof object.mainAuthorityShaAtFirstObservation !== "string" || !GIT_SHA_RE.test(object.mainAuthorityShaAtFirstObservation)) throw new Error("DURABLE_RETENTION_MAIN_AUTHORITY_SHA_INVALID");
  if (typeof object.evidenceDigest !== "string" || !SHA256_RE.test(object.evidenceDigest)) throw new Error("DURABLE_RETENTION_EVIDENCE_DIGEST_INVALID");
  if (typeof object.snapshotDigest !== "string" || !SHA256_RE.test(object.snapshotDigest)) throw new Error("DURABLE_RETENTION_SNAPSHOT_DIGEST_INVALID");
  const { snapshotDigest, ...core } = object;
  if (sha256Text(canonicalJson(core)) !== snapshotDigest) throw new Error("DURABLE_RETENTION_SNAPSHOT_SELF_DIGEST_INVALID");
  for (const flag of [
    "automaticPromotionAuthorized",
    "currentBuyConnectionAuthorized",
    "lineConnectionAuthorized",
    "publicPublishAuthorized",
    "databaseWriteAuthorized",
    "automatedBettingAuthorized",
    "productionApplyAuthorized",
  ]) {
    if (object[flag] !== false) throw new Error(`DURABLE_RETENTION_PROTECTED_FLAG_INVALID:${flag}`);
  }
  if (!Array.isArray(object.nonStrongRuns)) throw new Error("DURABLE_RETENTION_NON_STRONG_RUNS_INVALID");
  return object as ResearchDurableRetentionSnapshot;
}

export function persistResearchDurableRetentionSnapshot(input: {
  repoRoot: string;
  snapshot: ResearchDurableRetentionSnapshot;
}): ResearchDurableRetentionPersistResult {
  const relativePath = durableRetentionSnapshotRelativePath(input.snapshot);
  const absolutePath = resolveInside(input.repoRoot, relativePath);
  assertSafeParentPath(input.repoRoot, absolutePath);
  const existingText = readExistingSnapshotText(absolutePath);
  if (existingText !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existingText);
    } catch {
      throw new Error("DURABLE_RETENTION_EXISTING_SNAPSHOT_JSON_INVALID");
    }
    const existing = validateResearchDurableRetentionSnapshot(parsed);
    if (durableRetentionSnapshotRelativePath(existing) !== relativePath) {
      throw new Error("DURABLE_RETENTION_EXISTING_SNAPSHOT_PATH_MISMATCH");
    }
    if (existing.evidenceDigest !== input.snapshot.evidenceDigest) {
      throw new Error("DURABLE_RETENTION_EXISTING_EVIDENCE_DIGEST_MISMATCH");
    }
    return { changed: false, relativePath, snapshot: existing };
  }
  mkdirSync(dirname(absolutePath), { recursive: true });
  const tmpPath = `${absolutePath}.${randomUUID()}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(input.snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
  chmodSync(tmpPath, 0o644);
  try {
    linkSync(tmpPath, absolutePath);
  } catch (error) {
    unlinkSync(tmpPath);
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return persistResearchDurableRetentionSnapshot(input);
    }
    throw error;
  }
  unlinkSync(tmpPath);
  return { changed: true, relativePath, snapshot: input.snapshot };
}
