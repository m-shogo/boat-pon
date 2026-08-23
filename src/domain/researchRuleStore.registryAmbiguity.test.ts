import assert from "node:assert/strict";
import test from "node:test";
import { addRule, applyRuleTransition, createResearchRule } from "./researchRuleStore";

test("addRuleは既存registry内の別ruleId重複を無視して新規ruleを追加しない", () => {
  const first = createResearchRule("existing-rule", "first", "2026-01-01T00:00:00Z");
  const duplicate = createResearchRule("existing-rule", "duplicate", "2026-01-02T00:00:00Z");
  const newRule = createResearchRule("new-rule", "new", "2026-01-03T00:00:00Z");
  const rules = [first, duplicate];

  const result = addRule(rules, newRule);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.ruleId, "existing-rule");
  assert.match(result.error.reason, /duplicate ruleId.*registry identity is ambiguous/);
  assert.equal(rules.length, 2);
  assert.equal(rules.some((rule) => rule.ruleId === "new-rule"), false);
});

test("addRuleはidentityが一意なregistryへの新規candidate追加を維持する", () => {
  const existing = createResearchRule("existing-rule", "existing", "2026-01-01T00:00:00Z");
  const newRule = createResearchRule("new-rule", "new", "2026-01-02T00:00:00Z");

  const result = addRule([existing], newRule);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.rules.map((rule) => rule.ruleId), ["existing-rule", "new-rule"]);
});

test("applyRuleTransitionは別ruleIdが重複したregistryを更新して再保存しない", () => {
  const target = createResearchRule("target-rule", "target", "2026-01-01T00:00:00Z");
  const duplicateA = createResearchRule("duplicate-rule", "first", "2026-01-02T00:00:00Z");
  const duplicateB = createResearchRule("duplicate-rule", "second", "2026-01-03T00:00:00Z");
  const rules = [target, duplicateA, duplicateB];

  const result = applyRuleTransition(
    rules,
    "target-rule",
    "backtest",
    undefined,
    "2026-02-01T00:00:00Z",
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.ruleId, "duplicate-rule");
  assert.match(result.error.reason, /duplicate ruleId.*registry identity is ambiguous/);
  assert.equal(target.status, "candidate");
});