import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FableOpportunityRenderer } from "./fableOpportunityRenderer";
import { sampleOpportunity, sampleWarningsCount } from "./fableOpportunitySample";
import { RISK_COLOR } from "../../presentation/tokens/themeTokens";
import type { OpportunityPresentation } from "../../presentation/presentationModel";

const rendererSourcePath = join(dirname(fileURLToPath(import.meta.url)), "fableOpportunityRenderer.ts");

test("rendererはdomain/view-models/server/scriptsを一切importしていない（presentation型以外に依存しない）", () => {
  const source = readFileSync(rendererSourcePath, "utf8");
  const importSpecifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(importSpecifiers.length > 0, "no imports found; test itself may be broken");

  for (const spec of importSpecifiers) {
    if (!spec.startsWith(".")) continue; // node組み込み等は対象外
    assert.ok(!spec.includes("/domain/"), `must not import src/domain: ${spec}`);
    assert.ok(!spec.includes("view-models"), `must not import src/view-models: ${spec}`);
    assert.ok(!spec.includes("server/"), `must not import server/: ${spec}`);
    assert.ok(!spec.includes("scripts/"), `must not import scripts/: ${spec}`);
    assert.ok(
      spec.includes("/presentation/") || spec.endsWith("presentationModel") || spec.endsWith("presentationRenderer"),
      `unexpected relative import outside src/presentation: ${spec}`,
    );
  }
});

test("scoreLabelは再計算されず入力の値がそのまま使われる", () => {
  const renderer = new FableOpportunityRenderer();
  const view = renderer.renderOpportunity(sampleOpportunity);
  assert.equal(view.scoreLabel, sampleOpportunity.scoreLabel);
  assert.equal(view.score, sampleOpportunity.score);
  assert.equal(view.summary, sampleOpportunity.summary);
});

test("riskLevelは再判定されず入力の値がそのまま反映される", () => {
  const renderer = new FableOpportunityRenderer();

  const lowRiskButLowScore: OpportunityPresentation = { ...sampleOpportunity, riskLevel: "low", score: 0 };
  const highRiskButHighScore: OpportunityPresentation = { ...sampleOpportunity, riskLevel: "high", score: 5 };

  // scoreとriskLevelの整合性チェック・再判定は一切行わない。渡された値をそのまま通す。
  assert.equal(renderer.renderOpportunity(lowRiskButLowScore).riskLevel, "low");
  assert.equal(renderer.renderOpportunity(lowRiskButLowScore).riskColor, RISK_COLOR.low);
  assert.equal(renderer.renderOpportunity(highRiskButHighScore).riskLevel, "high");
  assert.equal(renderer.renderOpportunity(highRiskButHighScore).riskColor, RISK_COLOR.high);
});

test("warnings countは表示データとしてそのまま扱われる（分類・再集計しない）", () => {
  const renderer = new FableOpportunityRenderer();
  assert.equal(renderer.renderOpportunity(sampleOpportunity, sampleWarningsCount).warningsCount, sampleWarningsCount);
  assert.equal(renderer.renderOpportunity(sampleOpportunity, 0).warningsCount, 0);
  assert.equal(renderer.renderOpportunity(sampleOpportunity, 999).warningsCount, 999);
});

test("warnings count省略時は0", () => {
  const renderer = new FableOpportunityRenderer();
  assert.equal(renderer.renderOpportunity(sampleOpportunity).warningsCount, 0);
});

test("Opportunity以外のrenderメソッドはPoC対象外として明示的にエラーになる", () => {
  const renderer = new FableOpportunityRenderer();
  assert.throws(() => renderer.renderRuleCard(), /not implemented/);
  assert.throws(() => renderer.renderWarning(), /not implemented/);
  assert.throws(() => renderer.renderLifecycle(), /not implemented/);
  assert.throws(() => renderer.renderResearchSummary(), /not implemented/);
});
