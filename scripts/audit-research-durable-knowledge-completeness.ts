import { resolve } from "node:path";

import {
  buildResearchDurableKnowledgeCompletenessReportWithLegacyCompatibility,
  countAttestedLegacyDurableRuns,
} from "../src/automation/researchDurableKnowledgeLegacyCompatibility";

function argument(name: string): string | null {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const repoRoot = resolve(argument("repo-root") ?? process.cwd());
const generatedAtArg = argument("generated-at");
const generatedAt = generatedAtArg == null ? new Date().toISOString() : new Date(generatedAtArg).toISOString();
const report = buildResearchDurableKnowledgeCompletenessReportWithLegacyCompatibility({ repoRoot, generatedAt });

const sanitized = {
  summaryVersion: "research-durable-knowledge-completeness-summary-v1",
  reportVersion: report.reportVersion,
  evidenceRole: report.evidenceRole,
  generatedAt: report.generatedAt,
  status: report.status,
  historyRelativeDir: report.historyRelativeDir,
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
  legacyCompatibilityCount: countAttestedLegacyDurableRuns(report),
  earliestCompletedAt: report.earliestCompletedAt,
  latestCompletedAt: report.latestCompletedAt,
  taskTypeCounts: report.taskTypeCounts,
  classificationCounts: report.classificationCounts,
  runs: report.runs.map((run) => ({
    historyRelativePath: run.historyRelativePath,
    historyContentDigest: run.historyContentDigest,
    runId: run.runId,
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
    issues: run.issues,
    warnings: run.warnings,
    outputs: run.outputs.map((output) => ({
      relativePath: output.relativePath,
      rootClass: output.rootClass,
      integrity: output.integrity,
      exists: output.exists,
      regularFile: output.regularFile,
      embeddedDigest: output.embeddedDigest,
      historyDigestMatchesEmbedded: output.historyDigestMatchesEmbedded,
      complete: output.complete,
      issues: output.issues,
      warnings: output.warnings,
    })),
  })),
  automaticPromotionAuthorized: report.automaticPromotionAuthorized,
  currentBuyConnectionAuthorized: report.currentBuyConnectionAuthorized,
  lineConnectionAuthorized: report.lineConnectionAuthorized,
  publicPublishAuthorized: report.publicPublishAuthorized,
  databaseWriteAuthorized: report.databaseWriteAuthorized,
  automatedBettingAuthorized: report.automatedBettingAuthorized,
  productionApplyAuthorized: report.productionApplyAuthorized,
  outputDigest: report.outputDigest,
};
console.log(JSON.stringify(sanitized, null, 2));
if (report.status === "BLOCKED") process.exitCode = 3;
