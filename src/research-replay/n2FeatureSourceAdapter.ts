// Legacy primary DB rowsをN2 observationへ変換するread-only pure adapter。
// source availability/lineageを推測せず、不足時はfail-closedで除外する。
import { extractProgramFeatures, type BoatFeature } from "../domain/programFeatures";
import type { SettlementBetType } from "./settlement";
import type { N2FeatureObservation, N2OddsObservation } from "./n2FeatureDatasetBuilder";

export const N2_FEATURE_SOURCE_ADAPTER_VERSION = "n2-feature-source-adapter-v1";

export type SourceLineage = {
  sourceAvailableAt: string | null;
  observationId: string | null;
  rawDocumentId: string | null;
};

export type OfficialProgramSourceRow = {
  raceId: string;
  rawJson: string;
  sourceFile: string;
  importedAt: string;
  lineage: SourceLineage;
};

export type OddsTimeseriesSourceRow = {
  id: number;
  raceId: string;
  betType: SettlementBetType | null;
  betSelection: string;
  odds: number;
  capturedAt: string;
  source: string;
  observationId: string | null;
  rawDocumentId: string | null;
};

export type SourceAdapterResult<T> =
  | { status: "adapted"; value: T }
  | { status: "excluded"; reason: string };

const RAW_PROGRAM_FEATURE_KEYS = [
  "className",
  "nationalWinRate",
  "nationalTop2Rate",
  "localWinRate",
  "localTop2Rate",
  "motorTop2Rate",
  "boatTop2Rate",
] as const satisfies readonly (keyof BoatFeature)[];

function validTime(value: string | null): value is string {
  return value !== null && Number.isFinite(Date.parse(value));
}

// imported_atやrace dateをsource availabilityの代用にしない。F0 observation/raw lineageが揃う場合だけ昇格する。
export function adaptOfficialProgramFeatures(row: OfficialProgramSourceRow): SourceAdapterResult<N2FeatureObservation[]> {
  if (!validTime(row.importedAt)) return { status: "excluded", reason: "excluded_invalid_program_imported_at" };
  if (!validTime(row.lineage.sourceAvailableAt)) {
    return { status: "excluded", reason: "excluded_unknown_program_source_availability" };
  }
  if (!row.lineage.observationId || !row.lineage.rawDocumentId) {
    return { status: "excluded", reason: "excluded_missing_program_lineage" };
  }
  if (Date.parse(row.lineage.sourceAvailableAt) > Date.parse(row.importedAt)) {
    return { status: "excluded", reason: "excluded_program_available_after_import" };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(row.rawJson);
  } catch {
    return { status: "excluded", reason: "excluded_invalid_program_raw_json" };
  }
  const snapshot = extractProgramFeatures(raw);
  const courses = new Set<number>();
  for (const boat of snapshot.boats) {
    if (courses.has(boat.course)) return { status: "excluded", reason: "excluded_duplicate_program_course" };
    courses.add(boat.course);
  }

  const observations: N2FeatureObservation[] = [];
  for (const boat of [...snapshot.boats].sort((a, b) => a.course - b.course)) {
    for (const key of RAW_PROGRAM_FEATURE_KEYS) {
      observations.push({
        featureKey: `boat.${boat.course}.${key}`,
        value: boat[key] ?? null,
        pitClass: "historical_safe",
        availableAt: row.lineage.sourceAvailableAt,
        observationId: row.lineage.observationId,
        rawDocumentId: row.lineage.rawDocumentId,
      });
    }
  }
  return { status: "adapted", value: observations };
}

export function adaptLiveOddsRows(input: {
  rows: OddsTimeseriesSourceRow[];
  expectedBetType: SettlementBetType;
  allowLegacyImplicitTrifecta?: boolean;
}): SourceAdapterResult<N2OddsObservation[]> {
  const observations: N2OddsObservation[] = [];
  for (const row of input.rows) {
    const betType = row.betType ?? (
      input.allowLegacyImplicitTrifecta && input.expectedBetType === "trifecta" ? "trifecta" : null
    );
    if (betType === null) return { status: "excluded", reason: "excluded_unknown_odds_bet_type" };
    if (betType !== input.expectedBetType) return { status: "excluded", reason: "excluded_mismatched_odds_bet_type" };
    if (!Number.isFinite(row.odds) || row.odds <= 0) return { status: "excluded", reason: "excluded_invalid_odds_value" };
    if (!validTime(row.capturedAt)) return { status: "excluded", reason: "excluded_invalid_odds_captured_at" };
    if (!row.observationId || !row.rawDocumentId) {
      return { status: "excluded", reason: "excluded_missing_odds_lineage" };
    }
    observations.push({
      betSelection: row.betSelection,
      odds: row.odds,
      kind: "live_checkpoint",
      capturedAt: row.capturedAt,
      // capture proves the value was available no later than this instant; equality is conservative.
      availableAt: row.capturedAt,
      observationId: row.observationId,
      rawDocumentId: row.rawDocumentId,
    });
  }
  return { status: "adapted", value: observations };
}
