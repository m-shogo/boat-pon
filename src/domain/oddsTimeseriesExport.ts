/** 締切前のオッズの時系列の書き出し形式（scripts/export-odds-timeseries.ts）。1行 = 1回の取得。 */

export type OddsTimeseriesRow = {
  race_id: string;
  selection: string;
  odds: number;
  popularity: number | null;
  source: string;
  captured_at: string;
  minutes_before_close: number | null;
  checkpoint_label: string | null;
};

export type OddsTimeseriesCapture = {
  raceId: string;
  capturedAt: string;
  checkpoint: string | null;
  minutesBeforeClose: number | null;
  source: string;
  odds: Record<string, number>;
  /** 人気（あるときだけ）。 */
  popularity?: Record<string, number>;
};

/** 同じレース・同じ取得時刻・同じ取得元の行を1つにまとめる。並び順はレース・時刻の順。 */
export function groupOddsTimeseriesRows(rows: OddsTimeseriesRow[]): OddsTimeseriesCapture[] {
  const captures = new Map<string, OddsTimeseriesCapture>();
  for (const row of rows) {
    const key = `${row.race_id}\u0000${row.captured_at}\u0000${row.source}`;
    let capture = captures.get(key);
    if (!capture) {
      capture = {
        raceId: row.race_id,
        capturedAt: row.captured_at,
        checkpoint: row.checkpoint_label,
        minutesBeforeClose: row.minutes_before_close,
        source: row.source,
        odds: {},
      };
      captures.set(key, capture);
    }
    capture.odds[row.selection] = row.odds;
    if (row.popularity != null) (capture.popularity ??= {})[row.selection] = row.popularity;
  }
  return [...captures.values()].sort((a, b) => a.raceId.localeCompare(b.raceId) || a.capturedAt.localeCompare(b.capturedAt));
}
