export const HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING = [
  "COUNT(*) = 30",
  "COUNT(DISTINCT combination) = 30",
  "COUNT(DISTINCT source_type || char(31) || source_quality) = 1",
].join(" AND ");

export function historicalExactaCompleteMarketPredicate(raceIdExpression: string): string {
  return [
    `(SELECT COUNT(*) FROM historical_alternative_odds a WHERE a.race_id = ${raceIdExpression} AND a.bet_type = 'exacta') = 30`,
    `(SELECT COUNT(DISTINCT a.combination) FROM historical_alternative_odds a WHERE a.race_id = ${raceIdExpression} AND a.bet_type = 'exacta') = 30`,
    `(SELECT COUNT(DISTINCT a.source_type || char(31) || a.source_quality) FROM historical_alternative_odds a WHERE a.race_id = ${raceIdExpression} AND a.bet_type = 'exacta') = 1`,
  ].join(" AND ");
}
