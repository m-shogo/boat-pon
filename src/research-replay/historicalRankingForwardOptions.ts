export const DEFAULT_HISTORICAL_RANKING_EPOCHS = 12;

export function parseHistoricalRankingEpochs(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_HISTORICAL_RANKING_EPOCHS;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("HISTORICAL_RANKING_EPOCHS_INVALID");
  }
  return value;
}

export type HistoricalRankingForwardCohortCounts = {
  train: number;
  validation: number;
  test: number;
};

export function validateHistoricalRankingForwardCohorts(counts: HistoricalRankingForwardCohortCounts): void {
  for (const [name, count] of Object.entries(counts)) {
    if (!Number.isSafeInteger(count) || count <= 0) {
      throw new Error(`HISTORICAL_RANKING_COHORT_EMPTY:${name}`);
    }
  }
  for (const name of ["train", "validation", "test"] as const) {
    if (counts[name] <= 2) {
      throw new Error(`HISTORICAL_RANKING_COHORT_TOO_SMALL:${name}`);
    }
  }
}
