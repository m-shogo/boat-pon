import assert from "node:assert/strict";
import test from "node:test";
import {
  addRule,
  applyRuleTransition,
  createResearchRule,
  findRule,
} from "./researchRuleStore";
import { MIN_PRODUCTION_CONFIDENCE, MIN_PRODUCTION_SAMPLE_SIZE } from "./researchRuleLifecycle";
import type { ForwardTestResult } from "./researchRule";

function forwardResult(overrides: Partial<ForwardTestResult> = {}): ForwardTestResult {
  return {
    ruleId: "rule-1",
    metadata: {
      dataWindowStart: "2026-01-01",
      dataWindowEnd: "2026-06-01",
      evaluationRunAt: "2026-06-02T00:00:00+09:00",
      sampleSize: MIN_PRODUCTION_SAMPLE_SIZE,
    },
    hitRate: 0.3,
    roi: 1.1,
    confidence: MIN_PRODUCTION_CONFIDENCE,
    maxDrawdown: 0.2,
    isForwardTested: true,
    isProductionEligible: true,
    reasonSummary: "forward test passed",
    warnings: [],
    ...overrides,
  };
}

test("createResearchRuleは常にcandidateから始まる", () => {
  const rule = createResearchRule("rule-1", "test hypothesis", "2026-01-01T00:00:00Z");
  assert.equal(rule.status, "candidate");
  assert.equal(rule.ruleId, "rule-1");
  assert.equal(rule.createdAt, "2026-01-01T00:00:00Z");
  assert.equal(rule.updatedAt, "2026-01-01T00:00:00Z");
  assert.deepEqual(rule.warnings, []);
});

test("addRuleは同じruleIdの重複登録を拒否する", () => {
  const rule = createResearchRule("rule-1", "x");
  const first = addRule([], rule);
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = addRule(first.rules, createResearchRule("rule-1", "y"));
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.match(second.error.reason, /already exists/);
});

test("applyRuleTransitionは未登録ruleIdを拒否する", () => {
  const result = applyRuleTransition([], "no-such-rule", "backtest");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.reason, /not found/);
});

test("CandidateからProductionへ直接遷移できない", () => {
  const rule = createResearchRule("rule-1", "x");
  const result = applyRuleTransition([rule], "rule-1", "production", forwardResult());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.reason, /cannot transition/);
});

test("Approvedでもevaluationが無ければProductionへ遷移できない", () => {
  const rule = { ...createResearchRule("rule-1", "x"), status: "approved" as const };
  const result = applyRuleTransition([rule], "rule-1", "production");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.reason, /requires a forward-tested evaluation/);
});

test("Approved かつ Forward未通過evaluationならProductionへ遷移できない", () => {
  const rule = { ...createResearchRule("rule-1", "x"), status: "approved" as const };
  const evaluation = { ...forwardResult(), isForwardTested: false as unknown as true };
  const result = applyRuleTransition([rule], "rule-1", "production", evaluation);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.reason, /not production eligible/);
});

test("Approved かつ sampleSize不足ならProductionへ遷移できない", () => {
  const rule = { ...createResearchRule("rule-1", "x"), status: "approved" as const };
  const evaluation = forwardResult({ metadata: { ...forwardResult().metadata, sampleSize: 10 } });
  const result = applyRuleTransition([rule], "rule-1", "production", evaluation);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.reason, /not production eligible/);
});

test("Approved かつ Forward通過・sampleSize/confidence十分ならProductionへ遷移できる", () => {
  const rule = { ...createResearchRule("rule-1", "x"), status: "approved" as const };
  const result = applyRuleTransition([rule], "rule-1", "production", forwardResult(), "2026-07-01T00:00:00Z");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const updated = findRule(result.rules, "rule-1");
  assert.equal(updated?.status, "production");
  assert.equal(updated?.updatedAt, "2026-07-01T00:00:00Z");
});

test("正常な段階を1つずつ踏めば最終的にProductionへ到達できる", () => {
  let rules = [createResearchRule("rule-1", "x")];
  for (const to of ["backtest", "forward", "review", "approved"] as const) {
    const result = applyRuleTransition(rules, "rule-1", to);
    assert.equal(result.ok, true, `failed to transition to ${to}`);
    if (result.ok) rules = result.rules;
  }
  const final = applyRuleTransition(rules, "rule-1", "production", forwardResult());
  assert.equal(final.ok, true);
});

test("Archivedにしたルールはどこにも遷移できない（削除ではなく保持）", () => {
  const rule = { ...createResearchRule("rule-1", "x"), status: "deprecated" as const };
  const archived = applyRuleTransition([rule], "rule-1", "archived");
  assert.equal(archived.ok, true);
  if (!archived.ok) return;

  const attempt = applyRuleTransition(archived.rules, "rule-1", "candidate");
  assert.equal(attempt.ok, false);
});
