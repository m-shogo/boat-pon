import { parseCanonicalRaceKey } from "./identity";

export type N2SettlementReparseRawObservationRow = {
  rid: string;
  k: string;
};

export function resolveN2SettlementReparseRawDates(
  rows: readonly N2SettlementReparseRawObservationRow[],
): Map<string, string> {
  const dateByRaw = new Map<string, string>();
  for (const row of rows) {
    let parsed;
    try {
      parsed = parseCanonicalRaceKey(row.k);
    } catch {
      throw new Error(`REPARSE_RAW_RACE_IDENTITY_INVALID:${row.rid}:${row.k}`);
    }
    const prior = dateByRaw.get(row.rid);
    if (prior !== undefined && prior !== parsed.raceDateJst) {
      throw new Error(`REPARSE_RAW_DATE_AMBIGUOUS:${row.rid}:${prior}:${parsed.raceDateJst}`);
    }
    dateByRaw.set(row.rid, parsed.raceDateJst);
  }
  return dateByRaw;
}
