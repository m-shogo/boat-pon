/**
 * 結果の取り込みで「その日はそろっている（取り直さなくてよい）」とみなす条件。
 * 番組の数だけ結果があればそろっている。番組が無い日（番組表の欠け 2025-11-21〜2026-05-19 など）は、結果が1つでもあればそろっているとみなす。
 * 中止・不成立のレースは結果が入らないことがあるので、その日は毎晩取り直しの対象になるが、手元の K ファイルから読み直すだけで害は無い。
 */
export function isResultDayComplete(day: { results: number; programs: number }): boolean {
  if (day.programs <= 0) return day.results > 0;
  return day.results >= day.programs;
}

/** LZH の先頭: [ヘッダの長さ][チェックサム]-lh5- のように、2〜6 バイト目が圧縮方式（-lh?- / -lz?-）。エラーページや途中で切れた応答を弾く。 */
export function isLzhArchive(buf: Uint8Array): boolean {
  if (buf.length <= 21) return false;
  const method = String.fromCharCode(...buf.subarray(2, 7));
  return /^-l[hz][0-9a-z ]-$/.test(method);
}
