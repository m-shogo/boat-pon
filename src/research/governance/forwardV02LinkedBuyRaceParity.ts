import { assessForwardV02OutcomeLinkPreflight } from "./forwardV02OutcomeLinkPreflight";

/**
 * Research-only linked-BUY race-set parity check for the unapproved v0.2
 * COMMON_COHORT candidate. This is NOT proof of prospective enrollment,
 * identical ticket exposure, eligible denominators, or an independent result.
 *
 * The lower-level cross-ledger preflight proves only caller-supplied content
 * consistency; this additional check prevents unequal linked race sets from
 * being mislabeled as an aligned cross-system comparison.
 */
export type ForwardV02LinkedBuyRaceParityAssessment = Readonly<{
  linkedBuyRaceSetsAligned: boolean;
  scoringAuthorized: false;
  blockers: readonly string[];
}>;

const deny = (reason: string): ForwardV02LinkedBuyRaceParityAssessment => ({
  linkedBuyRaceSetsAligned: false, scoringAuthorized: false, blockers: [reason],
});

/**
 * No success path grants scoring authority. Caller-controlled candidate,
 * manifest, decisions and outcomes are NOT independent evidence.
 */
export function assessForwardV02LinkedBuyRaceParity(
  candidate: unknown,
  references: unknown,
  decisions: unknown,
  outcomes: unknown,
): ForwardV02LinkedBuyRaceParityAssessment {
  try {
    if (!assessForwardV02OutcomeLinkPreflight(
      candidate, references, decisions, outcomes,
    ).outcomeReferencesLinked) return deny("OUTCOME_LINK_NOT_VERIFIED");

    // The prior preflight validates all candidate/ledger shapes, including
    // own-data, dense unique benchmark arrays and exact digest linkage.
    const c = candidate as {
      comparisonMode: string;
      benchmarkDecisionSystems: string[];
    };
    if (c.comparisonMode !== "COMMON_COHORT") return deny("NOT_COMMON_COHORT_PROTOCOL");
    if (c.benchmarkDecisionSystems.length < 2) return deny("INSUFFICIENT_BENCHMARK_SYSTEMS");

    const racesBySystem = new Map<string, Set<string>>();
    for (let i = 0; i < c.benchmarkDecisionSystems.length; i++) {
      racesBySystem.set(c.benchmarkDecisionSystems[i]!, new Set<string>());
    }

    const rows = decisions as {
      decisionSystem: string;
      canonicalRaceId: string;
      cohortId: string;
    }[];
    let sharedCohortId: string | null = null;
    for (let i = 0; i < rows.length; i++) {
      const d = rows[i]!;
      const races = racesBySystem.get(d.decisionSystem);
      if (!races) return deny("UNDECLARED_DECISION_SYSTEM");
      if (sharedCohortId === null) sharedCohortId = d.cohortId;
      else if (d.cohortId !== sharedCohortId) return deny("MIXED_COHORT_IDENTITIES");
      // Multiple ticket decisions on the same race are allowed. Race parity
      // must not silently become ticket-count or stake-denominator parity.
      races.add(d.canonicalRaceId);
    }

    const reference = racesBySystem.get(c.benchmarkDecisionSystems[0]!)!;
    for (let i = 0; i < c.benchmarkDecisionSystems.length; i++) {
      const races = racesBySystem.get(c.benchmarkDecisionSystems[i]!)!;
      if (races.size === 0) return deny("MISSING_BENCHMARK_DECISION_SYSTEM");
      if (races.size !== reference.size) return deny("UNEQUAL_LINKED_BUY_RACE_SETS");
      for (const raceId of reference) {
        if (!races.has(raceId)) return deny("UNEQUAL_LINKED_BUY_RACE_SETS");
      }
    }

    return {
      linkedBuyRaceSetsAligned: true,
      scoringAuthorized: false,
      blockers: [
        "UNAPPROVED_PROTOCOL",
        "PROSPECTIVE_COHORT_NOT_ATTESTED",
        "INDEPENDENT_EXACT_SETTLEMENT_NOT_ATTESTED",
        "ELIGIBLE_DENOMINATORS_AND_EXCLUSIONS_NOT_VERIFIED",
      ],
    };
  } catch {
    return deny("INVALID_PARITY_CONTEXT");
  }
}
