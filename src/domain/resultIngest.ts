/**
 * 結果の取り込みで「その日はそろっている（取り直さなくてよい）」とみなす条件。
 * 番組の数だけ結果があればそろっている。番組が無い日（番組表の欠け 2025-11-21〜2026-05-19 など）は、結果が1つでもあればそろっているとみなす。
 * 中止・不成立のレースは結果が入らないことがあるので、その日は毎晩取り直しの対象になるが、手元の K ファイルから読み直すだけで害は無い。
 */
export function isResultDayComplete(day: { results: number; programs: number }): boolean {
  if (day.programs <= 0) return day.results > 0;
  return day.results >= day.programs;
}
