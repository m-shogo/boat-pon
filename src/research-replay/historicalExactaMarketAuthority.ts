export const HISTORICAL_EXACTA_SOURCE_TYPE = "official_archive";
export const HISTORICAL_EXACTA_SOURCE_QUALITY = "historical_closing_odds";

export const HISTORICAL_EXACTA_CANONICAL_SOURCE_PREDICATE =
  `source_type = '${HISTORICAL_EXACTA_SOURCE_TYPE}' AND source_quality = '${HISTORICAL_EXACTA_SOURCE_QUALITY}'`;

export const HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING = [
  "COUNT(*) = 30",
  "COUNT(DISTINCT combination) = 30",
].join(" AND ");

export function historicalExactaCompleteMarketPredicate(raceIdExpression: string): string {
  return [
    `(SELECT COUNT(*) FROM historical_alternative_odds a WHERE a.race_id = ${raceIdExpression} AND a.bet_type = 'exacta' AND a.source_type = '${HISTORICAL_EXACTA_SOURCE_TYPE}' AND a.source_quality = '${HISTORICAL_EXACTA_SOURCE_QUALITY}') = 30`,
    `(SELECT COUNT(DISTINCT a.combination) FROM historical_alternative_odds a WHERE a.race_id = ${raceIdExpression} AND a.bet_type = 'exacta' AND a.source_type = '${HISTORICAL_EXACTA_SOURCE_TYPE}' AND a.source_quality = '${HISTORICAL_EXACTA_SOURCE_QUALITY}') = 30`,
  ].join(" AND ");
}
