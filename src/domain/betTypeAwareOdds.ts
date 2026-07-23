/**
 * 券種付きオッズ時系列の保存契約。
 *
 * このモジュールはDBへ接続しない。exacta/quinellaの同形selectionを
 * betTypeなしで保存する事故を、収集前の純粋な検証で止めるために使う。
 */

export const ODDS_BET_TYPES = ["trifecta", "exacta", "quinella"] as const;
export type OddsBetType = (typeof ODDS_BET_TYPES)[number];

export const ODDS_CHECKPOINTS = ["T-30", "T-20", "T-10", "T-5", "ad-hoc"] as const;
export type OddsCheckpoint = (typeof ODDS_CHECKPOINTS)[number];

export type BetTypeAwareOddsRow = {
  raceId: string;
  betType: OddsBetType;
  selection: string;
  odds: number;
  popularity: number | null;
  source: string;
  capturedAt: string;
  minutesBeforeClose: number | null;
  checkpointLabel: OddsCheckpoint | null;
};

export type BuildOddsRowsInput = Omit<BetTypeAwareOddsRow, "selection" | "odds"> & {
  oddsBySelection: ReadonlyMap<string, number>;
};

export function buildBetTypeAwareOddsRows(input: BuildOddsRowsInput): BetTypeAwareOddsRow[] {
  if (!input.raceId.trim()) throw new Error("raceId is required");
  if (!input.source.trim()) throw new Error("source is required");
  if (!isValidIsoDate(input.capturedAt)) throw new Error(`capturedAt must be ISO-like: ${input.capturedAt}`);

  const { oddsBySelection, ...metadata } = input;
  const rows = [...oddsBySelection.entries()]
    .map(([selection, odds]) => ({ ...metadata, selection, odds }))
    .sort((a, b) => a.selection.localeCompare(b.selection));

  if (rows.length === 0) throw new Error("oddsBySelection is empty");
  const seen = new Set<string>();
  for (const row of rows) {
    assertSelection(row.betType, row.selection);
    if (!Number.isFinite(row.odds) || row.odds <= 0) {
      throw new Error(`odds must be positive: ${row.betType}/${row.selection}/${row.odds}`);
    }
    const key = oddsTimeseriesKey(row);
    if (seen.has(key)) throw new Error(`duplicate timeseries key: ${key}`);
    seen.add(key);
  }
  return rows;
}

export function assertMarketCoverage(
  rows: readonly Pick<BetTypeAwareOddsRow, "betType" | "selection">[],
  options: { activeBoats: number; requireComplete?: boolean },
) {
  const betTypes = new Set(rows.map((row) => row.betType));
  if (betTypes.size > 1) throw new Error(`mixed bet types in one market: ${[...betTypes].join(",")}`);
  const expected = expectedSelectionCount(rows[0]?.betType, options.activeBoats);
  const actual = new Set(rows.map((row) => row.selection)).size;
  const complete = expected != null && actual === expected;
  if (options.requireComplete !== false && !complete) {
    throw new Error(`incomplete ${rows[0]?.betType ?? "unknown"} market: ${actual}/${expected ?? "?"}`);
  }
  return { actual, expected, complete };
}

export function expectedSelectionCount(betType: OddsBetType | undefined, activeBoats: number): number | null {
  if (!betType || !Number.isInteger(activeBoats) || activeBoats < 2) return null;
  if (betType === "trifecta") return activeBoats * (activeBoats - 1) * (activeBoats - 2);
  return activeBoats * (activeBoats - 1);
}

export function assertSelection(betType: OddsBetType, selection: string): void {
  const parts = selection.split("-").map(Number);
  const expectedParts = betType === "trifecta" ? 3 : 2;
  if (
    parts.length !== expectedParts ||
    parts.some((part) => !Number.isInteger(part) || part < 1 || part > 6) ||
    new Set(parts).size !== parts.length
  ) {
    throw new Error(`invalid ${betType} selection: ${selection}`);
  }
}

export function oddsTimeseriesKey(row: Pick<BetTypeAwareOddsRow, "raceId" | "betType" | "selection" | "checkpointLabel" | "capturedAt">): string {
  return [row.raceId, row.betType, row.selection, row.checkpointLabel ?? "", row.capturedAt].join("|");
}

/** 実DBで実行しない、レビュー用のmigration契約。既存3連単行はDEFAULTで保全する。 */
export const EXACTA_TIMESERIES_MIGRATION_SQL = `
ALTER TABLE odds_timeseries_snapshots
  ADD COLUMN bet_type TEXT NOT NULL DEFAULT 'trifecta';

CREATE INDEX idx_odds_timeseries_bet_type
  ON odds_timeseries_snapshots (race_id, bet_type, selection, checkpoint_label, captured_at);
`;

function isValidIsoDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}
