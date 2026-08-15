import assert from "node:assert/strict";
import test from "node:test";
import { buildBuyLearningSummary } from "./buyLearningSummary";
import { mergeBuyTailLearning, validateBuyTailPublicSignal } from "./buyTailLearningMerge";

function baseSummary() {
  return buildBuyLearningSummary({
    generatedAt: "2026-08-15T12:00:00.000Z",
    totalDecisions: 58,
    settled: 58,
    hits: 2,
    payoutOddsSum: 68.24,
    maxPayoutOdds: 40,
    avgEstimatedHitRate: 0.03,
    recentSettled: 30,
    recentHits: 1,
    recentPayoutOddsSum: 40.3,
    smallSampleMisses: 0,
    highConfidenceMisses: 0,
    highEvMisses: 10,
  });
}

function tail(status: "INSUFFICIENT_SUPPORT" | "PERSISTENT_TAIL_DEPENDENCE" | "RECENT_TAIL_DEPENDENCE" | "PRIOR_TAIL_DEPENDENCE" | "NO_TAIL_DEPENDENCE_SIGNAL", priorSettled = 30) {
  const recentDependent = status === "PERSISTENT_TAIL_DEPENDENCE" || status === "RECENT_TAIL_DEPENDENCE" || status === "INSUFFICIENT_SUPPORT";
  const priorDependent = status === "PERSISTENT_TAIL_DEPENDENCE" || status === "PRIOR_TAIL_DEPENDENCE";
  return {
    schemaVersion: "buy-tail-dependence-public-v1",
    generatedAt: "2026-08-15T12:00:00.000Z",
    status,
    windowSize: 30,
    minimumTailGap: 0.15,
    totalSettled: 30 + priorSettled,
    support: { recentSettled: 30, priorSettled, missingSettledToCompare: Math.max(0, 30 - priorSettled) },
    recent: { settled: 30, hits: 1, roi: 1.34, roiExMax: recentDependent ? 0 : 1.25, tailGap: recentDependent ? 1.34 : 0.09, tailDependent: recentDependent },
    prior: { settled: priorSettled, hits: 1, roi: 1.1, roiExMax: priorDependent ? 0 : 1.02, tailGap: priorDependent ? 1.1 : 0.08, tailDependent: priorDependent && priorSettled === 30 },
    productionChangeAllowed: false,
  } as const;
}

test("insufficient 58-BUY support is a strict no-op for learning promotion", () => {
  const summary = baseSummary();
  const merged = mergeBuyTailLearning(summary, tail("INSUFFICIENT_SUPPORT", 28));
  assert.deepEqual(merged, summary);
  assert.equal(merged.learnings.some((item) => item.id.startsWith("TAIL_DEPENDENCE_")), false);
});

test("persistent dependence promotes only a governed research learning after two full windows", () => {
  const merged = mergeBuyTailLearning(baseSummary(), tail("PERSISTENT_TAIL_DEPENDENCE"));
  const learning = merged.learnings.find((item) => item.id === "TAIL_DEPENDENCE_PERSISTS");
  assert.equal(learning?.evidenceCount, 60);
  assert.equal(learning?.severity, "ACTION");
  const candidate = merged.researchCandidates.find((item) => item.id === "RESEARCH-TAIL-DEPENDENCE");
  assert.match(candidate?.reason ?? "", /非重複30 BUY×2 window/u);
  assert.equal(candidate?.productionChangeAllowed, false);
});

test("recent-only dependence creates a regime-shift research candidate without production permission", () => {
  const merged = mergeBuyTailLearning(baseSummary(), tail("RECENT_TAIL_DEPENDENCE"));
  assert.ok(merged.learnings.some((item) => item.id === "TAIL_DEPENDENCE_RECENT_ONLY"));
  assert.ok(merged.researchCandidates.some((item) => item.id === "RESEARCH-TAIL-REGIME-SHIFT" && item.productionChangeAllowed === false));
});

test("tail public signal validation fails closed on private fields or inconsistent support", () => {
  const privateLeak = { ...tail("PERSISTENT_TAIL_DEPENDENCE"), selection: "1-2-3" };
  assert.throws(() => validateBuyTailPublicSignal(privateLeak), /unknown key|private BUY tail/u);

  const mismatch = tail("PERSISTENT_TAIL_DEPENDENCE");
  assert.throws(() => validateBuyTailPublicSignal({
    ...mismatch,
    support: { ...mismatch.support, priorSettled: 29, missingSettledToCompare: 1 },
  }), /support\/window mismatch|support\/status mismatch/u);
});
