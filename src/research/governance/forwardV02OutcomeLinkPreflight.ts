import {
  outcomeLearningLedgerDigest,
  validateOutcomeLearningLedgerRecord,
  type OutcomeLearningLedgerRecord,
} from "./outcomeLearningLedger";
import {
  runtimeDecisionLedgerDigest,
  validateRuntimeDecisionLedgerRecord,
  type RuntimeDecisionLedgerRecord,
} from "./runtimeDecisionLedger";
import { assessForwardV02ReferenceReconciliation } from "./forwardV02ReferenceReconciliation";
import { snapshotForwardV02UntrustedGraph } from "./forwardV02UntrustedSnapshot";

/**
 * Research-only cross-ledger CONTENT preflight. Caller-supplied ledgers and
 * manifest hashes are not independent source attestation or prospective
 * enrollment evidence. Even complete synthetic linkage never permits scoring.
 */
export type ForwardV02OutcomeLinkAssessment = Readonly<{
  outcomeReferencesLinked: boolean;
  excludedOutcomePresent: boolean;
  scoringAuthorized: false;
  blockers: readonly string[];
}>;

const blocked = (reason: string): ForwardV02OutcomeLinkAssessment => Object.freeze({
  outcomeReferencesLinked: false, excludedOutcomePresent: false,
  scoringAuthorized: false, blockers: Object.freeze([reason]),
});

function exactArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype ||
        "toJSON" in value || Reflect.ownKeys(value).length !== value.length + 1) return false;
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return false;
    }
    return true;
  } catch { return false; }
}

function expectedDecisionMode(stage: unknown): string | null {
  switch (stage) {
    case "HISTORICAL": return "historical";
    case "VALIDATION": return "validation";
    case "SHADOW_FORWARD": return "shadow_forward";
    case "FUTURE_ONLY": return "future_only";
    // Runtime Decision Ledger 0.1 has no explicit untouched-holdout mode.
    default: return null;
  }
}

// Date.parse truncates fractional seconds; preserve exact chronology.
function compareInstants(left: string, right: string): number {
  const fraction = /\.(\d+)(?=Z$|[+-]\d{2}:\d{2}$)/u;
  const leftSecond = Date.parse(left.replace(fraction, ""));
  const rightSecond = Date.parse(right.replace(fraction, ""));
  if (leftSecond !== rightSecond) return leftSecond < rightSecond ? -1 : 1;
  const a = fraction.exec(left)?.[1] ?? "";
  const b = fraction.exec(right)?.[1] ?? "";
  const width = Math.max(a.length, b.length);
  const x = a.padEnd(width, "0"), y = b.padEnd(width, "0");
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Requires exact manifest-ordered decision/outcome digest equality and
 * decision-to-ticket identity linkage. Does not treat a caller's EXACT flag
 * as evidence of an independently verified settlement or freeze.
 */
export function assessForwardV02OutcomeLinkPreflight(
  candidate: unknown,
  references: unknown,
  decisions: unknown,
  outcomes: unknown,
): ForwardV02OutcomeLinkAssessment {
  try {
    // Pin all caller-owned ledgers BEFORE traversing the candidate or manifest.
    // A later reference-descriptor Proxy trap must not repair an earlier
    // decision/outcome record between reconciliation and digest admission.
    // This is structural isolation only, never independent attestation.
    try {
      decisions = snapshotForwardV02UntrustedGraph(decisions);
      outcomes = snapshotForwardV02UntrustedGraph(outcomes);
    } catch { return blocked("INVALID_LEDGER_COLLECTION"); }
    try {
      candidate = snapshotForwardV02UntrustedGraph(candidate);
      references = snapshotForwardV02UntrustedGraph(references);
    } catch { return blocked("REFERENCE_CONTEXT_NOT_RECONCILED"); }
    if (!assessForwardV02ReferenceReconciliation(candidate, references).referencesReconciled) {
      return blocked("REFERENCE_CONTEXT_NOT_RECONCILED");
    }
    if (!exactArray(decisions) || !exactArray(outcomes) ||
        decisions.length === 0 || outcomes.length === 0) {
      return blocked("INVALID_LEDGER_COLLECTION");
    }
    const refs = references as { sourceManifest: {
      evidenceStage: string; decisionDigests: string[]; outcomeDigests: string[];
    } };
    const manifest = refs.sourceManifest;
    if (decisions.length !== manifest.decisionDigests.length ||
        outcomes.length !== manifest.outcomeDigests.length) {
      return blocked("MANIFEST_LEDGER_CARDINALITY_MISMATCH");
    }
    const mode = expectedDecisionMode(manifest.evidenceStage);
    if (mode === null) return blocked("UNSUPPORTED_STAGE_MAPPING");

    const decisionByRecordId = new Map<string, RuntimeDecisionLedgerRecord>();
    for (let i = 0; i < decisions.length; i++) {
      const record = decisions[i];
      if (!validateRuntimeDecisionLedgerRecord(record).valid) return blocked("INVALID_DECISION_RECORD");
      const d = record as RuntimeDecisionLedgerRecord;
      if (runtimeDecisionLedgerDigest(d) !== manifest.decisionDigests[i]) {
        return blocked("DECISION_DIGEST_MISMATCH");
      }
      if (d.evaluationMode !== mode) return blocked("DECISION_STAGE_MISMATCH");
      if (decisionByRecordId.has(d.recordId)) return blocked("DUPLICATE_DECISION_RECORD_ID");
      decisionByRecordId.set(d.recordId, d);
    }

    const outcomeIds = new Set<string>();
    const linkedDecisionIds = new Set<string>();
    let excluded = false;
    for (let i = 0; i < outcomes.length; i++) {
      const record = outcomes[i];
      if (!validateOutcomeLearningLedgerRecord(record).valid) return blocked("INVALID_OUTCOME_RECORD");
      const o = record as OutcomeLearningLedgerRecord;
      if (outcomeLearningLedgerDigest(o) !== manifest.outcomeDigests[i]) {
        return blocked("OUTCOME_DIGEST_MISMATCH");
      }
      if (outcomeIds.has(o.outcomeRecordId)) return blocked("DUPLICATE_OUTCOME_RECORD_ID");
      outcomeIds.add(o.outcomeRecordId);
      const d = decisionByRecordId.get(o.decisionRecordId);
      if (!d || o.decisionId !== d.decisionId || o.canonicalRaceId !== d.canonicalRaceId ||
          o.ticketType !== d.ticketType || o.selection !== d.selection) {
        return blocked("OUTCOME_DECISION_LINK_MISMATCH");
      }
      if (d.decision !== "BUY") return blocked("NON_BUY_OUTCOME_LINK");
      if (linkedDecisionIds.has(d.recordId)) return blocked("MULTIPLE_SETTLEMENTS_FOR_DECISION");
      linkedDecisionIds.add(d.recordId);
      if (compareInstants(o.settledAt, d.decisionAt) < 0) {
        return blocked("OUTCOME_PRECEDES_DECISION");
      }
      if (o.finality !== "FINAL" || o.disposition !== "SETTLED" || o.evaluable !== true) {
        excluded = true;
      }
    }
    // The manifest can be internally self-consistent while silently omitting
    // an entire decision's settlement. Never call partial ledger coverage
    // fully linked: a missing decision must be retained as an explicit
    // exclusion under a future frozen policy, not dropped from the denominator.
    if (linkedDecisionIds.size !== decisionByRecordId.size) {
      return blocked("UNMATCHED_DECISION_RECORDS");
    }
    return Object.freeze({
      outcomeReferencesLinked: true,
      excludedOutcomePresent: excluded,
      scoringAuthorized: false,
      blockers: Object.freeze([
        "UNAPPROVED_PROTOCOL",
        "INDEPENDENT_EXACT_SETTLEMENT_NOT_ATTESTED",
        "PROSPECTIVE_ENROLLMENT_NOT_ATTESTED",
      ]),
    });
  } catch {
    return blocked("INVALID_LEDGER_COLLECTION");
  }
}
