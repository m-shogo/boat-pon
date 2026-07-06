import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FableLifecycleRenderer } from "./fableLifecycleRenderer";
import { sampleLifecycle } from "./fableLifecycleSample";
import { FableOpportunityRenderer } from "./fableOpportunityRenderer";
import { sampleOpportunity } from "./fableOpportunitySample";
import type { LifecyclePresentation } from "../../presentation/presentationModel";

const rendererSourcePath = join(dirname(fileURLToPath(import.meta.url)), "fableLifecycleRenderer.ts");

test("rendererはdomain/view-models/server/scripts/researchRuleStoreを一切importしていない（presentation型以外に依存しない）", () => {
  const source = readFileSync(rendererSourcePath, "utf8");
  const importSpecifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(importSpecifiers.length > 0, "no imports found; test itself may be broken");

  for (const spec of importSpecifiers) {
    if (!spec.startsWith(".")) continue; // node組み込み等は対象外
    assert.ok(!spec.includes("/domain/"), `must not import src/domain: ${spec}`);
    assert.ok(!spec.includes("researchRuleStore"), `must not import researchRuleStore: ${spec}`);
    assert.ok(!spec.includes("view-models"), `must not import src/view-models: ${spec}`);
    assert.ok(!spec.includes("server/"), `must not import server/: ${spec}`);
    assert.ok(!spec.includes("scripts/"), `must not import scripts/: ${spec}`);
    assert.ok(
      spec.includes("/presentation/") || spec.endsWith("presentationModel") || spec.endsWith("presentationRenderer"),
      `unexpected relative import outside src/presentation: ${spec}`,
    );
  }
});

test("stepsは順序を保ったまま出力される", () => {
  const renderer = new FableLifecycleRenderer();
  const view = renderer.renderLifecycle(sampleLifecycle);
  assert.deepEqual(
    view.steps.map((step) => step.id),
    sampleLifecycle.steps.map((step) => step.id),
  );
  assert.equal(view.steps.length, sampleLifecycle.steps.length);
});

test("isCompleted/isCurrentは再計算されず入力の値がそのまま反映される", () => {
  const renderer = new FableLifecycleRenderer();

  // 意図的に矛盾したfixture（reviewが完了扱いなのにcandidateもcurrent扱い）を渡しても、
  // rendererは整合性を検証・再計算せずそのまま通す。
  const inconsistent: LifecyclePresentation = {
    steps: [
      { id: "candidate", label: "Candidate", isCompleted: false, isCurrent: true },
      { id: "backtest", label: "Backtest", isCompleted: false, isCurrent: false },
      { id: "forward", label: "Forward Test", isCompleted: false, isCurrent: false },
      { id: "review", label: "Review", isCompleted: true, isCurrent: true },
      { id: "approved", label: "Approved", isCompleted: false, isCurrent: false },
      { id: "production", label: "Production", isCompleted: false, isCurrent: false },
    ],
    currentStepId: "candidate",
  };

  const view = renderer.renderLifecycle(inconsistent);
  for (let i = 0; i < inconsistent.steps.length; i++) {
    assert.equal(view.steps[i].isCompleted, inconsistent.steps[i].isCompleted);
    assert.equal(view.steps[i].isCurrent, inconsistent.steps[i].isCurrent);
  }
});

test("currentStepIdはそのまま使われる（再判定・再計算しない）", () => {
  const renderer = new FableLifecycleRenderer();
  assert.equal(renderer.renderLifecycle(sampleLifecycle).currentStepId, sampleLifecycle.currentStepId);

  const nullCurrent: LifecyclePresentation = { steps: sampleLifecycle.steps, currentStepId: null };
  assert.equal(renderer.renderLifecycle(nullCurrent).currentStepId, null);

  const mismatched: LifecyclePresentation = { steps: sampleLifecycle.steps, currentStepId: "production" };
  // どのstepもisCurrent=trueでなくても、currentStepIdは検証せずそのまま反映する。
  assert.equal(renderer.renderLifecycle(mismatched).currentStepId, "production");
});

test("Lifecycle以外のrenderメソッドはPoC対象外として明示的にエラーになる", () => {
  const renderer = new FableLifecycleRenderer();
  assert.throws(() => renderer.renderRuleCard(), /not implemented/);
  assert.throws(() => renderer.renderOpportunity(), /not implemented/);
  assert.throws(() => renderer.renderWarning(), /not implemented/);
  assert.throws(() => renderer.renderResearchSummary(), /not implemented/);
});

test("Opportunity PoCを壊していない", () => {
  const renderer = new FableOpportunityRenderer();
  const view = renderer.renderOpportunity(sampleOpportunity);
  assert.equal(view.scoreLabel, sampleOpportunity.scoreLabel);
  assert.throws(() => renderer.renderLifecycle(), /not implemented/);
});
