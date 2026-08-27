import { n2CanonicalT5SelectionSql } from "./n2T5CollectorSelectionSql";

export function n2CanonicalT5CompleteCaptureSelectionHavingSql(columnSql: string): string {
  const canonicalSelection = n2CanonicalT5SelectionSql(columnSql);
  return `COUNT(*) = 120
    AND COUNT(DISTINCT ${columnSql}) = 120
    AND COUNT(DISTINCT CASE WHEN ${canonicalSelection} THEN ${columnSql} END) = 120`;
}
