export const HISTORICAL_EXACTA_SOURCE_TYPE = "official_archive";
export const HISTORICAL_EXACTA_SOURCE_QUALITY = "historical_closing_odds";

export const HISTORICAL_EXACTA_COMBINATIONS = Array.from({ length: 6 }, (_, firstIndex) =>
  Array.from({ length: 6 }, (_, secondIndex) => [firstIndex + 1, secondIndex + 1] as const),
).flat().filter(([first, second]) => first !== second).map(([first, second]) => `${first}-${second}`);

const combinationSql = HISTORICAL_EXACTA_COMBINATIONS.map((value) => `'${value}'`).join(",");

export function historicalExactaCanonicalSourcePredicate(alias?: string): string {
  const prefix = alias ? `${alias}.` : "";
  return `${prefix}source_type = '${HISTORICAL_EXACTA_SOURCE_TYPE}' AND ${prefix}source_quality = '${HISTORICAL_EXACTA_SOURCE_QUALITY}'`;
}

export const HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING = [
  "COUNT(*) = 30",
  "COUNT(DISTINCT combination) = 30",
  `SUM(CASE WHEN combination IN (${combinationSql}) THEN 1 ELSE 0 END) = 30`,
].join(" AND ");

export function historicalExactaCompleteMarketPredicate(raceIdExpression: string): string {
  const source = historicalExactaCanonicalSourcePredicate("a");
  const scope = `a.race_id = ${raceIdExpression} AND a.bet_type = 'exacta' AND ${source}`;
  return [
    `(SELECT COUNT(*) FROM historical_alternative_odds a WHERE ${scope}) = 30`,
    `(SELECT COUNT(DISTINCT a.combination) FROM historical_alternative_odds a WHERE ${scope}) = 30`,
    `(SELECT SUM(CASE WHEN a.combination IN (${combinationSql}) THEN 1 ELSE 0 END) FROM historical_alternative_odds a WHERE ${scope}) = 30`,
  ].join(" AND ");
}
