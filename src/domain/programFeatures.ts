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
  const firstCourse = selection[0];
  const firstBoat = features?.boats.find((boat) => boat.course === firstCourse);
  if (!firstBoat) return 1;

  const classFactor = classAdjustment(firstBoat.className);
  const nationalFactor = rateAdjustment(firstBoat.nationalWinRate, 6.0, 0.018);
  const localFactor = rateAdjustment(firstBoat.localWinRate, 6.0, 0.014);
  const motorFactor = rateAdjustment(firstBoat.motorTop2Rate, 35.0, 0.004);
  const boatFactor = rateAdjustment(firstBoat.boatTop2Rate, 35.0, 0.003);
  return clamp(classFactor * nationalFactor * localFactor * motorFactor * boatFactor, 0.82, 1.18);
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
