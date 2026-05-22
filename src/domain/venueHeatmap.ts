import type { DecisionHistoryRow } from "./backtest";

export type VenueMonthRoi = {
  venue: string;
  ym: string;
  buy: number;
  modelStakeYen: number;
  modelPayoutYen: number;
  modelRoi: number;
};

export type VenueRoiSummary = {
  venue: string;
  buy: number;
  modelStakeYen: number;
  modelPayoutYen: number;
  modelRoi: number;
};

export type VenueHeatmapSummary = {
  months: string[];
  venues: string[];
  cells: VenueMonthRoi[];
  best: VenueRoiSummary[];
  worst: VenueRoiSummary[];
};

export const BOAT_RACE_VENUES = [
  "桐生", "戸田", "江戸川", "平和島", "多摩川", "浜名湖", "蒲郡", "常滑", "津", "三国",
  "びわこ", "住之江", "尼崎", "鳴門", "丸亀", "児島", "宮島", "徳山", "下関", "若松",
  "芦屋", "福岡", "唐津", "大村",
];

export function summarizeVenueHeatmap(rows: DecisionHistoryRow[]): VenueHeatmapSummary {
  const buyRows = rows.filter((row) => row.decision === "BUY");
  const months = [...new Set(rows.map((row) => row.date.slice(0, 7)).filter(Boolean))].sort();
  const venues = BOAT_RACE_VENUES;
  const cells = venues.flatMap((venue) => months.map((ym) => summarizeGroup(
    venue,
    ym,
    buyRows.filter((row) => row.venue === venue && row.date.startsWith(ym)),
  )));

  const summaries = venues.map((venue) => {
    const grouped = buyRows.filter((row) => row.venue === venue);
    const modelStakeYen = grouped.reduce((sum, row) => sum + row.recommendedStakeYen, 0);
    const modelPayoutYen = grouped
      .filter((row) => row.result === row.selection)
      .reduce((sum, row) => sum + (row.payoutYen ?? 0), 0);
    return {
      venue,
      buy: grouped.length,
      modelStakeYen,
      modelPayoutYen,
      modelRoi: modelStakeYen ? modelPayoutYen / modelStakeYen : 0,
    };
  }).filter((row) => row.buy > 0);

  return {
    months,
    venues,
    cells,
    best: [...summaries].sort((a, b) => b.modelRoi - a.modelRoi || b.buy - a.buy).slice(0, 3),
    worst: [...summaries].sort((a, b) => a.modelRoi - b.modelRoi || b.buy - a.buy).slice(0, 3),
  };
}

function summarizeGroup(venue: string, ym: string, rows: DecisionHistoryRow[]): VenueMonthRoi {
  const modelStakeYen = rows.reduce((sum, row) => sum + row.recommendedStakeYen, 0);
  const modelPayoutYen = rows
    .filter((row) => row.result === row.selection)
    .reduce((sum, row) => sum + (row.payoutYen ?? 0), 0);
  return {
    venue,
    ym,
    buy: rows.length,
    modelStakeYen,
    modelPayoutYen,
    modelRoi: modelStakeYen ? modelPayoutYen / modelStakeYen : 0,
  };
}
