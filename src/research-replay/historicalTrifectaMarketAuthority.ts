export const HISTORICAL_TRIFECTA_SOURCE_TYPE = "official_archive";
export const HISTORICAL_TRIFECTA_SOURCE_QUALITY = "historical_closing_odds";

export const HISTORICAL_TRIFECTA_COMBINATIONS = Array.from({ length: 6 }, (_, firstIndex) =>
  Array.from({ length: 6 }, (_, secondIndex) =>
    Array.from({ length: 6 }, (_, thirdIndex) => [firstIndex + 1, secondIndex + 1, thirdIndex + 1] as const),
  ).flat(),
).flat().filter(([first, second, third]) => first !== second && first !== third && second !== third)
  .map(([first, second, third]) => `${first}-${second}-${third}`);

const combinationSql = HISTORICAL_TRIFECTA_COMBINATIONS.map((value) => `'${value}'`).join(",");

export function historicalTrifectaRaceIdentityPredicate(alias?: string): string {
  const prefix = alias ? `${alias}.` : "";
  return [
    `length(${prefix}race_date) = 10`,
    `strftime('%Y-%m-%d', ${prefix}race_date) = ${prefix}race_date`,
    `${prefix}race_no BETWEEN 1 AND 12`,
    `length(${prefix}venue_code) = 2`,
    `${prefix}venue_code GLOB '[0-9][0-9]'`,
    `CAST(${prefix}venue_code AS INTEGER) BETWEEN 1 AND 24`,
    `printf('%02d', CAST(${prefix}venue_code AS INTEGER)) = ${prefix}venue_code`,
    `${prefix}race_id = replace(${prefix}race_date, '-', '') || '-' || ${prefix}venue || '-' || printf('%02d', ${prefix}race_no)`,
  ].join(" AND ");
}

export function historicalTrifectaCanonicalSourcePredicate(alias?: string): string {
  const prefix = alias ? `${alias}.` : "";
  return [
    `${prefix}source_type = '${HISTORICAL_TRIFECTA_SOURCE_TYPE}'`,
    `${prefix}source_quality = '${HISTORICAL_TRIFECTA_SOURCE_QUALITY}'`,
    `${prefix}is_backfill = 1`,
    `${prefix}fetch_status = 'success'`,
    historicalTrifectaRaceIdentityPredicate(alias),
  ].join(" AND ");
}

export const HISTORICAL_TRIFECTA_COMPLETE_MARKET_HAVING = [
  "COUNT(*) = 120",
  "COUNT(DISTINCT combination) = 120",
  `SUM(CASE WHEN combination IN (${combinationSql}) THEN 1 ELSE 0 END) = 120`,
  "SUM(CASE WHEN odds > 1.0 AND odds < 1e308 THEN 1 ELSE 0 END) = 120",
].join(" AND ");

export function historicalTrifectaCompleteMarketPredicate(raceIdExpression: string): string {
  const source = historicalTrifectaCanonicalSourcePredicate("a");
  const scope = `a.race_id = ${raceIdExpression} AND a.bet_type = 'trifecta' AND ${source}`;
  return [
    `(SELECT COUNT(*) FROM historical_alternative_odds a WHERE ${scope}) = 120`,
    `(SELECT COUNT(DISTINCT a.combination) FROM historical_alternative_odds a WHERE ${scope}) = 120`,
    `(SELECT SUM(CASE WHEN a.combination IN (${combinationSql}) THEN 1 ELSE 0 END) FROM historical_alternative_odds a WHERE ${scope}) = 120`,
    `(SELECT SUM(CASE WHEN a.odds > 1.0 AND a.odds < 1e308 THEN 1 ELSE 0 END) FROM historical_alternative_odds a WHERE ${scope}) = 120`,
  ].join(" AND ");
}
