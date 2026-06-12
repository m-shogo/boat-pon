/**
 * programFeatureSafety.ts — point-in-time feature 安全境界ユーティリティ
 *
 * 設計方針:
 *   - historical-backfill / historical-readonly では live-only特徴量を null にする
 *   - live mode では制限しない
 *   - report mode では存在確認のみ（値の利用はしない）
 *
 * live-only特徴量: racer_profiles / racer_course_stats 由来の現在値スナップショット
 *   courseAvgSt, courseTop3Rate, courseEntryRate, courseStartOrder,
 *   flyingCount, lateStartCount, exhibitionStResidual
 *
 * historical-safe特徴量: official_programs.raw_json boats[] 由来（出走表掲載値）+ motor_boat_stats
 *   className, nationalWinRate, nationalTop2Rate, localWinRate, localTop2Rate,
 *   motorTop2Rate, boatTop2Rate, venueMotorTop2Rate, venueBoatTop2Rate
 *
 * ルール:
 *   - snapshot履歴が存在する場合は snapshot_date <= race_date を満たすスナップショットのみ使う
 *   - 現在値フォールバック（snapshot_date > race_date）は禁止
 *   - 欠損時は中立(=1) — null埋めや平均値埋めは禁止
 */

import type { BoatFeature, ProgramFeatureSnapshot } from "./programFeatures";

/** 特徴量の使用モード */
export type ProgramFeatureUsageMode =
  /** live runtime: 最新スナップショットを使ってよい */
  | "live"
  /** historical-backfill DB書き込みパス: live-only特徴量は使ってはいけない */
  | "historical"
  /** read-only historical評価・A/B再生成: historical と同じく live-only は中立化 */
  | "historical-readonly"
  /** coverage監査・棚卸し用: 値の存在確認のみ、ROI/BUY評価には使わない */
  | "report";

/** live-only特徴量のキー一覧（unsafe_due_to_point_in_time_leakage） */
export const LIVE_ONLY_FEATURE_KEYS = [
  "courseAvgSt",
  "courseTop3Rate",
  "courseEntryRate",
  "courseStartOrder",
  "flyingCount",
  "lateStartCount",
  "exhibitionStResidual",
] as const;

export type LiveOnlyFeatureKey = (typeof LIVE_ONLY_FEATURE_KEYS)[number];

/** historical-safe特徴量のキー一覧 */
export const HISTORICAL_SAFE_FEATURE_KEYS = [
  "className",
  "nationalWinRate",
  "nationalTop2Rate",
  "localWinRate",
  "localTop2Rate",
  "motorTop2Rate",
  "boatTop2Rate",
  "venueMotorTop2Rate",
  "venueBoatTop2Rate",
] as const;

export type HistoricalSafeFeatureKey = (typeof HISTORICAL_SAFE_FEATURE_KEYS)[number];

/**
 * live-only特徴量を全て null にする。
 * historical / historical-readonly mode では必ずこれを通す。
 */
export function stripLiveOnlyRacerFeatures(snapshot: ProgramFeatureSnapshot): ProgramFeatureSnapshot {
  return {
    boats: snapshot.boats.map((boat) => stripLiveOnlyFromBoat(boat)),
  };
}

function stripLiveOnlyFromBoat(boat: BoatFeature): BoatFeature {
  const stripped: BoatFeature = { ...boat };
  for (const key of LIVE_ONLY_FEATURE_KEYS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (stripped as any)[key] = null;
  }
  return stripped;
}

/**
 * historical mode で live-only特徴量が残っていたら例外を投げる guard。
 * generate-decision-history の historical-backfill write path で使う。
 *
 * @param raceId 識別用
 * @param snapshot 検査対象
 * @throws historical-backfill に live-only特徴量が混入している場合
 */
export function assertNoLiveOnlyFeaturesForHistorical(raceId: string, snapshot: ProgramFeatureSnapshot): void {
  for (const boat of snapshot.boats) {
    for (const key of LIVE_ONLY_FEATURE_KEYS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const value = (boat as any)[key];
      if (value != null) {
        throw new Error(
          `historical-backfill cannot use live-only racer snapshots. ` +
            `raceId=${raceId} boat.course=${boat.course} boat.registrationNo=${boat.registrationNo ?? "?"} ` +
            `field=${key} value=${value}. ` +
            `Use mode="historical" when calling enrichFeatures or stripLiveOnlyRacerFeatures before this path.`,
        );
      }
    }
  }
}

/** featureAdjustmentBreakdown の live-only系factor が中立(=1)かどうかを検査する */
export function assertBreakdownNeutralForHistorical(
  raceId: string,
  breakdown: {
    courseStFactor: number;
    courseTop3Factor: number;
    exhibitionResidualFactor: number;
  },
): void {
  const checks: Array<{ key: string; value: number }> = [
    { key: "courseStFactor", value: breakdown.courseStFactor },
    { key: "courseTop3Factor", value: breakdown.courseTop3Factor },
    { key: "exhibitionResidualFactor", value: breakdown.exhibitionResidualFactor },
  ];
  for (const { key, value } of checks) {
    if (value !== 1) {
      throw new Error(
        `historical-backfill cannot use live-only racer snapshots. ` +
          `raceId=${raceId} factor=${key} value=${value} (expected 1). ` +
          `courseStFactor/courseTop3Factor/exhibitionResidualFactor must be 1 for historical mode.`,
      );
    }
  }
}

/**
 * スナップショットの安全性サマリを返す（監査・レポート用）。
 * BUY/SKIP判定やROI計算には使わない。
 */
export function classifyProgramFeatureSafety(
  snapshot: ProgramFeatureSnapshot,
  mode: ProgramFeatureUsageMode,
): FeatureSafetyReport {
  let totalBoats = 0;
  let liveOnlyNonNullCount = 0;
  const fieldNonNull: Record<string, number> = {};

  for (const boat of snapshot.boats) {
    totalBoats += 1;
    for (const key of LIVE_ONLY_FEATURE_KEYS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const value = (boat as any)[key];
      if (value != null) {
        liveOnlyNonNullCount += 1;
        fieldNonNull[key] = (fieldNonNull[key] ?? 0) + 1;
      }
    }
  }

  const isHistoricalSafe =
    mode === "live" ||
    liveOnlyNonNullCount === 0;

  return {
    mode,
    totalBoats,
    liveOnlyNonNullCount,
    fieldNonNull,
    isHistoricalSafe,
    warning:
      !isHistoricalSafe
        ? `live-only features present in ${mode} mode. Fields: ${JSON.stringify(fieldNonNull)}. Run stripLiveOnlyRacerFeatures first.`
        : null,
  };
}

export type FeatureSafetyReport = {
  mode: ProgramFeatureUsageMode;
  totalBoats: number;
  liveOnlyNonNullCount: number;
  fieldNonNull: Record<string, number>;
  isHistoricalSafe: boolean;
  warning: string | null;
};

/**
 * プログラム群の安全性サマリをまとめて返す（監査用）。
 */
export function summarizeFeatureSafety(
  programs: Array<{ raceId: string; features: ProgramFeatureSnapshot }>,
  mode: ProgramFeatureUsageMode,
): {
  mode: ProgramFeatureUsageMode;
  totalPrograms: number;
  programsWithLiveOnlyLeak: number;
  isHistoricalSafe: boolean;
  warning: string | null;
} {
  let leakCount = 0;
  for (const program of programs) {
    const report = classifyProgramFeatureSafety(program.features, mode);
    if (!report.isHistoricalSafe) leakCount += 1;
  }
  const isHistoricalSafe = mode === "live" || leakCount === 0;
  return {
    mode,
    totalPrograms: programs.length,
    programsWithLiveOnlyLeak: leakCount,
    isHistoricalSafe,
    warning:
      !isHistoricalSafe
        ? `${leakCount}/${programs.length} programs contain live-only features in ${mode} mode.`
        : null,
  };
}
