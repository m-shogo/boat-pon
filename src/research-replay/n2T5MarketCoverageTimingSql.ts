const SAFE_COLUMN_SQL = /^[A-Za-z_][A-Za-z0-9_.]*$/u;

export function n2CanonicalT5CoverageTimingSql(columnSql: string): string {
  if (!SAFE_COLUMN_SQL.test(columnSql)) {
    throw new Error(`N2_T5_MARKET_COVERAGE_TIMING_COLUMN_INVALID:${columnSql}`);
  }
  return `(typeof(${columnSql}) = 'integer' AND ${columnSql} BETWEEN 0 AND 10)`;
}
