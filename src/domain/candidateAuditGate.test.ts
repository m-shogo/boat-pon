import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCandidateAuditGate } from "./candidateAuditGate";

test("買い目別オッズと保存top1が完全一致すれば通過する", () => {
  assert.deepEqual(evaluateCandidateAuditGate({
    candidateRows: 120,
    attachedOddsMismatchRows: 0,
    persistedComparableRaces: 1,
    selectionMatches: 1,
  }), { passed: true, reasons: [] });
});

test("オッズ上書きと保存top1不一致を停止理由にする", () => {
  const result = evaluateCandidateAuditGate({
    candidateRows: 120,
    attachedOddsMismatchRows: 119,
    persistedComparableRaces: 1,
    selectionMatches: 0,
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.reasons, ["買い目別オッズ不一致が119件", "保存top1一致が0/1"]);
});

test("候補0件を正常扱いしない", () => {
  assert.equal(evaluateCandidateAuditGate({
    candidateRows: 0,
    attachedOddsMismatchRows: 0,
    persistedComparableRaces: 0,
    selectionMatches: 0,
  }).passed, false);
});
