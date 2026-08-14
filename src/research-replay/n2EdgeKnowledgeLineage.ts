import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import type { N2ConfounderAuditItem } from "./n2ConfounderRejectionAudit";
import type { N2EdgeHistoricalConfirmationResult } from "./n2EdgeHistoricalConfirmation";
import {
  validateDiscovery,
  validateExperiment,
  type Discovery,
  type Experiment,
} from "../research/governance/contracts";

export const N2_EDGE_KNOWLEDGE_LINEAGE_VERSION = "n2-edge-knowledge-lineage-v1" as const;
export const N2_EDGE_TRIAL_FAMILY_ID = "N2-EDGE-V1" as const;

export type N2EdgeKnowledgeLineageInput = {
  confirmation: N2EdgeHistoricalConfirmationResult;
  auditItem: N2ConfounderAuditItem;
  scanArtifactDigest: string;
  historicalTestArtifactDigest: string;
  confounderAuditArtifactDigest: string;
  testedConditionCount: number;
  totalTrialCount: number;
  createdAt: string;
};

export type N2EdgeKnowledgeLineagePlan = {
  lineageVersion: typeof N2_EDGE_KNOWLEDGE_LINEAGE_VERSION;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  experiment: Experiment | null;
  discoveryCandidate: Discovery | null;
  registryPlan: {
    experimentRegistryKind: "experiments";
    discoveryRegistryKind: "discoveries";
    experimentAppendEligible: boolean;
    discoveryAppendEligible: boolean;
    registryWriteAuthorized: false;
  };
  invariants: {
    discoveryRequiresCompletedExperiment: true;
    discoveryRequiresConfirmedPendingDisposition: true;
    blockingConfounderCreatesDiscovery: false;
    historicalRejectionCreatesDiscovery: false;
    insufficientHoldoutCreatesDiscovery: false;
    discoveryAutomaticallyAdopted: false;
    currentBuyTransferAuthorized: false;
  };
  authority: {
    automaticPromotionAuthorized: false;
    currentBuyConnectionAuthorized: false;
    lineConnectionAuthorized: false;
    publicPublishAuthorized: false;
    automatedBettingAuthorized: false;
    productionApplyAuthorized: false;
  };
  outputDigest: string;
};

function isDigest(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function isValidTimestamp(value: string): boolean {
  try {
    canonicalUtcTimestamp(value);
    return true;
  } catch {
    return false;
  }
}

function hypothesisText(input: N2EdgeKnowledgeLineageInput): string {
  const direction = input.confirmation.discoveryDirection === "underpredicted"
    ? "historically underpredicted"
    : "historically overpredicted";
  return `${input.confirmation.featureKey}=${input.confirmation.bucket} is ${direction} by the frozen N2 historical baseline and should reproduce in both locked holdout splits.`;
}

function experimentStatus(disposition: N2ConfounderAuditItem["disposition"]): Experiment["status"] {
  if (disposition === "REJECT_AND_REGISTER") return "rejected";
  if (disposition === "INSUFFICIENT_HOLDOUT") return "inconclusive";
  return "completed";
}

function buildExperiment(input: N2EdgeKnowledgeLineageInput): Experiment {
  const identity = canonicalHash({
    hypothesisId: input.confirmation.hypothesisId,
    scanArtifactDigest: input.scanArtifactDigest,
    historicalTestArtifactDigest: input.historicalTestArtifactDigest,
    confounderAuditArtifactDigest: input.confounderAuditArtifactDigest,
  }).slice(0, 20);
  return {
    experimentId: `EXP-N2EDGE-${identity}`,
    researchQuestion: `Does locked N2 hypothesis ${input.confirmation.hypothesisId} reproduce outside the 2004-2021 discovery period?`,
    rationale: "N2 v1 separates train discovery from validation/test confirmation, then applies a pre-registered confounder audit before any knowledge candidate is allowed.",
    hypothesis: hypothesisText(input),
    dataSnapshot: `scan=${input.scanArtifactDigest};historical=${input.historicalTestArtifactDigest};confounder=${input.confounderAuditArtifactDigest}`,
    trialFamilyId: N2_EDGE_TRIAL_FAMILY_ID,
    totalTrialCount: input.totalTrialCount,
    testedConditions: input.testedConditionCount,
    discoveryPeriod: "2004-01-01..2021-12-31",
    validationPeriod: "validation=2022-01-01..2023-12-31;test=2024-01-01..2025-12-31",
    holdoutPolicy: "Frozen validation/test splits; race-level residual confirmation; forward-shadow remains reserved and unused.",
    primaryMetric: "Race-level mean probability residual with Holm-Bonferroni family-wise correction",
    secondaryMetrics: [
      "unique race support",
      "validation/test direction consistency",
      "venue breadth and maximum venue share",
      "year breadth and maximum year share",
    ],
    minimumSample: 200,
    stoppingRule: "No adaptive stopping inside a split; evaluate the frozen deterministic holdout cohorts once.",
    successCondition: "Both validation and test independently satisfy support, effect, direction and Holm-adjusted significance, with no blocking pre-registered confounder flag.",
    rejectionCondition: "Historical holdout confirmation failure is irreversible within N2 v1; insufficient support remains inconclusive rather than rejected.",
    multiplicityFamily: "N2-EDGE-V1 Holm-Bonferroni within each locked holdout split",
    evidenceStage: "holdout",
    status: experimentStatus(input.auditItem.disposition),
    createdAt: input.createdAt,
  };
}

function buildDiscovery(input: N2EdgeKnowledgeLineageInput, experiment: Experiment): Discovery | null {
  if (input.auditItem.disposition !== "CONFIRMED_PENDING_CONFOUNDER_REVIEW") return null;
  const identity = canonicalHash({
    experimentId: experiment.experimentId,
    hypothesisId: input.confirmation.hypothesisId,
    confounderAuditArtifactDigest: input.confounderAuditArtifactDigest,
  }).slice(0, 20);
  const knownConfounders = input.auditItem.confounderFlags
    .map((flag) => `${flag.flagId}:${flag.severity}:${flag.detail}`)
    .sort();
  return {
    discoveryId: `DISC-N2EDGE-${identity}`,
    sourceExperimentIds: [experiment.experimentId],
    sourceStrategyId: null,
    sourceStrategyVersion: null,
    finding: `Locked N2 condition ${input.confirmation.featureKey}=${input.confirmation.bucket} reproduced with ${input.confirmation.discoveryDirection} residual direction in both historical holdout splits and has no blocking confounder flag under the frozen N2 v1 audit.`,
    mechanismHypothesis: `The ${input.confirmation.featureKey}=${input.confirmation.bucket} condition may represent a stable source of probability miscalibration; mechanism remains a hypothesis until independently tested.`,
    evidenceLevel: "moderate",
    shareClass: "REUSABLE_CANDIDATE",
    scope: "market_intelligence research only; trifecta probability residual; no Current BUY, LINE, public, betting or production transfer",
    knownConfounders,
    trialFamilyId: N2_EDGE_TRIAL_FAMILY_ID,
    trialCountAtDiscovery: input.totalTrialCount,
    adoptedBy: [],
    rejectedBy: [],
    createdAt: input.createdAt,
  };
}

export function buildN2EdgeKnowledgeLineagePlan(
  input: N2EdgeKnowledgeLineageInput,
): N2EdgeKnowledgeLineagePlan {
  const blockers: string[] = [];
  if (input.auditItem.hypothesisId !== input.confirmation.hypothesisId) blockers.push("AUDIT_CONFIRMATION_HYPOTHESIS_MISMATCH");
  if (input.auditItem.historicalVerdict !== input.confirmation.verdict) blockers.push("AUDIT_CONFIRMATION_VERDICT_MISMATCH");
  if (input.auditItem.promotionAuthorized !== false) blockers.push("AUDIT_PROMOTION_AUTHORITY_INVALID");
  for (const [name, digest] of [
    ["scan", input.scanArtifactDigest],
    ["historical", input.historicalTestArtifactDigest],
    ["confounder", input.confounderAuditArtifactDigest],
  ] as const) if (!isDigest(digest)) blockers.push(`${name.toUpperCase()}_ARTIFACT_DIGEST_INVALID`);
  if (!Number.isSafeInteger(input.testedConditionCount) || input.testedConditionCount < 0) blockers.push("TESTED_CONDITION_COUNT_INVALID");
  if (!Number.isSafeInteger(input.totalTrialCount) || input.totalTrialCount < input.testedConditionCount) blockers.push("TOTAL_TRIAL_COUNT_INVALID");
  if (!isValidTimestamp(input.createdAt)) blockers.push("CREATED_AT_INVALID");
  if (input.auditItem.disposition === "CONFIRMED_PENDING_CONFOUNDER_REVIEW"
    && input.confirmation.verdict !== "HISTORICAL_CONFIRMED") blockers.push("DISCOVERY_ELIGIBLE_DISPOSITION_WITHOUT_HISTORICAL_CONFIRMATION");
  if (blockers.length > 0) return blockedPlan(blockers);

  const experiment = buildExperiment(input);
  const experimentValidation = validateExperiment(experiment);
  if (!experimentValidation.valid) blockers.push(...experimentValidation.errors.map((error) => `EXPERIMENT:${error}`));
  const discoveryCandidate = buildDiscovery(input, experiment);
  if (discoveryCandidate) {
    const discoveryValidation = validateDiscovery(discoveryCandidate);
    if (!discoveryValidation.valid) blockers.push(...discoveryValidation.errors.map((error) => `DISCOVERY:${error}`));
    if (experiment.status !== "completed") blockers.push("DISCOVERY_REQUIRES_COMPLETED_EXPERIMENT");
  }
  if (blockers.length > 0) return blockedPlan(blockers);

  const core = {
    lineageVersion: N2_EDGE_KNOWLEDGE_LINEAGE_VERSION,
    status: "PASS" as const,
    blockers: [] as string[],
    experiment,
    discoveryCandidate,
    registryPlan: {
      experimentRegistryKind: "experiments" as const,
      discoveryRegistryKind: "discoveries" as const,
      experimentAppendEligible: true,
      discoveryAppendEligible: discoveryCandidate !== null,
      registryWriteAuthorized: false as const,
    },
    invariants: {
      discoveryRequiresCompletedExperiment: true as const,
      discoveryRequiresConfirmedPendingDisposition: true as const,
      blockingConfounderCreatesDiscovery: false as const,
      historicalRejectionCreatesDiscovery: false as const,
      insufficientHoldoutCreatesDiscovery: false as const,
      discoveryAutomaticallyAdopted: false as const,
      currentBuyTransferAuthorized: false as const,
    },
    authority: {
      automaticPromotionAuthorized: false as const,
      currentBuyConnectionAuthorized: false as const,
      lineConnectionAuthorized: false as const,
      publicPublishAuthorized: false as const,
      automatedBettingAuthorized: false as const,
      productionApplyAuthorized: false as const,
    },
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

function blockedPlan(blockers: string[]): N2EdgeKnowledgeLineagePlan {
  const core = {
    lineageVersion: N2_EDGE_KNOWLEDGE_LINEAGE_VERSION,
    status: "BLOCKED" as const,
    blockers: unique(blockers),
    experiment: null,
    discoveryCandidate: null,
    registryPlan: {
      experimentRegistryKind: "experiments" as const,
      discoveryRegistryKind: "discoveries" as const,
      experimentAppendEligible: false,
      discoveryAppendEligible: false,
      registryWriteAuthorized: false as const,
    },
    invariants: {
      discoveryRequiresCompletedExperiment: true as const,
      discoveryRequiresConfirmedPendingDisposition: true as const,
      blockingConfounderCreatesDiscovery: false as const,
      historicalRejectionCreatesDiscovery: false as const,
      insufficientHoldoutCreatesDiscovery: false as const,
      discoveryAutomaticallyAdopted: false as const,
      currentBuyTransferAuthorized: false as const,
    },
    authority: {
      automaticPromotionAuthorized: false as const,
      currentBuyConnectionAuthorized: false as const,
      lineConnectionAuthorized: false as const,
      publicPublishAuthorized: false as const,
      automatedBettingAuthorized: false as const,
      productionApplyAuthorized: false as const,
    },
  };
  return { ...core, outputDigest: canonicalHash(core) };
}
