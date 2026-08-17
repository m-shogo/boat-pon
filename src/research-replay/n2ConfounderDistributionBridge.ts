import { canonicalHash } from "./canonical";
import type { N2ConfounderFlag } from "./n2ConfounderRejectionAudit";
import type { N2EdgeHistoricalConfirmationResult } from "./n2EdgeHistoricalConfirmation";
import {
  evaluateN2EdgeHoldoutConcentration,
  type N2EdgeHoldoutConcentrationPolicyReport,
} from "./n2EdgeHoldoutConcentrationPolicy";
import type { N2EdgeHoldoutDistributionEvidenceReport } from "./n2EdgeHoldoutDistributionEvidence";

export const N2_CONFOUNDER_DISTRIBUTION_BRIDGE_VERSION =
  "n2-confounder-distribution-bridge-v1" as const;

export type N2ConfounderDistributionBridgeReport = {
  bridgeVersion: typeof N2_CONFOUNDER_DISTRIBUTION_BRIDGE_VERSION;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  evidenceMode: "aggregate_distribution_present" | "aggregate_distribution_missing";
  confirmationHypothesisCount: number;
  policy: N2EdgeHoldoutConcentrationPolicyReport | null;
  confounderFlags: N2ConfounderFlag[];
  confirmedWithoutBlockingConcentrationCount: number;
  confirmedBlockedByConcentrationCount: number;
  confirmedBlockedByInsufficientDistributionCount: number;
  confirmedBlockedByMissingDistributionCount: number;
  authority: {
    historicalVerdictChanged: false;
    rejectedHypothesisRescueAuthorized: false;
    automaticPromotionAuthorized: false;
    forwardLabelsUsed: false;
    currentBuyConnectionAuthorized: false;
    lineConnectionAuthorized: false;
    publicPublishAuthorized: false;
    automatedBettingAuthorized: false;
    productionApplyAuthorized: false;
  };
  outputDigest: string;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function blocked(input: {
  blockers: string[];
  evidenceMode: N2ConfounderDistributionBridgeReport["evidenceMode"];
  confirmationHypothesisCount: number;
  policy: N2EdgeHoldoutConcentrationPolicyReport | null;
}): N2ConfounderDistributionBridgeReport {
  const core = {
    bridgeVersion: N2_CONFOUNDER_DISTRIBUTION_BRIDGE_VERSION,
    status: "BLOCKED" as const,
    blockers: unique(input.blockers),
    evidenceMode: input.evidenceMode,
    confirmationHypothesisCount: input.confirmationHypothesisCount,
    policy: input.policy,
    confounderFlags: [] as N2ConfounderFlag[],
    confirmedWithoutBlockingConcentrationCount: 0,
    confirmedBlockedByConcentrationCount: 0,
    confirmedBlockedByInsufficientDistributionCount: 0,
    confirmedBlockedByMissingDistributionCount: 0,
    authority: {
      historicalVerdictChanged: false as const,
      rejectedHypothesisRescueAuthorized: false as const,
      automaticPromotionAuthorized: false as const,
      forwardLabelsUsed: false as const,
      currentBuyConnectionAuthorized: false as const,
      lineConnectionAuthorized: false as const,
      publicPublishAuthorized: false as const,
      automatedBettingAuthorized: false as const,
      productionApplyAuthorized: false as const,
    },
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

export function buildN2ConfounderDistributionBridge(input: {
  confirmationResults: N2EdgeHistoricalConfirmationResult[];
  distributionEvidence: N2EdgeHoldoutDistributionEvidenceReport | null;
}): N2ConfounderDistributionBridgeReport {
  const confirmationIds = input.confirmationResults.map((result) => result.hypothesisId).sort();
  const blockers: string[] = [];
  if (new Set(confirmationIds).size !== confirmationIds.length) blockers.push("DUPLICATE_CONFIRMATION_HYPOTHESIS_ID");

  if (input.distributionEvidence === null) {
    blockers.push("DISTRIBUTION_EVIDENCE_REQUIRED_BY_PRODUCER_CONTRACT");
    return blocked({
      blockers,
      evidenceMode: "aggregate_distribution_missing",
      confirmationHypothesisCount: confirmationIds.length,
      policy: null,
    });
  }

  const policy = evaluateN2EdgeHoldoutConcentration(input.distributionEvidence);
  if (policy.status !== "PASS") blockers.push(...policy.blockers.map((blocker) => `CONCENTRATION_POLICY_${blocker}`));
  const policyIds = policy.hypotheses.map((item) => item.hypothesisId).sort();
  if (policy.status === "PASS" && canonicalHash(policyIds) !== canonicalHash(confirmationIds)) {
    blockers.push("CONCENTRATION_POLICY_HYPOTHESIS_SET_MISMATCH");
  }
  if (policy.status === "PASS") {
    const policyById = new Map(policy.hypotheses.map((item) => [item.hypothesisId, item]));
    for (const result of input.confirmationResults) {
      const decision = policyById.get(result.hypothesisId);
      if (!decision) continue;
      if (decision.validation.uniqueRaceCount !== result.validation.uniqueRaceCount
        || decision.test.uniqueRaceCount !== result.test.uniqueRaceCount) {
        blockers.push(
          `CONCENTRATION_POLICY_CONFIRMATION_SUPPORT_MISMATCH:${result.hypothesisId}`
          + `:${decision.validation.uniqueRaceCount}/${result.validation.uniqueRaceCount}`
          + `:${decision.test.uniqueRaceCount}/${result.test.uniqueRaceCount}`,
        );
      }
    }
  }
  if (blockers.length > 0) {
    return blocked({
      blockers,
      evidenceMode: "aggregate_distribution_present",
      confirmationHypothesisCount: confirmationIds.length,
      policy,
    });
  }

  const policyById = new Map(policy.hypotheses.map((item) => [item.hypothesisId, item]));
  const confounderFlags: N2ConfounderFlag[] = [];
  let confirmedWithoutBlockingConcentrationCount = 0;
  let confirmedBlockedByConcentrationCount = 0;
  let confirmedBlockedByInsufficientDistributionCount = 0;
  for (const result of [...input.confirmationResults].sort((left, right) => left.hypothesisId.localeCompare(right.hypothesisId))) {
    if (result.verdict !== "HISTORICAL_CONFIRMED") continue;
    const decision = policyById.get(result.hypothesisId)!;
    if (decision.status === "PASS") {
      confirmedWithoutBlockingConcentrationCount += 1;
      continue;
    }
    if (decision.status === "INSUFFICIENT_EVIDENCE") {
      confirmedBlockedByInsufficientDistributionCount += 1;
      confounderFlags.push({
        hypothesisId: result.hypothesisId,
        flagId: "holdout-distribution-evidence-insufficient-v1",
        severity: "blocking",
        detail: `Pre-registered distribution policy lacks sufficient support: ${decision.blockers.join(";")}`,
      });
      continue;
    }
    confirmedBlockedByConcentrationCount += 1;
    confounderFlags.push({
      hypothesisId: result.hypothesisId,
      flagId: "holdout-distribution-concentration-v1",
      severity: "blocking",
      detail: `Pre-registered distribution concentration policy blocked: ${decision.blockers.join(";")}`,
    });
  }

  const core = {
    bridgeVersion: N2_CONFOUNDER_DISTRIBUTION_BRIDGE_VERSION,
    status: "PASS" as const,
    blockers: [] as string[],
    evidenceMode: "aggregate_distribution_present" as const,
    confirmationHypothesisCount: confirmationIds.length,
    policy,
    confounderFlags,
    confirmedWithoutBlockingConcentrationCount,
    confirmedBlockedByConcentrationCount,
    confirmedBlockedByInsufficientDistributionCount,
    confirmedBlockedByMissingDistributionCount: 0,
    authority: {
      historicalVerdictChanged: false as const,
      rejectedHypothesisRescueAuthorized: false as const,
      automaticPromotionAuthorized: false as const,
      forwardLabelsUsed: false as const,
      currentBuyConnectionAuthorized: false as const,
      lineConnectionAuthorized: false as const,
      publicPublishAuthorized: false as const,
      automatedBettingAuthorized: false as const,
      productionApplyAuthorized: false as const,
    },
  };
  return { ...core, outputDigest: canonicalHash(core) };
}
