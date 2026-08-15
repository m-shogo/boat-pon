export type LineDailyLatestHit = {
  date: string;
  venue: string;
  raceNo: number;
  selection: string;
  payoutYen: number;
};

export function formatLineDailyLatestHit(hit: LineDailyLatestHit | null): string {
  if (!hit) return "直近的中: まだなし（現行paper-live）";
  return `直近的中: ${hit.date} ${hit.venue} ${hit.raceNo}R ${hit.selection} / 公式100円払戻 ${hit.payoutYen.toLocaleString("ja-JP")}円`;
}
