export const DEFAULT_HISTORICAL_RANKING_EPOCHS = 12;

export function parseHistoricalRankingEpochs(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_HISTORICAL_RANKING_EPOCHS;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("HISTORICAL_RANKING_EPOCHS_INVALID");
  }
  return value;
}
