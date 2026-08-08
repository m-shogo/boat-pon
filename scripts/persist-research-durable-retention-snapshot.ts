import { resolve } from "node:path";

import {
  buildResearchDurableKnowledgeCompletenessReportWithLegacyCompatibilityAndRetainedInventory,
} from "../src/automation/researchDurableKnowledgeRetainedInventory";
import {
  buildResearchDurableRetentionSnapshotWithRetainedInventory,
  persistResearchDurableRetentionSnapshotWithRetainedInventory,
} from "../src/automation/researchDurableRetentionSnapshotRetainedInventory";

function argument(name: string): string | null {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function required(name: string): string {
  const value = argument(name);
  if (!value) throw new Error(`DURABLE_RETENTION_ARGUMENT_REQUIRED:${name}`);
  return value;
}

const repoRoot = resolve(argument("repo-root") ?? process.cwd());
const sourceStateSha = required("source-state-sha");
const mainAuthoritySha = required("main-authority-sha");
const observedAtArg = argument("observed-at");
const observedAt = observedAtArg == null ? new Date().toISOString() : new Date(observedAtArg).toISOString();

const report = buildResearchDurableKnowledgeCompletenessReportWithLegacyCompatibilityAndRetainedInventory({
  repoRoot,
  generatedAt: observedAt,
});
const snapshot = buildResearchDurableRetentionSnapshotWithRetainedInventory({
  report,
  sourceStateSha,
  mainAuthoritySha,
  firstObservedAt: observedAt,
});
const persisted = persistResearchDurableRetentionSnapshotWithRetainedInventory({ repoRoot, snapshot });

console.log(JSON.stringify({
  summaryVersion: "research-durable-retention-persist-summary-v1",
  changed: persisted.changed,
  relativePath: persisted.relativePath,
  snapshotVersion: persisted.snapshot.snapshotVersion,
  retentionPolicyVersion: persisted.snapshot.retentionPolicyVersion,
  effectiveDateJst: persisted.snapshot.effectiveDateJst,
  auditStatus: persisted.snapshot.auditStatus,
  evidenceDigest: persisted.snapshot.evidenceDigest,
  snapshotDigest: persisted.snapshot.snapshotDigest,
  historyFileCount: persisted.snapshot.historyFileCount,
  durableCompleteCount: persisted.snapshot.durableCompleteCount,
  strongDurableCompleteCount: persisted.snapshot.strongDurableCompleteCount,
  incompleteCount: persisted.snapshot.incompleteCount,
  invalidHistoryCount: persisted.snapshot.invalidHistoryCount,
  missingOutputReferenceCount: persisted.snapshot.missingOutputReferenceCount,
  invalidOutputReferenceCount: persisted.snapshot.invalidOutputReferenceCount,
  mutableSupersededReferenceCount: persisted.snapshot.mutableSupersededReferenceCount,
  retainedOutputFileCount: persisted.snapshot.retainedOutputFileCount,
  retainedOutputBytes: persisted.snapshot.retainedOutputBytes,
  referencedRetainedOutputCount: persisted.snapshot.referencedRetainedOutputCount,
  orphanRetainedOutputCount: persisted.snapshot.orphanRetainedOutputCount,
  invalidRetainedOutputCount: persisted.snapshot.invalidRetainedOutputCount,
  legacyCompatibilityCount: persisted.snapshot.legacyCompatibilityCount,
  nonStrongRuns: persisted.snapshot.nonStrongRuns.map((run) => ({
    runId: run.runId,
    taskId: run.taskId,
    classification: run.classification,
    warnings: run.warnings,
  })),
  automaticPromotionAuthorized: persisted.snapshot.automaticPromotionAuthorized,
  currentBuyConnectionAuthorized: persisted.snapshot.currentBuyConnectionAuthorized,
  lineConnectionAuthorized: persisted.snapshot.lineConnectionAuthorized,
  publicPublishAuthorized: persisted.snapshot.publicPublishAuthorized,
  databaseWriteAuthorized: persisted.snapshot.databaseWriteAuthorized,
  automatedBettingAuthorized: persisted.snapshot.automatedBettingAuthorized,
  productionApplyAuthorized: persisted.snapshot.productionApplyAuthorized,
}, null, 2));

if (report.status === "BLOCKED") process.exitCode = 3;
