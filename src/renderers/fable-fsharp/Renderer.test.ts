import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderHypothesisBoard, renderLiveCandidateHealth, renderOpportunity } from "./generated/Renderer.js";

test("Real Fable rendererはOpportunityの計算済み値を変更しない", () => {
  const input = { score: 2, scoreLabel: "★★☆☆☆", riskLevel: "high", summary: "要検証" };
  const result = renderOpportunity(input, 4);
  assert.equal(result.score, input.score);
  assert.equal(result.scoreLabel, input.scoreLabel);
  assert.equal(result.riskLevel, input.riskLevel);
  assert.equal(result.summary, input.summary);
  assert.equal(result.warningsCount, 4);
});

test("Real Fable rendererは仮説のゲートと採用可否を再判定しない", () => {
  const gateStatus = { top2ExcludeRoiOk: false, recent3mOk: null };
  const board = renderHypothesisBoard({
    hypotheses: [
      {
        id: "H002", name: "second", description: "", status: "monitor", priority: 2,
        adoptionAllowed: false, adoptionBlockReason: "blocked", nextAction: "wait", gateStatus,
        lastKnownMetrics: {}, dataReadiness: {}, requiredData: [], nextReviewTrigger: "n>=30",
      },
      {
        id: "H001", name: "first", description: "", status: "testing-historical", priority: 1,
        adoptionAllowed: false, adoptionBlockReason: "blocked", nextAction: "wait", gateStatus,
        lastKnownMetrics: {}, dataReadiness: {}, requiredData: [], nextReviewTrigger: "n>=30",
      },
    ],
  });
  assert.deepEqual(board.cards.map((card) => card.id), ["H001", "H002"]);
  assert.strictEqual(board.cards[0].gateStatus, gateStatus);
  assert.equal(board.cards[0].adoptionAllowed, false);
  assert.equal(board.summary.adoptionAllowed, 0);
  assert.equal(board.summary.blocked, 2);
});

test("F# rendererの依存境界にdomain/server/scripts/DBが入らない", () => {
  const source = readFileSync(new URL("./Renderer.fs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /src[/.](domain|view-models)|server[/.]|scripts[/.]|Database|SQLite/i);
});

test("Real Fable rendererは候補多重度を表示用監査値として可視化する", () => {
  const result = renderLiveCandidateHealth({ candidateRows: 120, racePrograms: 1 });
  assert.equal(result.rowsPerRace, 120);
  assert.equal(result.hasMultiplicity, true);
  assert.equal(result.tone, "attention");
});

test("Real Fable rendererは終了済み棄却と凍結を棄却枠へ分類する", () => {
  const base = {
    name: "", description: "", priority: 1, adoptionAllowed: false,
    adoptionBlockReason: "blocked", nextAction: "", gateStatus: {}, lastKnownMetrics: {},
    dataReadiness: {}, requiredData: [], nextReviewTrigger: "",
  };
  const board = renderHypothesisBoard({
    hypotheses: [
      { ...base, id: "H011", status: "closed-rejected" },
      { ...base, id: "H012", status: "frozen" },
    ],
  });
  assert.equal(board.summary.rejected, 2);
  assert.deepEqual(board.cards.map((card) => card.tone), ["muted", "muted"]);
});
