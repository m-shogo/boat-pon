/**
 * Opt-in, Node-only, research-only strict ingress for v0.2 cross-ledger
 * linkage and race-parity preflights. The legacy assessors/callers are
 * unchanged. Caller-controlled graphs are detached before any lower-level
 * traversal, and root/nested/revoked Proxies are rejected without traps.
 *
 * These checks compare UNTRUSTED metadata. They cannot authenticate source
 * ledgers, freeze prospective cohorts, establish finality, provide atomic
 * capture against concurrent ordinary-object writers, authorize scoring,
 * or connect to production.
 */
import { snapshotForwardV02UntrustedGraphRejectingProxies } from "./forwardV02UntrustedSnapshot";
import {
  assessForwardV02OutcomeLinkPreflight,
  type ForwardV02OutcomeLinkAssessment,
} from "./forwardV02OutcomeLinkPreflight";
import {
  assessForwardV02LinkedBuyRaceParity,
  assessForwardV02LocalOutcomeRaceParity,
  type ForwardV02LinkedBuyRaceParityAssessment,
  type ForwardV02LocalOutcomeRaceParityAssessment,
} from "./forwardV02LinkedBuyRaceParity";

type Pinned = {
  candidate: unknown; references: unknown; decisions: unknown; outcomes: unknown;
};
type Capture = { ok: true; pinned: Pinned } |
  { ok: false; failed: "LEDGER" | "REFERENCE" };

/**
 * Preserve the legacy outcome-link diagnostic order: malformed ledgers
 * precede candidate/reference reconciliation failures. No caller graph
 * reaches a legacy assessor until all four captures succeed.
 */
function captureAll(
  candidate: unknown, references: unknown, decisions: unknown, outcomes: unknown,
): Capture {
  let pinnedDecisions: unknown, pinnedOutcomes: unknown;
  try {
    pinnedDecisions = snapshotForwardV02UntrustedGraphRejectingProxies(decisions);
    pinnedOutcomes = snapshotForwardV02UntrustedGraphRejectingProxies(outcomes);
  } catch { return { ok: false, failed: "LEDGER" }; }
  try {
    return {
      ok: true,
      pinned: {
        decisions: pinnedDecisions, outcomes: pinnedOutcomes,
        candidate: snapshotForwardV02UntrustedGraphRejectingProxies(candidate),
        references: snapshotForwardV02UntrustedGraphRejectingProxies(references),
      },
    };
  } catch { return { ok: false, failed: "REFERENCE" }; }
}

export function assessForwardV02OutcomeLinkPreflightStrictNodeIngress(
  candidate: unknown, references: unknown, decisions: unknown, outcomes: unknown,
): ForwardV02OutcomeLinkAssessment {
  const captured = captureAll(candidate, references, decisions, outcomes);
  if (!captured.ok) return Object.freeze({
    outcomeReferencesLinked: false, excludedOutcomePresent: false,
    scoringAuthorized: false,
    blockers: Object.freeze([captured.failed === "LEDGER" ?
      "INVALID_LEDGER_COLLECTION" : "REFERENCE_CONTEXT_NOT_RECONCILED"]),
  });
  const p = captured.pinned;
  return assessForwardV02OutcomeLinkPreflight(
    p.candidate, p.references, p.decisions, p.outcomes,
  );
}

export function assessForwardV02LinkedBuyRaceParityStrictNodeIngress(
  candidate: unknown, references: unknown, decisions: unknown, outcomes: unknown,
): ForwardV02LinkedBuyRaceParityAssessment {
  const captured = captureAll(candidate, references, decisions, outcomes);
  if (!captured.ok) return Object.freeze({
    linkedBuyRaceSetsAligned: false, scoringAuthorized: false,
    blockers: Object.freeze(["OUTCOME_LINK_NOT_VERIFIED"]),
  });
  const p = captured.pinned;
  return assessForwardV02LinkedBuyRaceParity(
    p.candidate, p.references, p.decisions, p.outcomes,
  );
}

export function assessForwardV02LocalOutcomeRaceParityStrictNodeIngress(
  candidate: unknown, references: unknown, decisions: unknown, outcomes: unknown,
): ForwardV02LocalOutcomeRaceParityAssessment {
  const captured = captureAll(candidate, references, decisions, outcomes);
  if (!captured.ok) return Object.freeze({
    localOutcomeRaceSetsAligned: false, scoringAuthorized: false,
    blockers: Object.freeze(["LINKED_BUY_RACE_PARITY_NOT_VERIFIED"]),
  });
  const p = captured.pinned;
  return assessForwardV02LocalOutcomeRaceParity(
    p.candidate, p.references, p.decisions, p.outcomes,
  );
}
