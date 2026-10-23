import assert from "node:assert/strict";
import test from "node:test";
import { FORWARD_V02_CANDIDATE_VERSION } from "./forwardEvaluationProtocolV02Candidate";
import {
  assessForwardV02ReferenceReconciliation,
  forwardV02FormulaReferenceDigest,
  forwardV02SourceManifestReferenceDigest,
} from "./forwardV02ReferenceReconciliation";

const h = (c: string) => c.repeat(64);
const formula = () => ({
  formulaId: "NET_ROI_ON_STAKE_V1", expression: "(SUM_PAYOUT_MINUS_SUM_STAKE)/SUM_STAKE",
  currency: "JPY", unit: "INTEGER_YEN", denominator: "SUM_STAKE",
});
const manifest = () => ({
  schemaVersion: "forward-source-manifest.0.2-candidate", manifestId: "synthetic-manifest",
  evidenceStage: "SHADOW_FORWARD", analysisSnapshotDigest: h("a"),
  decisionDigests: [h("b"), h("c")], outcomeDigests: [h("d")],
  createdAt: "2026-10-24T00:00:00Z", productionConnection: false,
});
function candidate() {
  return {
    schemaVersion: FORWARD_V02_CANDIDATE_VERSION, kind: "EVALUATION_PROTOCOL",
    protocolId: "synthetic-unapproved", protocolVersion: "0.2-candidate", status: "UNAPPROVED",
    evidenceStage: "SHADOW_FORWARD", createdAt: "2026-10-23T00:00:00Z",
    comparisonMode: "COMMON_COHORT", oddsBasis: "BUY_TIME",
    metricFormulaId: "NET_ROI_ON_STAKE_V1", metricFormulaDigest: forwardV02FormulaReferenceDigest(formula())!,
    moneyPolicy: { currency: "JPY", unit: "INTEGER_YEN",
      netRoiFormula: "(SUM_PAYOUT_MINUS_SUM_STAKE)/SUM_STAKE", refund: "EXCLUDE_AND_COUNT",
      void: "EXCLUDE_AND_COUNT", cancelled: "EXCLUDE_AND_COUNT",
      unresolved: "EXCLUDE_AND_COUNT", zeroDenominator: "UNSCORABLE_AND_REPORT" },
    maxHitPolicy: { eventUnit: "CANONICAL_RACE", exclusionAlignment: "SHARED_PREDECLARED_RACE",
      tieBreak: "LEXICOGRAPHIC_EVENT_ID_ASC", noPositiveEvent: "REMOVE_NONE",
      stakeAndPayoutRemoval: "REMOVE_BOTH" },
    samplePolicy: { minDecisions: 1, minRaces: 1, grouping: "PER_STAGE_PER_DECISION_SYSTEM" },
    exclusionReasons: ["REFUNDED", "VOID", "CANCELLED", "UNRESOLVED", "NONFINAL",
      "NOT_EVALUABLE", "IDENTITY_MISMATCH", "NOT_ENROLLED"],
    benchmarkDecisionSystems: ["synthetic-a", "synthetic-b"],
    evidenceRequirements: { outcome: "INDEPENDENT_EXACT_FINAL_EVALUABLE_SETTLED",
      sourceManifest: "INDEPENDENT_DIGEST_RECONCILIATION",
      enrollment: "PROSPECTIVE_FROZEN_BEFORE_DECISION", stagePooling: "PROHIBITED" },
    productionConnection: false, scoringAuthorized: false,
  };
}
function refs() {
  const m = manifest(), digest = forwardV02SourceManifestReferenceDigest(m)!;
  return { formula: formula(), formulaDigest: forwardV02FormulaReferenceDigest(formula())!,
    sourceManifest: m, expectedSourceManifestDigest: digest,
    resultSourceManifestDigest: digest, expectedAnalysisSnapshotDigest: h("a") };
}
const check = (c: unknown, r: unknown) => assessForwardV02ReferenceReconciliation(c, r);

test("matching synthetic content references remain unapproved and unscorable", () => {
  assert.deepEqual(check(candidate(), refs()), { referencesReconciled: true, scoringAuthorized: false,
    blockers: ["UNAPPROVED_PROTOCOL", "INDEPENDENT_AUTHORITY_NOT_ATTESTED", "SETTLEMENT_AND_ENROLLMENT_NOT_VERIFIED"] });
});
test("arbitrary digest-shaped candidate reference is not enough", () => {
  assert.deepEqual(check({ ...candidate(), metricFormulaDigest: h("e") }, refs()).blockers, ["FORMULA_REFERENCE_MISMATCH"]);
});
test("formula registry entry cannot silently change its semantics", () => {
  const r = refs(); r.formula.expression = "SUM_PAYOUT/SUM_STAKE";
  assert.deepEqual(check(candidate(), r).blockers, ["FORMULA_REFERENCE_MISMATCH"]);
});
test("formula registry digest must match canonical content, not just caller assertion", () => {
  const r = refs(); r.formulaDigest = h("f");
  assert.deepEqual(check(candidate(), r).blockers, ["FORMULA_REFERENCE_MISMATCH"]);
});
test("manifest decision identity changes invalidate the reference", () => {
  const r = refs(); r.sourceManifest.decisionDigests[0] = h("e");
  assert.deepEqual(check(candidate(), r).blockers, ["SOURCE_MANIFEST_REFERENCE_MISMATCH"]);
});
test("result digest and frozen manifest digest must both match", () => {
  const r = refs(); r.resultSourceManifestDigest = h("e");
  assert.deepEqual(check(candidate(), r).blockers, ["SOURCE_MANIFEST_REFERENCE_MISMATCH"]);
});
test("stage and snapshot mismatches fail closed", () => {
  const r = refs(); r.expectedAnalysisSnapshotDigest = h("e");
  assert.deepEqual(check(candidate(), r).blockers, ["STAGE_OR_SNAPSHOT_REFERENCE_MISMATCH"]);
  const r2 = refs(); r2.sourceManifest.evidenceStage = "VALIDATION";
  const digest = forwardV02SourceManifestReferenceDigest(r2.sourceManifest)!;
  r2.expectedSourceManifestDigest = digest; r2.resultSourceManifestDigest = digest;
  assert.deepEqual(check(candidate(), r2).blockers, ["STAGE_OR_SNAPSHOT_REFERENCE_MISMATCH"]);
});
test("private fields, unknown keys and accessor fields cannot enter manifest", () => {
  const r = refs() as Record<string, any>;
  r.sourceManifest.privateOdds = 3.5;
  assert.deepEqual(check(candidate(), r).blockers, ["SOURCE_MANIFEST_REFERENCE_MISMATCH"]);
  const r2 = refs();
  Object.defineProperty(r2.sourceManifest, "manifestId", { enumerable: true, get() { throw new Error("accessor"); } });
  assert.deepEqual(check(candidate(), r2).blockers, ["SOURCE_MANIFEST_REFERENCE_MISMATCH"]);
});
test("sparse, duplicate, toJSON arrays are rejected before hashing", () => {
  const r = refs(); r.sourceManifest.decisionDigests = [h("b"), h("b")];
  assert.equal(forwardV02SourceManifestReferenceDigest(r.sourceManifest), null);
  const r2 = refs(); r2.sourceManifest.decisionDigests = new Array(2) as string[];
  r2.sourceManifest.decisionDigests[1] = h("b");
  assert.equal(forwardV02SourceManifestReferenceDigest(r2.sourceManifest), null);
  const r3 = refs();
  Object.defineProperty(r3.sourceManifest.decisionDigests, "toJSON", { value: () => [] });
  assert.equal(forwardV02SourceManifestReferenceDigest(r3.sourceManifest), null);
});
test("unapproved candidate cannot assert scoring authority", () => {
  assert.deepEqual(check({ ...candidate(), scoringAuthorized: true }, refs()).blockers, ["INVALID_V02_CANDIDATE"]);
});
test("manifest timestamp cannot normalize impossible days, 24:00, or unknown offset", () => {
  for (const timestamp of ["2026-02-30T00:00:00Z", "2026-10-24T24:00:00Z", "2026-10-24T00:00:00-00:00"]) {
    const m = manifest(); m.createdAt = timestamp;
    assert.equal(forwardV02SourceManifestReferenceDigest(m), null);
  }
});
