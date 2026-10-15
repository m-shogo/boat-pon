/**
 * 締切前のオッズの時系列の書き出し形式（scripts/export-odds-timeseries.ts）。1行 = 1回の取得。
 * DB には同じ取得・同じ買い目の行が2つ以上あることを禁じる制約が無いので、行は1つずつ残す（まとめない）。
 */

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
  /** [買い目, オッズ, 人気（無ければ null）] を DB の行の数だけ。 */
  rows: Array<[string, number, number | null]>;
};

/** 同じレース・取得時刻・取得元・チェックポイント・締切までの分の行を1回の取得にまとめる（行は1つも捨てない）。 */
export function groupOddsTimeseriesRows(rows: OddsTimeseriesRow[]): OddsTimeseriesCapture[] {
  const captures = new Map<string, OddsTimeseriesCapture>();
  for (const row of rows) {
    const key = [row.race_id, row.captured_at, row.source, row.checkpoint_label ?? "", row.minutes_before_close ?? ""].join("\u0000");
    let capture = captures.get(key);
    if (!capture) {
      capture = {
        raceId: row.race_id,
        capturedAt: row.captured_at,
        checkpoint: row.checkpoint_label,
        minutesBeforeClose: row.minutes_before_close,
        source: row.source,
        rows: [],
      };
      captures.set(key, capture);
    }
    capture.rows.push([row.selection, row.odds, row.popularity]);
  }
  return [...captures.values()].sort((a, b) => a.raceId.localeCompare(b.raceId) || a.capturedAt.localeCompare(b.capturedAt) || a.source.localeCompare(b.source));
}

/** 書き出した形から DB の行に戻す（検証と、必要になったときの復元用）。 */
export function expandOddsTimeseriesCaptures(captures: OddsTimeseriesCapture[]): OddsTimeseriesRow[] {
  return captures.flatMap((c) => c.rows.map(([selection, odds, popularity]) => ({
    race_id: c.raceId,
    selection,
    odds,
    popularity,
    source: c.source,
    captured_at: c.capturedAt,
    minutes_before_close: c.minutesBeforeClose,
    checkpoint_label: c.checkpoint,
  })));
}

/** 行の集まりを、並び順に関係なく比べるための文字列（全列を含む）。 */
export function canonicalOddsTimeseriesRows(rows: OddsTimeseriesRow[]): string {
  return rows
    .map((r) => JSON.stringify([r.race_id, r.captured_at, r.source, r.checkpoint_label, r.minutes_before_close, r.selection, r.odds, r.popularity]))
    .sort()
    .join("\n");
}
