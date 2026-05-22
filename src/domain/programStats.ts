import type { DecisionHistoryRow } from "./backtest";
import { summarizeGroup, type RoiRow } from "./segmentStats";

export type ProgramBoat = {
  course: number;
  registrationNo?: string;
  racerName?: string;
  className?: string;
  motorNo?: string | null;
};

export type ProgramStatSummary = {
  racersBest: RoiRow[];
  racersWorst: RoiRow[];
  motorsBest: RoiRow[];
  motorsWorst: RoiRow[];
  classes: RoiRow[];
};

export function summarizeProgramStats(
  history: DecisionHistoryRow[],
  programByRaceId: Map<string, { boats?: ProgramBoat[] }>,
): ProgramStatSummary {
  const buyRows = history.filter((row) => row.decision === "BUY");
  const racerGroups = new Map<string, DecisionHistoryRow[]>();
  const motorGroups = new Map<string, DecisionHistoryRow[]>();
  const classGroups = new Map<string, DecisionHistoryRow[]>();

  for (const row of buyRows) {
    const firstCourse = Number(row.selection.split("-")[0]);
    const boat = programByRaceId.get(row.raceId)?.boats?.find((b) => b.course === firstCourse);
    if (!boat) continue;
    const racerKey = String(boat.registrationNo ?? "unknown") + " " + String(boat.racerName ?? "選手不明").trim();
    const motorKey = boat.motorNo ? "M" + boat.motorNo : "モーター不明";
    const classKey = boat.className ?? "級別不明";
    push(racerGroups, racerKey, row);
    push(motorGroups, motorKey, row);
    push(classGroups, classKey, row);
  }

  const racers = toRows(racerGroups);
  const motors = toRows(motorGroups);
  const classes = toRows(classGroups).sort((a, b) => a.label.localeCompare(b.label));
  return {
    racersBest: [...racers].sort((a, b) => b.modelRoi - a.modelRoi || b.buy - a.buy).slice(0, 10),
    racersWorst: [...racers].sort((a, b) => a.modelRoi - b.modelRoi || b.buy - a.buy).slice(0, 10),
    motorsBest: [...motors].sort((a, b) => b.modelRoi - a.modelRoi || b.buy - a.buy).slice(0, 10),
    motorsWorst: [...motors].sort((a, b) => a.modelRoi - b.modelRoi || b.buy - a.buy).slice(0, 10),
    classes,
  };
}

function push(map: Map<string, DecisionHistoryRow[]>, key: string, row: DecisionHistoryRow) {
  map.set(key, [...(map.get(key) ?? []), row]);
}

function toRows(map: Map<string, DecisionHistoryRow[]>): RoiRow[] {
  return [...map.entries()].map(([key, rows]) => summarizeGroup(key, key, rows));
}
