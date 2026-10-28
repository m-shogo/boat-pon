import assert from "node:assert/strict";
import test from "node:test";
import { FORWARD_V02_CANDIDATE_VERSION } from "./forwardEvaluationProtocolV02Candidate";
import {
  assessForwardV02ReferenceReconciliation,
  assessForwardV02ReferenceReconciliationStrictNodeIngress,
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
test("candidate descriptor mutation cannot repair an earlier mismatching formula digest", () => {
  const c = candidate(), correctDigest = c.metricFormulaDigest;
  c.metricFormulaDigest = h("e");
  let mutated = false;
  const proxy = new Proxy(c, {
    getOwnPropertyDescriptor(target, key) {
      // A late descriptor is inspected after metricFormulaDigest was copied.
      // The old validator examined all descriptors before reading the digest.
      if (key === "scoringAuthorized") {
        target.metricFormulaDigest = correctDigest;
        mutated = true;
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const result = check(proxy, refs());
  assert.equal(mutated, true, "the attempted late repair must execute");
  assert.equal(result.referencesReconciled, false);
  assert.equal(result.scoringAuthorized, false);
  assert.deepEqual(result.blockers, ["FORMULA_REFERENCE_MISMATCH"]);
});

test("manifest descriptor mutation cannot repair an earlier mismatching evidence stage", () => {
  const r = refs();
  r.sourceManifest.evidenceStage = "VALIDATION";
  let mutated = false;
  r.sourceManifest = new Proxy(r.sourceManifest, {
    getOwnPropertyDescriptor(target, key) {
      // The source-manifest hash used to validate all descriptors before
      // reading stage, so this mutation could repair a mismatched reference.
      if (key === "productionConnection") {
        target.evidenceStage = "SHADOW_FORWARD";
        mutated = true;
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const result = check(candidate(), r);
  assert.equal(mutated, true, "the attempted late stage repair must execute");
  assert.equal(result.referencesReconciled, false);
  assert.equal(result.scoringAuthorized, false);
  assert.deepEqual(result.blockers, ["SOURCE_MANIFEST_REFERENCE_MISMATCH"]);
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
  // The detached snapshot rejects the accessor before manifest hashing.
  assert.deepEqual(check(candidate(), r2).blockers, ["INVALID_REFERENCE_SHAPE"]);
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

test("standalone formula digest cannot repair an invalid expression during later descriptor traversal", () => {
  const f = formula();
  f.expression = "SUM_PAYOUT/SUM_STAKE";
  let mutationExecuted = false;
  const unstable = new Proxy(f, {
    getOwnPropertyDescriptor(target, key) {
      if (key === "denominator") {
        target.expression = "(SUM_PAYOUT_MINUS_SUM_STAKE)/SUM_STAKE";
        mutationExecuted = true;
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.equal(forwardV02FormulaReferenceDigest(unstable), null);
  assert.equal(mutationExecuted, true, "late descriptor repair must actually execute");
  assert.equal(forwardV02FormulaReferenceDigest(formula()) !== null, true);
});

test("standalone source-manifest digest cannot repair an invalid stage during later descriptor traversal", () => {
  const m = manifest();
  m.evidenceStage = "NOT_AN_EVIDENCE_STAGE";
  let mutationExecuted = false;
  const unstable = new Proxy(m, {
    getOwnPropertyDescriptor(target, key) {
      if (key === "productionConnection") {
        target.evidenceStage = "SHADOW_FORWARD";
        mutationExecuted = true;
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.equal(forwardV02SourceManifestReferenceDigest(unstable), null);
  assert.equal(mutationExecuted, true, "late descriptor repair must actually execute");
  assert.equal(forwardV02SourceManifestReferenceDigest(manifest()) !== null, true);
});


const strictCheck = (c: unknown, r: unknown) =>
  assessForwardV02ReferenceReconciliationStrictNodeIngress(c, r);

test("strict Node reconciliation preserves valid untrusted and mismatched digest semantics", () => {
  assert.deepEqual(strictCheck(candidate(), refs()), check(candidate(), refs()));
  const bad = candidate(); bad.metricFormulaDigest = h("e");
  assert.deepEqual(strictCheck(bad, refs()).blockers, ["FORMULA_REFERENCE_MISMATCH"]);
  assert.equal(strictCheck(candidate(), refs()).scoringAuthorized, false);
});

test("strict Node reconciliation rejects candidate root Proxy before its repair trap", () => {
  const c = candidate(), r = refs();
  c.metricFormulaDigest = h("e");
  let traps = 0;
  const wrapped = new Proxy(c, {
    getOwnPropertyDescriptor(target, key) {
      traps++;
      if (key === "scoringAuthorized") target.metricFormulaDigest = r.formulaDigest;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.deepEqual(strictCheck(wrapped, r).blockers, ["INVALID_V02_CANDIDATE"]);
  assert.equal(traps, 0);
  assert.equal(c.metricFormulaDigest, h("e"));
});

test("strict Node reconciliation rejects nested candidate Proxy before repairing references", () => {
  const c = candidate(), r = refs();
  r.expectedAnalysisSnapshotDigest = h("e");
  let traps = 0;
  c.moneyPolicy = new Proxy(c.moneyPolicy, {
    getOwnPropertyDescriptor(target, key) {
      traps++;
      if (key === "zeroDenominator") r.expectedAnalysisSnapshotDigest = h("a");
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.deepEqual(strictCheck(c, r).blockers, ["INVALID_V02_CANDIDATE"]);
  assert.equal(traps, 0);
  assert.equal(r.expectedAnalysisSnapshotDigest, h("e"));
});

test("strict Node reconciliation rejects reference root Proxy before repairing candidate", () => {
  const c = candidate(), r = refs(), expected = c.metricFormulaDigest;
  c.metricFormulaDigest = h("e");
  let traps = 0;
  const wrapped = new Proxy(r, {
    ownKeys(target) {
      traps++;
      c.metricFormulaDigest = expected;
      return Reflect.ownKeys(target);
    },
  });
  assert.deepEqual(strictCheck(c, wrapped).blockers, ["INVALID_REFERENCE_SHAPE"]);
  assert.equal(traps, 0);
  assert.equal(c.metricFormulaDigest, h("e"));
});

test("strict Node reconciliation rejects nested manifest Proxy before repairing earlier candidate", () => {
  const c = candidate(), r = refs(), expected = c.metricFormulaDigest;
  c.metricFormulaDigest = h("e");
  let traps = 0;
  r.sourceManifest = new Proxy(r.sourceManifest, {
    getOwnPropertyDescriptor(target, key) {
      traps++;
      if (key === "productionConnection") c.metricFormulaDigest = expected;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.deepEqual(strictCheck(c, r).blockers, ["INVALID_REFERENCE_SHAPE"]);
  assert.equal(traps, 0);
  assert.equal(c.metricFormulaDigest, h("e"));
});

test("strict Node reconciliation rejects revoked Proxies and accessors without invocation", () => {
  const revokedCandidate = Proxy.revocable(candidate(), {});
  revokedCandidate.revoke();
  assert.deepEqual(strictCheck(revokedCandidate.proxy, refs()).blockers, ["INVALID_V02_CANDIDATE"]);
  const revokedRefs = Proxy.revocable(refs(), {});
  revokedRefs.revoke();
  assert.deepEqual(strictCheck(candidate(), revokedRefs.proxy).blockers, ["INVALID_REFERENCE_SHAPE"]);
  const r = refs();
  let getterCalls = 0;
  Object.defineProperty(r.sourceManifest, "manifestId", {
    enumerable: true, get() { getterCalls++; return "synthetic-manifest"; },
  });
  assert.deepEqual(strictCheck(candidate(), r).blockers, ["INVALID_REFERENCE_SHAPE"]);
  assert.equal(getterCalls, 0);
});

test("reference reconciliation assessments are immutable on both denied and unverified paths", () => {
  const good = check(candidate(), refs());
  const badCandidate = candidate();
  badCandidate.scoringAuthorized = true;
  const denied = check(badCandidate, refs());
  for (const result of [good, denied]) {
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.blockers), true);
    assert.equal(result.scoringAuthorized, false);
    assert.throws(() => {
      (result as unknown as { scoringAuthorized: boolean }).scoringAuthorized = true;
    }, TypeError);
    assert.throws(() => {
      (result.blockers as unknown as string[]).push("FAKE_AUTHORITY");
    }, TypeError);
    assert.equal(result.scoringAuthorized, false);
  }
  assert.equal(good.referencesReconciled, true);
  assert.equal(denied.referencesReconciled, false);
});

test("source manifest digest rejects malformed UTF-16 identifier aliases before UTF-8 hashing", () => {
  const unchanged = forwardV02SourceManifestReferenceDigest(manifest());
  assert.equal(unchanged, "0015145a50f9a860b211a324cfa2c165465bd924b64b36a321ecb15a5f0bce59");

  const replacement = manifest();
  replacement.manifestId = "synthetic-\uFFFD-manifest";
  const replacementDigest = forwardV02SourceManifestReferenceDigest(replacement);
  assert.equal(typeof replacementDigest, "string");

  for (const malformed of ["synthetic-\uD800-manifest", "synthetic-\uDC00-manifest"]) {
    // Node encodes both malformed strings exactly like the replacement form;
    // the reference must not assign any content digest to either one.
    assert.equal(Buffer.from(malformed, "utf8").equals(Buffer.from(replacement.manifestId, "utf8")), true);
    const invalid = manifest();
    invalid.manifestId = malformed;
    assert.equal(forwardV02SourceManifestReferenceDigest(invalid), null);
  }

  const validPair = manifest();
  validPair.manifestId = "synthetic-\uD83D\uDE80-manifest";
  const validPairDigest = forwardV02SourceManifestReferenceDigest(validPair);
  assert.equal(typeof validPairDigest, "string");
  assert.notEqual(validPairDigest, replacementDigest);
  assert.equal(forwardV02SourceManifestReferenceDigest(manifest()), unchanged);
});

test("source manifest digest preserves decision and outcome identity under inherited numeric setters", () => {
  const original = manifest();
  const changedDecision = manifest();
  changedDecision.decisionDigests[0] = h("e");
  const changedOutcome = manifest();
  changedOutcome.outcomeDigests[0] = h("f");
  const digest = forwardV02SourceManifestReferenceDigest;
  const baseline = [digest(original), digest(changedDecision), digest(changedOutcome)];
  assert.ok(baseline.every((value) => typeof value === "string"));
  assert.equal(new Set(baseline).size, 3);

  // Seven literal fields precede the appended decision digests; the first
  // outcome digest follows two decisions and its length marker (index 10).
  for (const index of [7, 10]) {
    const key = String(index);
    const prior = Object.getOwnPropertyDescriptor(Array.prototype, key);
    let setterCalls = 0;
    let observed: Array<string | null> = [];
    try {
      Object.defineProperty(Array.prototype, key, {
        configurable: true,
        set(_value: unknown) { setterCalls++; },
      });
      observed = [digest(original), digest(changedDecision), digest(changedOutcome)];
    } finally {
      if (prior) Object.defineProperty(Array.prototype, key, prior);
      else Reflect.deleteProperty(Array.prototype, key);
    }
    assert.deepEqual(observed, baseline);
    assert.equal(setterCalls, 0, "all appended manifest digest fields must be own data properties");
  }
});
