import type { DecisionHistoryRow } from "./backtest";

export type RoiRow = {
  key: string;
  label: string;
  buy: number;
  modelStakeYen: number;
  modelPayoutYen: number;
  modelRoi: number;
};

export function summarizeByRaceNo(rows: DecisionHistoryRow[]): RoiRow[] {
  return Array.from({ length: 12 }, (_, index) => index + 1).map((raceNo) => summarizeGroup(
    String(raceNo),
    String(raceNo) + "R",
    rows.filter((row) => row.decision === "BUY" && row.raceNo === raceNo),
  ));
}

export function summarizeByTimeBand(rows: DecisionHistoryRow[], closeAtByRaceId = new Map<string, string>()): RoiRow[] {
  const bands = [
    ["morning", "朝(〜12時)", (hour: number) => hour < 12],
    ["day", "昼(12〜16時)", (hour: number) => hour >= 12 && hour < 16],
    ["evening", "夕(16〜18時)", (hour: number) => hour >= 16 && hour < 18],
    ["night", "ナイター(18時〜)", (hour: number) => hour >= 18],
  ] as const;
  return bands.map(([key, label, predicate]) => summarizeGroup(
    key,
    label,
    rows.filter((row) => row.decision === "BUY" && predicate(hourOf(closeAtByRaceId.get(row.raceId), row.raceNo))),
  ));
}

export function summarizeGroup(key: string, label: string, rows: DecisionHistoryRow[]): RoiRow {
  const modelStakeYen = rows.reduce((sum, row) => sum + row.recommendedStakeYen, 0);
  const modelPayoutYen = rows
    .filter((row) => row.result === row.selection)
    .reduce((sum, row) => sum + (row.payoutYen ?? 0), 0);
  return {
    key,
    label,
    buy: rows.length,
    modelStakeYen,
    modelPayoutYen,
    modelRoi: modelStakeYen ? modelPayoutYen / modelStakeYen : 0,
  };
}

function hourOf(closeAt: string | undefined, raceNo: number) {
  const hour = Number(closeAt?.split(":")[0]);
  if (Number.isFinite(hour)) return hour;
  if (raceNo <= 4) return 11;
  if (raceNo <= 8) return 15;
  if (raceNo <= 10) return 17;
  return 19;
}
