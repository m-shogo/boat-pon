import { assessForwardV02OutcomeLinkPreflight } from "./forwardV02OutcomeLinkPreflight";
import { snapshotForwardV02UntrustedGraph } from "./forwardV02UntrustedSnapshot";

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

const deny = (reason: string): ForwardV02LinkedBuyRaceParityAssessment => Object.freeze({
  linkedBuyRaceSetsAligned: false, scoringAuthorized: false, blockers: Object.freeze([reason]),
});

/**
 * Detach all untrusted parity inputs before any lower-level preflight can
 * traverse a caller Proxy and mutate an earlier ledger or candidate.
 * This establishes stable comparison inputs, NOT independent authority.
 */
function pinParityInputs(candidate: unknown, references: unknown, decisions: unknown, outcomes: unknown) {
  const pinnedDecisions = snapshotForwardV02UntrustedGraph(decisions);
  const pinnedOutcomes = snapshotForwardV02UntrustedGraph(outcomes);
  const pinnedCandidate = snapshotForwardV02UntrustedGraph(candidate);
  const pinnedReferences = snapshotForwardV02UntrustedGraph(references);
  return {
    candidate: pinnedCandidate, references: pinnedReferences,
    decisions: pinnedDecisions, outcomes: pinnedOutcomes,
  };
}

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
    try {
      ({ candidate, references, decisions, outcomes } =
        pinParityInputs(candidate, references, decisions, outcomes));
    } catch { return deny("OUTCOME_LINK_NOT_VERIFIED"); }
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

    return Object.freeze({
      linkedBuyRaceSetsAligned: true,
      scoringAuthorized: false,
      blockers: Object.freeze([
        "UNAPPROVED_PROTOCOL",
        "PROSPECTIVE_COHORT_NOT_ATTESTED",
        "INDEPENDENT_EXACT_SETTLEMENT_NOT_ATTESTED",
        "ELIGIBLE_DENOMINATORS_AND_EXCLUSIONS_NOT_VERIFIED",
      ]),
    });
  } catch {
    return deny("INVALID_PARITY_CONTEXT");
  }
}


/**
 * Additional, deny-only parity check on the *caller-supplied* outcome ledger.
 * Linked BUY race parity alone can hide asymmetric REFUNDED/VOID/non-evaluable
 * outcomes. Compare both locally settled/evaluable and locally excluded race
 * sets, without dropping exclusions from the evidence universe.
 *
 * This does NOT verify independent EXACT settlement, prospective enrollment,
 * ticket exposure, monetary denominators, or a frozen exclusion policy.
 */
export type ForwardV02LocalOutcomeRaceParityAssessment = Readonly<{
  localOutcomeRaceSetsAligned: boolean;
  scoringAuthorized: false;
  blockers: readonly string[];
}>;

const denyLocal = (reason: string): ForwardV02LocalOutcomeRaceParityAssessment => Object.freeze({
  localOutcomeRaceSetsAligned: false, scoringAuthorized: false, blockers: Object.freeze([reason]),
});

export function assessForwardV02LocalOutcomeRaceParity(
  candidate: unknown,
  references: unknown,
  decisions: unknown,
  outcomes: unknown,
): ForwardV02LocalOutcomeRaceParityAssessment {
  try {
    try {
      ({ candidate, references, decisions, outcomes } =
        pinParityInputs(candidate, references, decisions, outcomes));
    } catch { return denyLocal("LINKED_BUY_RACE_PARITY_NOT_VERIFIED"); }
    if (!assessForwardV02LinkedBuyRaceParity(
      candidate, references, decisions, outcomes,
    ).linkedBuyRaceSetsAligned) return denyLocal("LINKED_BUY_RACE_PARITY_NOT_VERIFIED");

    // The linked parity gate has already validated the candidate, both
    // ledgers, their exact manifest-ordered digests and one-to-one linkage.
    const c = candidate as { benchmarkDecisionSystems: string[] };
    const ds = decisions as { recordId: string; decisionSystem: string; canonicalRaceId: string }[];
    const os = outcomes as {
      decisionRecordId: string; finality: string; disposition: string;
      evaluable: boolean; stakeYen: number;
    }[];
    const systemByDecision = new Map<string, string>();
    const raceByDecision = new Map<string, string>();
    const settledBySystem = new Map<string, Set<string>>();
    const excludedBySystem = new Map<string, Set<string>>();
    for (let i = 0; i < c.benchmarkDecisionSystems.length; i++) {
      const system = c.benchmarkDecisionSystems[i]!;
      settledBySystem.set(system, new Set<string>());
      excludedBySystem.set(system, new Set<string>());
    }
    for (let i = 0; i < ds.length; i++) {
      const d = ds[i]!;
      systemByDecision.set(d.recordId, d.decisionSystem);
      raceByDecision.set(d.recordId, d.canonicalRaceId);
    }
    for (let i = 0; i < os.length; i++) {
      const o = os[i]!;
      const system = systemByDecision.get(o.decisionRecordId)!;
      const race = raceByDecision.get(o.decisionRecordId)!;
      if (o.finality === "FINAL" && o.disposition === "SETTLED" && o.evaluable === true) {
        if (o.stakeYen === 0) return denyLocal("NONPOSITIVE_LOCAL_SETTLED_STAKE");
        settledBySystem.get(system)!.add(race);
      } else {
        excludedBySystem.get(system)!.add(race);
      }
    }
    const firstSystem = c.benchmarkDecisionSystems[0]!;
    const referenceSettled = settledBySystem.get(firstSystem)!;
    const referenceExcluded = excludedBySystem.get(firstSystem)!;
    if (referenceSettled.size === 0) return denyLocal("NO_LOCALLY_SETTLED_RACES");
    for (let i = 1; i < c.benchmarkDecisionSystems.length; i++) {
      const system = c.benchmarkDecisionSystems[i]!;
      const settled = settledBySystem.get(system)!;
      if (settled.size !== referenceSettled.size) return denyLocal("UNEQUAL_LOCAL_SETTLED_RACE_SETS");
      for (const race of referenceSettled) {
        if (!settled.has(race)) return denyLocal("UNEQUAL_LOCAL_SETTLED_RACE_SETS");
      }
      const excluded = excludedBySystem.get(system)!;
      if (excluded.size !== referenceExcluded.size) return denyLocal("UNEQUAL_LOCAL_EXCLUSION_RACE_SETS");
      for (const race of referenceExcluded) {
        if (!excluded.has(race)) return denyLocal("UNEQUAL_LOCAL_EXCLUSION_RACE_SETS");
      }
    }
    return Object.freeze({
      localOutcomeRaceSetsAligned: true,
      scoringAuthorized: false,
      blockers: Object.freeze([
        "UNAPPROVED_PROTOCOL",
        "PROSPECTIVE_COHORT_NOT_ATTESTED",
        "INDEPENDENT_EXACT_SETTLEMENT_NOT_ATTESTED",
        "TICKET_STAKE_AND_FROZEN_EXCLUSION_POLICY_NOT_VERIFIED",
      ]),
    });
  } catch {
    return denyLocal("INVALID_LOCAL_OUTCOME_PARITY_CONTEXT");
  }
}
