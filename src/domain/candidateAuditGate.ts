export type CandidateAuditGateInput = {
  candidateRows: number;
  attachedOddsMismatchRows: number;
  persistedComparableRaces: number;
  selectionMatches: number;
};

export type CandidateAuditGate = {
  passed: boolean;
  reasons: string[];
};

/** productionへ接続せず、候補と買い目別オッズの整合性だけを判定する。 */
export function evaluateCandidateAuditGate(input: CandidateAuditGateInput): CandidateAuditGate {
  const reasons: string[] = [];
  if (input.candidateRows === 0) reasons.push("候補行が0件");
  if (input.attachedOddsMismatchRows > 0) {
    reasons.push(`買い目別オッズ不一致が${input.attachedOddsMismatchRows}件`);
  }
  if (input.persistedComparableRaces > 0 && input.selectionMatches !== input.persistedComparableRaces) {
    reasons.push(`保存top1一致が${input.selectionMatches}/${input.persistedComparableRaces}`);
  }
  return { passed: reasons.length === 0, reasons };
}
