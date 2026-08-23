import assert from "node:assert/strict";
import test from "node:test";
import { applyRuleTransition, createResearchRule } from "./researchRuleStore";
import type { ResearchRule } from "./researchRule";

function expectTransitionRejected(rule: ResearchRule, pattern: RegExp): void {
  const result = applyRuleTransition([rule], rule.ruleId, "backtest", undefined, "2026-02-01T00:00:00Z");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.reason, pattern);
  assert.equal(rule.status, "candidate");
}

test("applyRuleTransitionはpersist済みblank reasonSummaryを次statusへ進めない", () => {
  expectTransitionRejected(
    { ...createResearchRule("rule-1", "reason", "2026-01-01T00:00:00Z"), reasonSummary: "   " },
    /persisted rule reasonSummary.*non-blank/,
  );
});

test("applyRuleTransitionはpersist済みwarnings/title shape破損を次statusへ進めない", () => {
  expectTransitionRejected(
    {
      ...createResearchRule("rule-1", "reason", "2026-01-01T00:00:00Z"),
      warnings: ["ok", 123] as unknown as string[],
    },
    /persisted rule warnings.*array of strings/,
  );

  expectTransitionRejected(
    { ...createResearchRule("rule-2", "reason", "2026-01-01T00:00:00Z"), title: "   " },
    /persisted rule title.*non-blank/,
  );
});

test("applyRuleTransitionはpersist済みpadded ruleIdを直接指定されても進めない", () => {
  const rule = createResearchRule(" rule-1 ", "reason", "2026-01-01T00:00:00Z");
  expectTransitionRejected(rule, /persisted rule ruleId.*non-blank, trimmed/);
});

test("applyRuleTransitionはcanonical persisted recordを引き続き遷移できる", () => {
  const rule = createResearchRule("rule-1", "reason", "2026-01-01T00:00:00Z", "title");
  const result = applyRuleTransition([rule], "rule-1", "backtest", undefined, "2026-02-01T00:00:00Z");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rules[0].status, "backtest");
});
