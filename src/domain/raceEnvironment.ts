export type RaceEnvironment = {
  weather?: string | null;
  windDirection?: string | null;
  windSpeedMps?: number | null;
  waveHeightCm?: number | null;
  temperatureC?: number | null;
  waterTemperatureC?: number | null;
  stablePlate?: boolean | null;
  shortenedLaps?: boolean | null;
};

export type EnvironmentRisk = {
  level: "low" | "medium" | "high";
  reasons: string[];
};

export function assessEnvironmentRisk(env: RaceEnvironment | null | undefined): EnvironmentRisk {
  if (!env) return { level: "low", reasons: [] };
  const reasons: string[] = [];
  if ((env.windSpeedMps ?? 0) >= 8) reasons.push("風速8m以上");
  if ((env.waveHeightCm ?? 0) >= 8) reasons.push("波高8cm以上");
  if (env.stablePlate) reasons.push("安定板使用");
  if (env.shortenedLaps) reasons.push("周回短縮");
  if (/雨|雪|荒/i.test(String(env.weather ?? ""))) reasons.push("荒天気配");
  return {
    level: reasons.length >= 2 ? "high" : reasons.length === 1 ? "medium" : "low",
    reasons,
  };
}
