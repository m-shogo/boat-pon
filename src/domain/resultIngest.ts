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

/**
 * 結果の取り込みで、その日を飛ばすか。
 * - onlyMissingArchive（穴埋め用）: 手元に K ファイルがある日は飛ばす。結果がそろっていても、ファイルが無ければ取りに行く
 *   （全券種の払戻・各艇の成績・気象は K ファイルからしか入らない。2026-06-02〜07-03 は、結果だけ入ってファイルが無かった）。
 * - それ以外: skipExisting のとき、結果がそろっている日を飛ばす（これまでどおり）。
 */
export function shouldSkipResultDay(input: { skipExisting: boolean; resultsComplete: boolean; onlyMissingArchive: boolean; archiveCached: boolean }): boolean {
  if (input.onlyMissingArchive) return input.archiveCached;
  return input.skipExisting && input.resultsComplete;
}

/**
 * 1回の実行で公式アーカイブから新しく取るファイルの数の上限（環境変数 BOAT_PON_MAX_DOWNLOADS）。
 * 指定が無い・正の整数でないときは上限なし（これまでどおり）。穴埋めは 1回 200 ファイルまでの決まり（CLAUDE.md の 3 章）。
 */
export function parseMaxDownloads(value: string | undefined): number {
  if (!value?.trim()) return Number.POSITIVE_INFINITY;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
}
