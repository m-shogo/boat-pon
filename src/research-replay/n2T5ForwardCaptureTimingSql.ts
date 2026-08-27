import { n2CanonicalT5CoverageTimingSql } from "./n2T5MarketCoverageTimingSql";

const SAFE_COLUMN_SQL = /^[A-Za-z_][A-Za-z0-9_.]*$/u;

export function n2CanonicalT5ForwardCaptureTimingHavingSql(columnSql: string): string {
  if (!SAFE_COLUMN_SQL.test(columnSql)) {
    throw new Error(`N2_T5_FORWARD_CAPTURE_TIMING_COLUMN_INVALID:${columnSql}`);
  }
  const canonicalTiming = n2CanonicalT5CoverageTimingSql(columnSql);
  return `SUM(CASE WHEN ${canonicalTiming} THEN 1 ELSE 0 END) = COUNT(*) AND COUNT(DISTINCT ${columnSql}) = 1`;
}
