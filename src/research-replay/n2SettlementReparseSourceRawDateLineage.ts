import type { DatabaseSync } from "node:sqlite";
import { parseCanonicalRaceKey } from "./identity";

export function assertN2SettlementReparseSourceRawDateLineage(
  db: DatabaseSync,
  rawDocumentId: string,
  expectedDate: string,
): void {
  const rows = db.prepare(
    `SELECT canonical_race_key AS raceKey
     FROM domain_observations
     WHERE raw_document_id=?
     ORDER BY observation_id`,
  ).all(rawDocumentId) as Array<{ raceKey: string }>;
  if (rows.length === 0) return;

  let observedDate: string | null = null;
  for (const row of rows) {
    let parsed;
    try {
      parsed = parseCanonicalRaceKey(row.raceKey);
    } catch {
      throw new Error(`REPARSE_SOURCE_RAW_RACE_IDENTITY_INVALID:${rawDocumentId}:${row.raceKey}`);
    }
    if (observedDate !== null && parsed.raceDateJst !== observedDate) {
      throw new Error(`REPARSE_SOURCE_RAW_DATE_AMBIGUOUS:${rawDocumentId}:${observedDate}:${parsed.raceDateJst}`);
    }
    observedDate = parsed.raceDateJst;
  }

  if (observedDate !== expectedDate) {
    throw new Error(`REPARSE_SOURCE_RAW_DATE_MISMATCH:${rawDocumentId}:${expectedDate}:${observedDate}`);
  }
}
