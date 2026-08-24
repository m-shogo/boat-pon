import assert from "node:assert/strict";
import test from "node:test";
import { addRule, applyRuleTransition, createResearchRule } from "./researchRuleStore";
import type { ResearchRule } from "./researchRule";

function canonical(id: string, date: string): ResearchRule {
  return createResearchRule(id, "reason", `${date}T00:00:00Z`);
}

test("addRule blocks append when an unrelated persisted rule has invalid lifecycle evidence", () => {
  const malformed = {
    ...canonical("broken-rule", "2026-01-02"),
    updatedAt: "2026-01-01T00:00:00Z",
  };
  const result = addRule(
    [malformed],
    canonical("new-rule", "2026-01-03"),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.ruleId, "broken-rule");
  assert.match(result.error.reason, /persisted rule updatedAt precedes createdAt/u);
});

test("applyRuleTransition blocks a valid target when another persisted rule has an invalid runtime status", () => {
  const target = canonical("target-rule", "2026-01-01");
  const malformed = {
    ...canonical("broken-rule", "2026-01-02"),
    status: "promoted" as unknown as ResearchRule["status"],
  };
  const result = applyRuleTransition(
    [target, malformed],
    "target-rule",
    "backtest",
    undefined,
    "2026-02-01T00:00:00Z",
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.ruleId, "broken-rule");
  assert.match(result.error.reason, /persisted rule status.*invalid/u);
  assert.equal(target.status, "candidate");
});

test("applyRuleTransition blocks a valid target when another persisted rule has non-canonical timestamps", () => {
  const target = canonical("target-rule", "2026-01-01");
  const malformed = {
    ...canonical("broken-rule", "2026-01-02"),
    updatedAt: "2026-01-02 00:00:00",
  };
  const result = applyRuleTransition(
    [target, malformed],
    "target-rule",
    "backtest",
    undefined,
    "2026-02-01T00:00:00Z",
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.ruleId, "broken-rule");
  assert.match(result.error.reason, /persisted rule lifecycle timestamps must be canonical/u);
  assert.equal(target.status, "candidate");
});

test("canonical persisted registry remains mutable", () => {
  const target = canonical("target-rule", "2026-01-01");
  const other = canonical("other-rule", "2026-01-02");

  const added = addRule(
    [target, other],
    canonical("new-rule", "2026-01-03"),
  );
  assert.equal(added.ok, true);

  const transitioned = applyRuleTransition(
    [target, other],
    "target-rule",
    "backtest",
    undefined,
    "2026-02-01T00:00:00Z",
  );
  assert.equal(transitioned.ok, true);
  if (!transitioned.ok) return;
  assert.equal(transitioned.rules[0].status, "backtest");
});
