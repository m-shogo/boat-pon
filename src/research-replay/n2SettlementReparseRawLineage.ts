import { parseCanonicalRaceKey } from "./identity";

export type N2SettlementReparseRawObservationRow = {
  rid: string;
  k: string;
};

export type N2SettlementReparseRawSchemaFamilyRow = {
  rid: string;
  fam: string;
};

class RequiredRawSchemaFamilyMap extends Map<string, string> {
  override get(rawDocumentId: string): string {
    const family = super.get(rawDocumentId);
    if (family === undefined) {
      throw new Error(`REPARSE_RAW_SCHEMA_FAMILY_MISSING:${rawDocumentId}`);
    }
    return family;
  }
}

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

export function resolveN2SettlementReparseRawSchemaFamilies(
  rows: readonly N2SettlementReparseRawSchemaFamilyRow[],
): Map<string, string> {
  const familiesByRaw = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.fam.trim()) {
      throw new Error(`REPARSE_RAW_SCHEMA_FAMILY_INVALID:${row.rid}`);
    }
    const families = familiesByRaw.get(row.rid) ?? new Set<string>();
    families.add(row.fam);
    familiesByRaw.set(row.rid, families);
  }

  const familyByRaw = new RequiredRawSchemaFamilyMap();
  for (const [rawDocumentId, families] of familiesByRaw) {
    if (families.size > 1) {
      throw new Error(`REPARSE_RAW_SCHEMA_FAMILY_AMBIGUOUS:${rawDocumentId}:${[...families].sort().join(":")}`);
    }
    const family = [...families][0];
    if (family !== undefined) familyByRaw.set(rawDocumentId, family);
  }
  return familyByRaw;
}

export function resolveN2SettlementReparseRawAuthority(
  rawDocumentId: string,
  dateByRaw: ReadonlyMap<string, string>,
  familyByRaw: ReadonlyMap<string, string>,
): { date: string; family: string } | null {
  const hasDate = dateByRaw.has(rawDocumentId);
  const hasFamily = familyByRaw.has(rawDocumentId);
  if (!hasDate && !hasFamily) return null;
  if (!hasDate) throw new Error(`REPARSE_RAW_DATE_MISSING:${rawDocumentId}`);
  if (!hasFamily) throw new Error(`REPARSE_RAW_SCHEMA_FAMILY_MISSING:${rawDocumentId}`);
  return {
    date: dateByRaw.get(rawDocumentId)!,
    family: familyByRaw.get(rawDocumentId)!,
  };
}
