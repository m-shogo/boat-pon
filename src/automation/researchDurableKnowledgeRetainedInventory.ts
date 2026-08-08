import { createHash } from "node:crypto";

import {
  buildResearchDurableKnowledgeCompletenessReport,
  type ResearchDurableKnowledgeCompletenessReport,
} from "./researchDurableKnowledgeCompleteness";
import {
  buildResearchDurableKnowledgeCompletenessReportWithLegacyCompatibility,
} from "./researchDurableKnowledgeLegacyCompatibility";
import { inventoryResearchRetainedOutputs } from "./researchRetainedOutputInventory";

export type ResearchDurableKnowledgeCompletenessReportWithRetainedInventory =
  ResearchDurableKnowledgeCompletenessReport & {
    retainedOutputFileCount: number;
    retainedOutputBytes: number;
    referencedRetainedOutputCount: number;
    orphanRetainedOutputCount: number;
    invalidRetainedOutputCount: number;
  };

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function augmentResearchDurableKnowledgeCompletenessReportWithRetainedInventory(input: {
  repoRoot: string;
  report: ResearchDurableKnowledgeCompletenessReport;
}): ResearchDurableKnowledgeCompletenessReportWithRetainedInventory {
  const inventory = inventoryResearchRetainedOutputs({ repoRoot: input.repoRoot });
  const referencedRetainedPaths = new Set(
    input.report.runs
      .flatMap((run) => run.outputs)
      .filter((output) => output.rootClass === "RETAINED")
      .map((output) => output.relativePath),
  );
  const referencedRetainedOutputCount = inventory.entries
    .filter((entry) => referencedRetainedPaths.has(entry.relativePath)).length;
  const orphanRetainedOutputCount = inventory.entries
    .filter((entry) => entry.relativePath !== inventory.retainedRoot)
    .filter((entry) => !referencedRetainedPaths.has(entry.relativePath)).length;
  const invalidRetainedOutputCount = inventory.invalidFileCount;
  const inventoryBlocked = orphanRetainedOutputCount > 0 || invalidRetainedOutputCount > 0;
  const status = inventoryBlocked ? "BLOCKED" as const : input.report.status;
  const { outputDigest: _previousOutputDigest, ...reportWithoutDigest } = input.report;
  const core = {
    ...reportWithoutDigest,
    status,
    retainedOutputFileCount: inventory.fileCount,
    retainedOutputBytes: inventory.totalBytes,
    referencedRetainedOutputCount,
    orphanRetainedOutputCount,
    invalidRetainedOutputCount,
  };
  return {
    ...core,
    outputDigest: sha256Text(JSON.stringify(core)),
  };
}

export function buildResearchDurableKnowledgeCompletenessReportWithRetainedInventory(input: {
  repoRoot: string;
  generatedAt?: string;
}): ResearchDurableKnowledgeCompletenessReportWithRetainedInventory {
  return augmentResearchDurableKnowledgeCompletenessReportWithRetainedInventory({
    repoRoot: input.repoRoot,
    report: buildResearchDurableKnowledgeCompletenessReport(input),
  });
}

export function buildResearchDurableKnowledgeCompletenessReportWithLegacyCompatibilityAndRetainedInventory(input: {
  repoRoot: string;
  generatedAt?: string;
}): ResearchDurableKnowledgeCompletenessReportWithRetainedInventory {
  return augmentResearchDurableKnowledgeCompletenessReportWithRetainedInventory({
    repoRoot: input.repoRoot,
    report: buildResearchDurableKnowledgeCompletenessReportWithLegacyCompatibility(input),
  });
}
