export type CalibrationB1RuleId = "current-live" | "legacy-second-not-b1";

export type CalibrationB1Rule = {
  id: CalibrationB1RuleId;
  label: string;
  description: string;
  includesSecondBoatNotB1: boolean;
};

export const CALIBRATION_B1_RULES: Record<CalibrationB1RuleId, CalibrationB1Rule> = {
  "current-live": {
    id: "current-live",
    label: "現行live B1",
    description: "excludeSameClassSecondBoat=false。1号艇B1、5会場除外、11/12R除外、必要オッズ25以上、B1 ratio<1.5。",
    includesSecondBoatNotB1: false,
  },
  "legacy-second-not-b1": {
    id: "legacy-second-not-b1",
    label: "旧検証 B1 + 2号艇≠B1",
    description: "旧検証用。現行liveルールに boats[1].className != 'B1' を追加する。",
    includesSecondBoatNotB1: true,
  },
};

export function parseCalibrationB1Rule(value: unknown): CalibrationB1RuleId {
  return value === "legacy-second-not-b1" ? "legacy-second-not-b1" : "current-live";
}

export function calibrationB1Where(ruleId: CalibrationB1RuleId, oddsExpression: "dh.current_odds" | "os.odds"): string {
  const secondBoatClause = ruleId === "legacy-second-not-b1"
    ? "\n  AND json_extract(op.raw_json, '$.boats[1].className') != 'B1'"
    : "";
  return `
  AND json_extract(op.raw_json, '$.boats[0].className') = 'B1'${secondBoatClause}
  AND CAST(json_extract(op.raw_json, '$.boats[0].nationalWinRate') AS REAL) >= 4.0
  AND dh.venue NOT IN ('戸田','多摩川','桐生','三国','江戸川')
  AND CAST(substr(dh.race_id, -2) AS INTEGER) NOT IN (11, 12)
  AND dh.required_odds >= 25
  AND ${oddsExpression} / dh.required_odds < 1.5`;
}
