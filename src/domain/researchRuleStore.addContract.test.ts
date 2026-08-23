import assert from "node:assert/strict";
import test from "node:test";
import { addRule, createResearchRule } from "./researchRuleStore";
import type { ResearchRule } from "./researchRule";

function expectRejected(rule: ResearchRule, pattern: RegExp): void {
  const result = addRule([], rule);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.reason, pattern);
}

test("addRuleはblank/padded ruleIdをstore boundaryで拒否する", () => {
  expectRejected(createResearchRule("", "reason", "2026-01-01T00:00:00Z"), /ruleId.*non-blank, trimmed/);
  expectRejected(createResearchRule(" rule-1 ", "reason", "2026-01-01T00:00:00Z"), /ruleId.*non-blank, trimmed/);
});

test("addRuleはblank reasonSummaryをstore boundaryで拒否する", () => {
  expectRejected(createResearchRule("rule-1", "   ", "2026-01-01T00:00:00Z"), /reasonSummary.*non-blank/);
});

test("addRuleはruntimeで壊れたwarnings/title shapeを拒否する", () => {
  const invalidWarnings = {
    ...createResearchRule("rule-1", "reason", "2026-01-01T00:00:00Z"),
    warnings: ["ok", 123] as unknown as string[],
  };
  expectRejected(invalidWarnings, /warnings.*array of strings/);

  const invalidTitle = {
    ...createResearchRule("rule-2", "reason", "2026-01-01T00:00:00Z"),
    title: "   ",
  };
  expectRejected(invalidTitle, /title.*non-blank/);
});

test("addRuleはcanonical candidate identityを引き続き受理する", () => {
  const result = addRule([], createResearchRule("rule-1", "reason", "2026-01-01T00:00:00Z", "title"));
  assert.equal(result.ok, true);
});
