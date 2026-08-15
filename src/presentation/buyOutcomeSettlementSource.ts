export type BuyOutcomeSettlementFilters = {
  runKind?: string | null;
  from?: string | null;
  to?: string | null;
  modelVersion?: string | null;
};

export type BuyOutcomeSettlementSource = {
  cte: string;
  params: Array<string | number>;
  usesOfficialRaceResults: boolean;
};

/**
 * Build the read-only outcome source shared by Current BUY learning reports.
 *
 * Current BUY (`paper-live`) is reconciled to the same official `race_results`
 * facts used by LINE result notifications. Historical/manual/sample callers keep
 * the legacy decision_history settlement fields so this helper does not widen
 * or reinterpret those datasets.
 */
export function buildBuyOutcomeSettlementSource(
  filters: BuyOutcomeSettlementFilters,
): BuyOutcomeSettlementSource {
  if (filters.runKind === "paper-live") {
    return buildPaperLiveSource(filters);
  }
  return buildDecisionHistorySource(filters);
}

function buildPaperLiveSource(filters: BuyOutcomeSettlementFilters): BuyOutcomeSettlementSource {
  const params: Array<string | number> = [];
  const where = [
    "dh.decision = 'BUY'",
    "dh.run_kind = 'paper-live'",
    "dh.bet_type IN ('trifecta', '3連単')",
  ];
  appendFilters(where, params, filters, "dh", false);

  return {
    usesOfficialRaceResults: true,
    params,
    cte: `
WITH ranked_buy AS (
  SELECT
    dh.*,
    ROW_NUMBER() OVER (
      PARTITION BY dh.race_id, dh.bet_type, dh.selection
      ORDER BY dh.created_at DESC, dh.id DESC
    ) AS outcome_row_num
  FROM decision_history dh
  WHERE ${where.join(" AND ")}
),
buy_outcomes AS (
  SELECT
    dh.race_id,
    dh.date,
    dh.venue,
    dh.race_no,
    dh.bet_type,
    dh.selection,
    dh.estimated_hit_rate,
    dh.sample_size,
    dh.ev,
    dh.current_odds,
    dh.model_version,
    dh.run_kind,
    dh.result AS decision_result,
    dh.payout_yen AS decision_payout_yen,
    dh.returned AS decision_returned,
    rr.trifecta AS outcome_result,
    rr.payout_yen AS outcome_payout_yen,
    COALESCE(rr.returned, 0) AS outcome_returned
  FROM ranked_buy dh
  LEFT JOIN race_results rr ON rr.race_id = dh.race_id
  WHERE dh.outcome_row_num = 1
)`,
  };
}

function buildDecisionHistorySource(filters: BuyOutcomeSettlementFilters): BuyOutcomeSettlementSource {
  const params: Array<string | number> = [];
  const where = ["dh.decision = 'BUY'"];
  appendFilters(where, params, filters, "dh", true);

  return {
    usesOfficialRaceResults: false,
    params,
    cte: `
WITH buy_outcomes AS (
  SELECT
    dh.race_id,
    dh.date,
    dh.venue,
    dh.race_no,
    dh.bet_type,
    dh.selection,
    dh.estimated_hit_rate,
    dh.sample_size,
    dh.ev,
    dh.current_odds,
    dh.model_version,
    dh.run_kind,
    dh.result AS decision_result,
    dh.payout_yen AS decision_payout_yen,
    dh.returned AS decision_returned,
    dh.result AS outcome_result,
    dh.payout_yen AS outcome_payout_yen,
    dh.returned AS outcome_returned
  FROM decision_history dh
  WHERE ${where.join(" AND ")}
)`,
  };
}

function appendFilters(
  where: string[],
  params: Array<string | number>,
  filters: BuyOutcomeSettlementFilters,
  alias: string,
  includeRunKind: boolean,
) {
  if (filters.from) {
    where.push(`${alias}.date >= ?`);
    params.push(filters.from);
  }
  if (filters.to) {
    where.push(`${alias}.date <= ?`);
    params.push(filters.to);
  }
  if (includeRunKind && filters.runKind) {
    where.push(`${alias}.run_kind = ?`);
    params.push(filters.runKind);
  }
  if (filters.modelVersion) {
    where.push(`${alias}.model_version = ?`);
    params.push(filters.modelVersion);
  }
}
