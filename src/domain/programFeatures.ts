export type BoatFeature = {
  course: number;
  registrationNo?: string;
  racerName?: string;
  className?: string;
  nationalWinRate?: number | null;
  nationalTop2Rate?: number | null;
  localWinRate?: number | null;
  localTop2Rate?: number | null;
  motorNo?: string | null;
  motorTop2Rate?: number | null;
  boatNo?: string | null;
  boatTop2Rate?: number | null;
  // racer_course_stats から注入（コース別期別統計）
  courseAvgSt?: number | null;
  courseTop3Rate?: number | null;
};

export type ProgramFeatureSnapshot = {
  boats: BoatFeature[];
};

export function extractProgramFeatures(raw: unknown): ProgramFeatureSnapshot {
  const maybe = raw as { boats?: unknown };
  const boats = Array.isArray(maybe?.boats)
    ? maybe.boats.map(toBoatFeature).filter((boat): boat is BoatFeature => boat != null)
    : [];
  return { boats };
}

export function featureAdjustmentForSelection(features: ProgramFeatureSnapshot | undefined, selection: number[]): number {
  const [firstCourse, secondCourse, thirdCourse] = selection;
  const firstBoat = features?.boats.find((boat) => boat.course === firstCourse);
  const secondBoat = features?.boats.find((boat) => boat.course === secondCourse);
  const thirdBoat = features?.boats.find((boat) => boat.course === thirdCourse);
  if (!firstBoat) return 1;

  // 1着候補（主要因子）
  const classFactor = classAdjustment(firstBoat.className);
  const nationalFactor = rateAdjustment(firstBoat.nationalWinRate, 6.0, 0.018);
  const localFactor = rateAdjustment(firstBoat.localWinRate, 6.0, 0.014);
  const motorFactor = rateAdjustment(firstBoat.motorTop2Rate, 35.0, 0.004);
  const boatFactor = rateAdjustment(firstBoat.boatTop2Rate, 35.0, 0.003);
  // コース別期別統計（racer_course_stats）
  // avg_st: 0.16前後が平均。小さいほど速い → プラス補正。scale小さめで様子見。
  const courseStFactor = firstBoat.courseAvgSt != null
    ? clamp(1 + (0.165 - firstBoat.courseAvgSt) * 2.0, 0.97, 1.03)
    : 1;
  // courseTop3Rate: 高いほど良い。33%前後が平均。
  const courseTop3Factor = firstBoat.courseTop3Rate != null
    ? clamp(1 + (firstBoat.courseTop3Rate - 33.0) * 0.002, 0.97, 1.03)
    : 1;

  // 2着候補（中程度の影響 ― 強い選手が2着に来るほど3連単が確実になる）
  const secondClassFactor = secondBoat ? supportClassAdjustment(secondBoat.className, 0.06) : 1;
  const secondLocalFactor = secondBoat ? rateAdjustment(secondBoat.localWinRate, 6.0, 0.006) : 1;

  // 3着候補（小さい影響）
  const thirdClassFactor = thirdBoat ? supportClassAdjustment(thirdBoat.className, 0.03) : 1;

  return clamp(
    classFactor * nationalFactor * localFactor * motorFactor * boatFactor
    * secondClassFactor * secondLocalFactor * thirdClassFactor
    * courseStFactor * courseTop3Factor,
    0.65, 1.40,
  );
}

function toBoatFeature(value: unknown): BoatFeature | null {
  const row = value as Record<string, unknown>;
  const course = Number(row.course);
  if (!Number.isFinite(course) || course < 1 || course > 6) return null;
  return {
    course,
    registrationNo: toText(row.registrationNo),
    racerName: toText(row.racerName),
    className: toText(row.className),
    nationalWinRate: toNullableNumber(row.nationalWinRate),
    nationalTop2Rate: toNullableNumber(row.nationalTop2Rate),
    localWinRate: toNullableNumber(row.localWinRate),
    localTop2Rate: toNullableNumber(row.localTop2Rate),
    motorNo: toText(row.motorNo),
    motorTop2Rate: toNullableNumber(row.motorTop2Rate),
    boatNo: toText(row.boatNo),
    boatTop2Rate: toNullableNumber(row.boatTop2Rate),
  };
}

function classAdjustment(className: string | undefined) {
  if (className === "A1") return 1.04;
  if (className === "A2") return 1.015;
  if (className === "B2") return 0.96;
  return 1;
}

// 2・3着候補の級別補正。magnitude で影響度を調整（1着より小さく）
function supportClassAdjustment(className: string | undefined, magnitude: number) {
  if (className === "A1") return 1 + magnitude;
  if (className === "A2") return 1 + magnitude * 0.4;
  if (className === "B2") return 1 - magnitude;
  return 1;
}

function rateAdjustment(value: number | null | undefined, baseline: number, scale: number) {
  if (value == null || !Number.isFinite(value)) return 1;
  return clamp(1 + (value - baseline) * scale, 0.94, 1.06);
}

function toText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toNullableNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
