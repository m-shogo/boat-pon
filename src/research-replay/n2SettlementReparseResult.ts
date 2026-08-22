export type N2SettlementReparseResult = "REPARSED" | "REPARSED_WITH_FLAGS";

type ReparseResultInput = {
  counts: {
    parse_errors: number;
    ambiguous_active: number;
    ambiguous_non_defect: number;
    unexpected_addition: number;
  };
  lightIntegrity: Record<string, number>;
  appendOnlyEnforcement: {
    updateBlocked: boolean;
    deleteBlocked: boolean;
  };
  secondRun: { appended: number; supersessions: number } | null;
  afterConsistent: boolean | null;
  fullIntegrity: Record<string, unknown> | null;
  ambiguousActiveKeys: number;
};

function fullIntegrityIsClean(full: Record<string, unknown> | null): boolean {
  if (full === null) return true;
  return full.integrityCheck === "ok"
    && full.foreignKeyViolations === 0
    && full.orphanPayoutLines === 0
    && full.orphanRefundLines === 0
    && full.ambiguousActiveKeys === 0;
}

export function resolveN2SettlementReparseResult(input: ReparseResultInput): N2SettlementReparseResult {
  const clean = input.counts.parse_errors === 0
    && input.counts.ambiguous_active === 0
    && input.counts.ambiguous_non_defect === 0
    && input.counts.unexpected_addition === 0
    && input.lightIntegrity.multipleActiveSuccessors === 0
    && input.lightIntegrity.selfSupersedingCycles === 0
    && input.lightIntegrity.danglingSupersedes === 0
    && input.appendOnlyEnforcement.updateBlocked
    && input.appendOnlyEnforcement.deleteBlocked
    && input.ambiguousActiveKeys === 0
    && input.afterConsistent !== false
    && fullIntegrityIsClean(input.fullIntegrity)
    && (input.secondRun === null || (input.secondRun.appended === 0 && input.secondRun.supersessions === 0));
  return clean ? "REPARSED" : "REPARSED_WITH_FLAGS";
}
