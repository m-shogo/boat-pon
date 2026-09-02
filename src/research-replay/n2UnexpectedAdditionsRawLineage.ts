import { parseCanonicalRaceKey } from "./identity";

export function resolveUnexpectedAdditionsRawDate(raceKeys: string[]): string {
  if (raceKeys.length === 0) {
    throw new Error("N2_UNEXPECTED_ADDITIONS_RAW_RACE_IDENTITY_MISSING");
  }

  let date: string | null = null;
  for (const raceKey of raceKeys) {
    let parsed;
    try {
      parsed = parseCanonicalRaceKey(raceKey);
    } catch {
      throw new Error(`N2_UNEXPECTED_ADDITIONS_RAW_RACE_IDENTITY_INVALID:${raceKey}`);
    }
    if (date !== null && parsed.raceDateJst !== date) {
      throw new Error(`N2_UNEXPECTED_ADDITIONS_RAW_DATE_AMBIGUOUS:${date}:${parsed.raceDateJst}`);
    }
    date = parsed.raceDateJst;
  }
  return date!;
}

export function resolveUnexpectedAdditionsSourceSchemaFamily(families: string[]): string {
  if (families.some((family) => !family.trim() || family !== family.trim())) {
    throw new Error("N2_UNEXPECTED_ADDITIONS_RAW_SCHEMA_FAMILY_INVALID");
  }
  const distinct = [...new Set(families)];
  if (distinct.length === 0) {
    throw new Error("N2_UNEXPECTED_ADDITIONS_RAW_SCHEMA_FAMILY_MISSING");
  }
  if (distinct.length > 1) {
    throw new Error(`N2_UNEXPECTED_ADDITIONS_RAW_SCHEMA_FAMILY_AMBIGUOUS:${distinct.sort().join(":")}`);
  }
  return distinct[0];
}
