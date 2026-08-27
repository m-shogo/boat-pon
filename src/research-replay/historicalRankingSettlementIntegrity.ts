import { parseSettlementSelection } from "./settlement";

export type HistoricalRankingSettlementRow = {
  race_id: string;
  trifecta: string;
  payout_yen: number;
  payout_source: string;
  payout_returned: number;
  date?: string;
  venue?: string;
  race_no?: number;
  raw_json?: string;
};

const RANKING_CLASS_NAMES = new Set(["A1", "A2", "B1", "B2"]);
const RANKING_RATE_MAXIMUMS = {
  nationalWinRate: 10,
  nationalTop2Rate: 100,
  localWinRate: 10,
  localTop2Rate: 100,
  motorTop2Rate: 100,
  boatTop2Rate: 100,
} as const;

type RankingRateField = keyof typeof RANKING_RATE_MAXIMUMS;

export function validateHistoricalRankingSettlementRows<T extends HistoricalRankingSettlementRow>(
  rows: readonly T[],
): T[] {
  return rows.map((row) => {
    const selection = parseSettlementSelection("trifecta", row.trifecta);
    if (!selection.valid || selection.canonical !== row.trifecta) {
      throw new Error(`HISTORICAL_RANKING_SELECTION_INVALID:${row.race_id}`);
    }
    if (row.payout_source !== "race_payouts" && row.payout_source !== "race_results") {
      throw new Error(`HISTORICAL_RANKING_PAYOUT_SOURCE_INVALID:${row.race_id}`);
    }
    if (!Number.isSafeInteger(row.payout_yen) || row.payout_yen <= 0) {
      throw new Error(`HISTORICAL_RANKING_PAYOUT_INVALID:${row.race_id}`);
    }
    if (row.payout_returned !== 0) {
      throw new Error(`HISTORICAL_RANKING_PAYOUT_RETURNED_INVALID:${row.race_id}`);
    }
    if (row.raw_json !== undefined) validateHistoricalRankingProgramFeatures(row);
    return row;
  });
}

function validateHistoricalRankingProgramFeatures(row: HistoricalRankingSettlementRow): void {
  let raw: unknown;
  try {
    raw = JSON.parse(row.raw_json ?? "") as unknown;
  } catch {
    // The ranking reader already excludes malformed program JSON from its cohort.
    return;
  }
  if (!isRecord(raw) || !Array.isArray(raw.boats)) {
    // Preserve the existing incomplete-program rejection path.
    return;
  }
  const hasRawIdentity = ["date", "venue", "raceNo"].some((field) => Object.prototype.hasOwnProperty.call(raw, field));
  if (hasRawIdentity) {
    if (row.date === undefined || row.venue === undefined || row.race_no === undefined
      || raw.date !== row.date || raw.venue !== row.venue || raw.raceNo !== row.race_no) {
      throw new Error(`HISTORICAL_RANKING_PROGRAM_IDENTITY_MISMATCH:${row.race_id}`);
    }
  }
  for (const boat of raw.boats) {
    if (!isRecord(boat)) continue;
    const className = boat.className;
    if (className !== undefined && className !== null && className !== ""
      && (typeof className !== "string" || !RANKING_CLASS_NAMES.has(className))) {
      throw new Error(`HISTORICAL_RANKING_PROGRAM_CLASS_INVALID:${row.race_id}`);
    }
    for (const [field, maximum] of Object.entries(RANKING_RATE_MAXIMUMS) as Array<[RankingRateField, number]>) {
      const value = boat[field];
      if (value === undefined || value === null) continue;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) {
        throw new Error(`HISTORICAL_RANKING_PROGRAM_RATE_INVALID:${row.race_id}:${field}`);
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
