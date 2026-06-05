/**
 * ROI向上候補の読み取り専用分析。
 *
 * 禁止事項:
 * - DBへの INSERT / UPDATE / DELETE なし
 * - app_settings 変更なし
 * - payout_yen はROI計算に使わない
 *
 * ROI定義:
 * - 対象: decision_history run_kind='historical-backfill' decision='BUY'
 * - ヒット: result = selection
 * - 1件100円想定、的中回収は current_odds * 100
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/roi-improvement-candidates.md";
const OUT_JSON = "reports/roi-improvement-candidates.json";
const MIN_OBSERVE_N = 50;
const MIN_CANDIDATE_N = 100;
const STRONG_N = 300;

type RawDecision = {
  id: number;
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  selection: string;
  estimated_hit_rate: number | null;
  raw_estimated_hit_rate: number | null;
  conservative_hit_rate: number | null;
  model_selection_score: number | null;
  required_odds: number | null;
  current_odds: number;
  ev: number | null;
  result: string | null;
  sample_size: number | null;
  model_version: string | null;
  race_category: string | null;
  sharp_signal_drop: number | null;
  environment_risk_level: string | null;
  exhibition_st_residual_sum: number | null;
  selection_popularity: number | null;
  decision_reasons: string | null;
  feature_adjustment: number | null;
  feature_adjustment_breakdown: string | null;
};

type CourseFeature = {
  exhibitionTime: number | null;
  exhibitionRank: number | null;
  exhibitionSt: number | null;
  tilt: number | null;
  partsChangedCount: number;
  motorTop2Rate: number | null;
  boatTop2Rate: number | null;
  flyingCount: number | null;
  lateStartCount: number | null;
  racerTop3Rate: number | null;
  racerAvgSt: number | null;
  courseRaces: number | null;
  courseWinRate: number | null;
  courseTop3Rate: number | null;
  courseAvgSt: number | null;
  courseStartOrder: number | null;
  finishPos: number | null;
};

type RaceFeature = {
  weather: string | null;
  windMps: number | null;
  waveCm: number | null;
  stablePlate: boolean | null;
  raceType: string | null;
  kimarite: string | null;
  course: Map<number, CourseFeature>;
};

type Row = {
  id: number;
  raceId: string;
  date: string;
  ym: string;
  venue: string;
  raceNo: number;
  selection: string;
  selectionNums: number[];
  result: string;
  resultNums: number[];
  hit: boolean;
  currentOdds: number;
  estimatedHitRate: number | null;
  requiredHitRate: number;
  realizedEdge: number | null;
  evActual: number | null;
  modelEv: number | null;
  score: number | null;
  confidence: number | null;
  sampleSize: number | null;
  modelVersion: string | null;
  raceCategory: string | null;
  sharpSignalDrop: number | null;
  environmentRiskLevel: string | null;
  selectionPopularity: number | null;
  decisionReasons: string[];
  featureAdjustment: number | null;
  featureBreakdown: unknown;
  weatherPresent: boolean;
  exhibitionPresent: boolean;
  equipmentPresent: boolean;
  motorPresent: boolean;
  boatPresent: boolean;
  fPresent: boolean;
  weather: string | null;
  windMps: number | null;
  waveCm: number | null;
  stablePlate: boolean | null;
  raceType: string | null;
  kimarite: string | null;
  headExhibitionRank: number | null;
  headExhibitionTime: number | null;
  headExhibitionSt: number | null;
  bestExhibitionRankInSelection: number | null;
  includesExhibitionTop1: boolean | null;
  includesExhibitionTop2: boolean | null;
  exhibitionSpread: number | null;
  selectedAvgExhibitionRank: number | null;
  selectedSlowStCount: number | null;
  selectedPartsChangedCount: number;
  selectedTiltNonZeroCount: number;
  selectedTiltExtremeCount: number;
  selectedMotorTopCount: number;
  selectedMotorLowCount: number;
  headMotorTop2Rate: number | null;
  headBoatTop2Rate: number | null;
  headFlyingCount: number | null;
  attackFlyingCount: number;
  raceFlyingCount: number;
  headCourseWinRate: number | null;
  headCourseTop3Rate: number | null;
  headCourseAvgSt: number | null;
};

type Metric = {
  n: number;
  hits: number;
  hitRate: number;
  avgOdds: number;
  roi: number;
  ev: number;
  maxHitOdds: number;
  roiExMaxHit: number;
};

type Candidate = {
  kind: string;
  label: string;
  condition: string;
  prefer: Condition["prefer"];
  n: number;
  before: Metric;
  after: Metric;
  removed: Metric;
  train: Metric;
  validation: Metric;
  test: Metric;
  monthlyStability: string;
  risk: string;
  difficulty: string;
  recommendation: "S" | "A" | "B" | "C" | "D";
  comment: string;
};

type Condition = {
  kind: string;
  label: string;
  condition: string;
  fn: (row: Row) => boolean;
  risk?: string;
  difficulty?: string;
  prefer?: "remove" | "keep" | "observe";
};

if (!existsSync(DB_PATH)) {
  console.error(`[analyze-roi-candidates] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

try {
  const rows = loadRows();
  const splits = splitRows(rows);
  const before = metric(rows);
  const conditions = buildConditions(rows);
  const candidates = conditions.map((condition) => evaluateCondition(condition, rows, splits));
  const removalCandidates = candidates
    .filter((c) => c.prefer === "remove" && c.removed.n >= MIN_OBSERVE_N && c.after.n >= STRONG_N)
    .sort((a, b) => (b.after.roi - b.before.roi) - (a.after.roi - a.before.roi) || b.removed.n - a.removed.n);
  const strongKeeps = candidates
    .filter((c) => c.removed.n >= MIN_OBSERVE_N)
    .sort((a, b) => b.removed.roi - a.removed.roi || b.removed.n - a.removed.n);

  const grouped = {
    overall: before,
    period: { minDate: rows[0]?.date ?? null, maxDate: rows.at(-1)?.date ?? null },
    dataCoverage: dataCoverage(rows),
    currentBreakdowns: {
      monthly: groupMetrics(rows, (r) => r.ym, 1).slice(0, 40),
      dailyWorst: groupMetrics(rows, (r) => r.date, 5).sort((a, b) => a.metric.roi - b.metric.roi).slice(0, 30),
      venue: groupMetrics(rows, (r) => r.venue, 30),
      raceNo: groupMetrics(rows, (r) => `${r.raceNo}R`, 30),
      oddsBand: groupMetrics(rows, (r) => oddsBand(r.currentOdds), 30),
      selectionPattern: groupMetrics(rows, selectionPattern, 20),
      confidenceBand: groupMetrics(rows, (r) => numericBand(r.confidence, [0.05, 0.08, 0.1, 0.12, 0.15], "confidence"), 30),
      scoreBand: groupMetrics(rows, (r) => numericBand(r.score, [0.03, 0.05, 0.08, 0.1, 0.12], "score"), 30),
      edgeBand: groupMetrics(rows, (r) => numericBand(r.realizedEdge, [-0.05, 0, 0.03, 0.06, 0.1], "edge"), 30),
      reason: reasonMetrics(rows, 30),
      dataPresence: groupMetrics(rows, dataPresenceKey, 30),
    },
    topCauses: topCauses(candidates),
    removalCandidates: removalCandidates.slice(0, 80),
    strongKeeps: strongKeeps.slice(0, 80),
    splitValidation: removalCandidates.slice(0, 40).map(splitValidationRow),
    venueSuggestions: venueSuggestions(rows, candidates),
    raceNoSuggestions: raceNoSuggestions(rows, candidates),
    sharpIdeas: sharpIdeas(),
    appSettingsIdeas: appSettingsIdeas(removalCandidates),
    roadmap: roadmap(removalCandidates, strongKeeps),
  };

  mkdirSync("reports", { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify({ generatedAt: new Date().toISOString(), dbPath: DB_PATH, ...grouped }, null, 2)}\n`);
  writeFileSync(OUT_MD, renderMarkdown(grouped));
  console.log(`[analyze-roi-candidates] wrote ${OUT_MD}`);
  console.log(`[analyze-roi-candidates] wrote ${OUT_JSON}`);
  console.log(`[analyze-roi-candidates] BUY n=${before.n} hit=${before.hits} hitRate=${pct(before.hitRate)} avgOdds=${num(before.avgOdds)} ROI=${pct(before.roi / 100)}`);
} finally {
  db.close();
}

function loadRows(): Row[] {
  const decisions = db.prepare(`
SELECT
  id, race_id, date, venue, race_no, selection,
  estimated_hit_rate, raw_estimated_hit_rate, conservative_hit_rate, model_selection_score,
  required_odds, current_odds, ev, result, sample_size, model_version, race_category,
  sharp_signal_drop, environment_risk_level, exhibition_st_residual_sum,
  selection_popularity, decision_reasons, feature_adjustment, feature_adjustment_breakdown
FROM decision_history
WHERE run_kind = 'historical-backfill'
  AND decision = 'BUY'
  AND current_odds IS NOT NULL
  AND result IS NOT NULL
ORDER BY date, id
`).all() as RawDecision[];

  const raceIds = [...new Set(decisions.map((r) => r.race_id))];
  const features = loadRaceFeatures(raceIds);

  return decisions.map((d) => enrichRow(d, features.get(d.race_id))).filter((row): row is Row => row != null);
}

function loadRaceFeatures(raceIds: string[]): Map<string, RaceFeature> {
  const map = new Map<string, RaceFeature>();
  for (const raceId of raceIds) map.set(raceId, { weather: null, windMps: null, waveCm: null, stablePlate: null, raceType: null, kimarite: null, course: new Map() });

  for (const ids of chunks(raceIds, 400)) {
    const placeholders = ids.map(() => "?").join(",");
    for (const row of db.prepare(`
SELECT
  COALESCE(rw.race_id, rc.race_id) AS race_id,
  COALESCE(rw.weather, rc.weather) AS weather,
  COALESCE(rw.wind_speed_mps, rc.wind_mps) AS wind_mps,
  COALESCE(rw.wave_height_cm, rc.wave_cm) AS wave_cm,
  rw.stable_plate,
  rc.race_type,
  rc.kimarite
FROM race_weather rw
LEFT JOIN race_conditions rc ON rc.race_id = rw.race_id
WHERE rw.race_id IN (${placeholders})
UNION
SELECT
  rc.race_id,
  COALESCE(rw.weather, rc.weather) AS weather,
  COALESCE(rw.wind_speed_mps, rc.wind_mps) AS wind_mps,
  COALESCE(rw.wave_height_cm, rc.wave_cm) AS wave_cm,
  rw.stable_plate,
  rc.race_type,
  rc.kimarite
FROM race_conditions rc
LEFT JOIN race_weather rw ON rw.race_id = rc.race_id
WHERE rc.race_id IN (${placeholders})
`).all(...ids, ...ids) as Array<{ race_id: string; weather: string | null; wind_mps: number | null; wave_cm: number | null; stable_plate: number | null; race_type: string | null; kimarite: string | null }>) {
      const f = map.get(row.race_id);
      if (!f) continue;
      f.weather = row.weather;
      f.windMps = nullableNumber(row.wind_mps);
      f.waveCm = nullableNumber(row.wave_cm);
      f.stablePlate = row.stable_plate == null ? null : Number(row.stable_plate) === 1;
      f.raceType = row.race_type;
      f.kimarite = row.kimarite;
    }

    for (const row of db.prepare(`
SELECT
  ent.race_id,
  ent.boat AS course,
  COALESCE(ed.exhibition_time, ent.exhibition_time) AS exhibition_time,
  ed.ranking,
  COALESCE(ed.start_timing, ent.st) AS start_timing,
  req.tilt_angle,
  req.parts_changed_count,
  mbs.motor_top2_rate,
  mbs.boat_top2_rate,
  ent.finish_pos,
  rp.flying_count,
  rp.late_start_count,
  rp.top3_rate AS racer_top3_rate,
  rp.avg_st AS racer_avg_st,
  rcs.races AS course_races,
  rcs.win_rate AS course_win_rate,
  rcs.top3_rate AS course_top3_rate,
  rcs.avg_st AS course_avg_st,
  rcs.start_order AS course_start_order
FROM race_entries ent
LEFT JOIN exhibition_data ed ON ed.race_id = ent.race_id AND ed.course = ent.boat
LEFT JOIN race_equipment req ON req.race_id = ent.race_id AND req.course = ent.boat
LEFT JOIN motor_boat_stats mbs ON mbs.race_id = ent.race_id AND mbs.course = ent.boat
LEFT JOIN racer_profiles rp ON rp.registration_no = ent.racer_reg
LEFT JOIN racer_course_stats rcs ON rcs.registration_no = ent.racer_reg AND rcs.course = ent.boat
WHERE ent.race_id IN (${placeholders})
`).all(...ids) as Array<Record<string, unknown>>) {
      mergeCourseFeature(map, row);
    }

    for (const row of db.prepare(`
SELECT
  ed.race_id,
  ed.course,
  ed.exhibition_time,
  ed.ranking,
  ed.start_timing,
  req.tilt_angle,
  req.parts_changed_count,
  mbs.motor_top2_rate,
  mbs.boat_top2_rate
FROM exhibition_data ed
LEFT JOIN race_equipment req ON req.race_id = ed.race_id AND req.course = ed.course
LEFT JOIN motor_boat_stats mbs ON mbs.race_id = ed.race_id AND mbs.course = ed.course
WHERE ed.race_id IN (${placeholders})
`).all(...ids) as Array<Record<string, unknown>>) {
      mergeCourseFeature(map, row);
    }
  }

  return map;
}

function mergeCourseFeature(map: Map<string, RaceFeature>, row: Record<string, unknown>) {
  const raceId = String(row.race_id ?? "");
  const course = Number(row.course);
  const f = map.get(raceId);
  if (!f || !Number.isFinite(course)) return;
  const current = f.course.get(course);
  f.course.set(course, {
    exhibitionTime: nullableNumber(row.exhibition_time) ?? current?.exhibitionTime ?? null,
    exhibitionRank: nullableNumber(row.ranking) ?? current?.exhibitionRank ?? null,
    exhibitionSt: nullableNumber(row.start_timing) ?? current?.exhibitionSt ?? null,
    tilt: nullableNumber(row.tilt_angle) ?? current?.tilt ?? null,
    partsChangedCount: Number(row.parts_changed_count ?? current?.partsChangedCount ?? 0),
    motorTop2Rate: nullableNumber(row.motor_top2_rate) ?? current?.motorTop2Rate ?? null,
    boatTop2Rate: nullableNumber(row.boat_top2_rate) ?? current?.boatTop2Rate ?? null,
    flyingCount: nullableNumber(row.flying_count) ?? current?.flyingCount ?? null,
    lateStartCount: nullableNumber(row.late_start_count) ?? current?.lateStartCount ?? null,
    racerTop3Rate: nullableNumber(row.racer_top3_rate) ?? current?.racerTop3Rate ?? null,
    racerAvgSt: nullableNumber(row.racer_avg_st) ?? current?.racerAvgSt ?? null,
    courseRaces: nullableNumber(row.course_races) ?? current?.courseRaces ?? null,
    courseWinRate: nullableNumber(row.course_win_rate) ?? current?.courseWinRate ?? null,
    courseTop3Rate: nullableNumber(row.course_top3_rate) ?? current?.courseTop3Rate ?? null,
    courseAvgSt: nullableNumber(row.course_avg_st) ?? current?.courseAvgSt ?? null,
    courseStartOrder: nullableNumber(row.course_start_order) ?? current?.courseStartOrder ?? null,
    finishPos: nullableNumber(row.finish_pos) ?? current?.finishPos ?? null,
  });
}

function enrichRow(d: RawDecision, race: RaceFeature | undefined): Row | null {
  const selectionNums = parseSelection(d.selection);
  const resultNums = parseSelection(d.result ?? "");
  if (selectionNums.length !== 3 || resultNums.length !== 3) return null;
  const courseEntries = [...(race?.course.entries() ?? [])];
  const courseRows = courseEntries.map(([, feature]) => feature);
  const derivedExhibitionRanks = deriveExhibitionRanks(courseEntries);
  const selected = selectionNums
    .map((n) => ({ course: n, feature: race?.course.get(n) }))
    .filter((x): x is { course: number; feature: CourseFeature } => Boolean(x.feature));
  const head = race?.course.get(selectionNums[0]);
  const exhibitionRanks = courseEntries.map(([course, c]) => c.exhibitionRank ?? derivedExhibitionRanks.get(course) ?? null).filter(isNumber);
  const exhibitionTimes = courseRows.map((c) => c.exhibitionTime).filter(isNumber);
  const selectedRanks = selected.map(({ course, feature }) => feature.exhibitionRank ?? derivedExhibitionRanks.get(course) ?? null).filter(isNumber);
  const stValues = courseRows.map((c) => c.exhibitionSt).filter(isNumber);
  const avgSt = stValues.length ? stValues.reduce((a, b) => a + b, 0) / stValues.length : null;
  const confidence = d.conservative_hit_rate ?? d.estimated_hit_rate ?? null;
  const requiredHitRate = 1 / Number(d.current_odds);
  const realizedEdge = confidence == null ? null : confidence - requiredHitRate;
  let featureBreakdown: unknown = null;
  try {
    featureBreakdown = d.feature_adjustment_breakdown ? JSON.parse(d.feature_adjustment_breakdown) : null;
  } catch {
    featureBreakdown = null;
  }

  return {
    id: d.id,
    raceId: d.race_id,
    date: d.date,
    ym: d.date.slice(0, 7),
    venue: d.venue,
    raceNo: d.race_no,
    selection: d.selection,
    selectionNums,
    result: d.result ?? "",
    resultNums,
    hit: d.result === d.selection,
    currentOdds: Number(d.current_odds),
    estimatedHitRate: d.estimated_hit_rate == null ? null : Number(d.estimated_hit_rate),
    requiredHitRate,
    realizedEdge,
    evActual: confidence == null ? null : confidence * Number(d.current_odds) - 1,
    modelEv: d.ev == null ? null : Number(d.ev),
    score: d.model_selection_score == null ? null : Number(d.model_selection_score),
    confidence,
    sampleSize: nullableNumber(d.sample_size),
    modelVersion: d.model_version,
    raceCategory: d.race_category,
    sharpSignalDrop: nullableNumber(d.sharp_signal_drop),
    environmentRiskLevel: d.environment_risk_level,
    selectionPopularity: nullableNumber(d.selection_popularity),
    decisionReasons: parseReasons(d.decision_reasons),
    featureAdjustment: nullableNumber(d.feature_adjustment),
    featureBreakdown,
    weatherPresent: race?.windMps != null || race?.waveCm != null || race?.weather != null,
    exhibitionPresent: exhibitionRanks.length >= 3 || exhibitionTimes.length >= 3 || stValues.length >= 3,
    equipmentPresent: courseRows.some((c) => c.tilt != null || c.partsChangedCount > 0),
    motorPresent: courseRows.some((c) => c.motorTop2Rate != null),
    boatPresent: courseRows.some((c) => c.boatTop2Rate != null),
    fPresent: courseRows.some((c) => c.flyingCount != null),
    weather: race?.weather ?? null,
    windMps: race?.windMps ?? null,
    waveCm: race?.waveCm ?? null,
    stablePlate: race?.stablePlate ?? null,
    raceType: race?.raceType ?? null,
    kimarite: race?.kimarite ?? null,
    headExhibitionRank: head?.exhibitionRank ?? derivedExhibitionRanks.get(selectionNums[0]) ?? null,
    headExhibitionTime: head?.exhibitionTime ?? null,
    headExhibitionSt: head?.exhibitionSt ?? null,
    bestExhibitionRankInSelection: selectedRanks.length ? Math.min(...selectedRanks) : null,
    includesExhibitionTop1: exhibitionRanks.length ? selectedRanks.includes(1) : null,
    includesExhibitionTop2: exhibitionRanks.length ? selectedRanks.some((r) => r <= 2) : null,
    exhibitionSpread: exhibitionTimes.length >= 2 ? Math.max(...exhibitionTimes) - Math.min(...exhibitionTimes) : null,
    selectedAvgExhibitionRank: selectedRanks.length ? selectedRanks.reduce((a, b) => a + b, 0) / selectedRanks.length : null,
    selectedSlowStCount: avgSt == null ? null : selected.filter(({ feature }) => feature.exhibitionSt != null && feature.exhibitionSt > avgSt).length,
    selectedPartsChangedCount: selected.reduce((sum, { feature }) => sum + feature.partsChangedCount, 0),
    selectedTiltNonZeroCount: selected.filter(({ feature }) => feature.tilt != null && Math.abs(feature.tilt) > 0.001).length,
    selectedTiltExtremeCount: selected.filter(({ feature }) => feature.tilt != null && Math.abs(feature.tilt) >= 1).length,
    selectedMotorTopCount: selected.filter(({ feature }) => feature.motorTop2Rate != null && feature.motorTop2Rate >= 40).length,
    selectedMotorLowCount: selected.filter(({ feature }) => feature.motorTop2Rate != null && feature.motorTop2Rate < 25).length,
    headMotorTop2Rate: head?.motorTop2Rate ?? null,
    headBoatTop2Rate: head?.boatTop2Rate ?? null,
    headFlyingCount: head?.flyingCount ?? null,
    attackFlyingCount: [selectionNums[1], selectionNums[2]].filter((n) => (race?.course.get(n)?.flyingCount ?? 0) > 0).length,
    raceFlyingCount: courseRows.filter((c) => (c.flyingCount ?? 0) > 0).length,
    headCourseWinRate: head?.courseWinRate ?? null,
    headCourseTop3Rate: head?.courseTop3Rate ?? null,
    headCourseAvgSt: head?.courseAvgSt ?? null,
  };
}

function deriveExhibitionRanks(entries: Array<[number, CourseFeature]>) {
  const ranked = entries
    .filter(([, feature]) => feature.exhibitionTime != null)
    .sort((a, b) => Number(a[1].exhibitionTime) - Number(b[1].exhibitionTime));
  return new Map(ranked.map(([course], index) => [course, index + 1]));
}

function buildConditions(rows: Row[]): Condition[] {
  const conditions: Condition[] = [
    ...unique(rows.map((r) => r.venue)).map((venue) => condition("除外候補", `会場=${venue}`, `venue = ${venue}`, (r) => r.venue === venue)),
    ...unique(rows.map((r) => r.raceNo)).sort((a, b) => a - b).map((raceNo) => condition("除外候補", `${raceNo}R`, `race_no = ${raceNo}`, (r) => r.raceNo === raceNo)),
    ...unique(rows.map((r) => `${r.venue} ${r.raceNo}R`)).map((key) => {
      const [venue, race] = key.split(" ");
      const raceNo = Number(race.replace("R", ""));
      return condition("除外候補", key, `venue=${venue} AND race_no=${raceNo}`, (r) => r.venue === venue && r.raceNo === raceNo, "会場×Rは過学習注意");
    }),
    ...unique(rows.map(selectionPattern)).map((key) => condition("除外候補", `selectionパターン=${key}`, `selection_pattern = ${key}`, (r) => selectionPattern(r) === key)),
    ...unique(rows.map((r) => r.selection)).map((sel) => condition("監視候補", `selection=${sel}`, `selection = ${sel}`, (r) => r.selection === sel, "単一出目は過学習注意", "低")),
    ...unique(rows.map((r) => `${r.venue} ${selectionPattern(r)}`)).map((key) => {
      const idx = key.indexOf(" ");
      const venue = key.slice(0, idx);
      const pattern = key.slice(idx + 1);
      return condition("監視候補", key, `venue=${venue} AND selection_pattern=${pattern}`, (r) => r.venue === venue && selectionPattern(r) === pattern, "会場×出目は過学習注意");
    }),
    ...unique(rows.map((r) => `${r.raceNo}R ${selectionPattern(r)}`)).map((key) => {
      const [race, pattern] = key.split(" ");
      const raceNo = Number(race.replace("R", ""));
      return condition("監視候補", key, `race_no=${raceNo} AND selection_pattern=${pattern}`, (r) => r.raceNo === raceNo && selectionPattern(r) === pattern, "R×出目は過学習注意");
    }),

    condition("除外候補", "current_odds < 3", "current_odds < 3", (r) => r.currentOdds < 3, "低oddsは必要的中率が高く、母数が必要"),
    condition("除外候補", "current_odds < 4", "current_odds < 4", (r) => r.currentOdds < 4),
    condition("除外候補", "current_odds 4-10", "4 <= current_odds < 10", (r) => r.currentOdds >= 4 && r.currentOdds < 10),
    condition("除外候補", "current_odds >= 30", "current_odds >= 30", (r) => r.currentOdds >= 30, "高配当1発依存に注意"),
    condition("除外候補", "current_odds >= 50", "current_odds >= 50", (r) => r.currentOdds >= 50, "高配当・過学習危険"),
    condition("監視候補", "edge候補 < 0", "confidence - 1/current_odds < 0", (r) => (r.realizedEdge ?? 0) < 0),
    condition("監視候補", "edge候補 > 0.08", "confidence - 1/current_odds > 0.08", (r) => (r.realizedEdge ?? -99) > 0.08, "モデル過信・異常値の危険"),
    condition("監視候補", "model EV > 2.0", "ev > 2.0", (r) => (r.modelEv ?? 0) > 2, "美味しすぎるBUY疑い"),
    condition("除外候補", "score低位 <0.05", "model_selection_score < 0.05", (r) => r.score != null && r.score < 0.05),
    condition("監視候補", "confidence高位 >=0.12", "confidence >= 0.12", (r) => (r.confidence ?? 0) >= 0.12, "高confidenceが人気に織り込まれている可能性"),

    condition("除外候補", "展示欠損", "展示データ不足", (r) => !r.exhibitionPresent, "欠損除外は過学習しにくい"),
    condition("除外候補", "天候欠損", "天候データ不足", (r) => !r.weatherPresent, "欠損除外は過学習しにくい"),
    condition("除外候補", "モーター欠損", "モーター情報不足", (r) => !r.motorPresent, "欠損除外は過学習しにくい"),
    condition("除外候補", "ボート欠損", "ボート情報不足", (r) => !r.boatPresent, "欠損除外は過学習しにくい"),
    condition("除外候補", "F情報欠損", "F情報不足", (r) => !r.fPresent, "欠損除外は過学習しにくい"),
    condition("除外候補", "展示1位を含まない", "selectionに展示1位なし", (r) => r.includesExhibitionTop1 === false),
    condition("除外候補", "展示1/2位を含まない", "selectionに展示1-2位なし", (r) => r.includesExhibitionTop2 === false),
    condition("除外候補", "頭が展示4位以下", "selection頭の展示順位 >= 4", (r) => (r.headExhibitionRank ?? 0) >= 4),
    condition("除外候補", "頭が展示5位以下", "selection頭の展示順位 >= 5", (r) => (r.headExhibitionRank ?? 0) >= 5),
    condition("除外候補", "展示差が小さい", "展示タイムspread < 0.10", (r) => r.exhibitionSpread != null && r.exhibitionSpread < 0.1, "予測困難仮説。会場差に注意"),
    condition("加点候補", "展示差が大きい", "展示タイムspread >= 0.30", (r) => r.exhibitionSpread != null && r.exhibitionSpread >= 0.3, "高配当1発に注意", "低", "keep"),
    condition("除外候補", "選択艇に展示ST遅れあり", "選択艇の展示STが平均より遅い艇あり", (r) => (r.selectedSlowStCount ?? 0) > 0),

    condition("除外候補", "1号艇F持ちで1頭", "1号艇F持ち AND selection頭=1", (r) => r.selectionNums[0] === 1 && (r.headFlyingCount ?? 0) > 0),
    condition("除外候補", "攻め艇F持ちを含む", "2/3着候補にF持ちあり", (r) => r.attackFlyingCount > 0),
    condition("除外候補", "F持ち複数レース", "race flying_count > 1", (r) => r.raceFlyingCount > 1),
    condition("監視候補", "Fなしレース", "race flying_count = 0", (r) => r.fPresent && r.raceFlyingCount === 0, undefined, "低", "keep"),

    condition("除外候補", "風速 >= 5m", "wind_mps >= 5", (r) => (r.windMps ?? -1) >= 5),
    condition("除外候補", "風速 >= 8m", "wind_mps >= 8", (r) => (r.windMps ?? -1) >= 8),
    condition("除外候補", "波高 >= 5cm", "wave_cm >= 5", (r) => (r.waveCm ?? -1) >= 5),
    condition("除外候補", "安定板あり", "stable_plate = 1", (r) => r.stablePlate === true),
    condition("除外候補", "荒天リスクhigh", "environment_risk_level = high", (r) => r.environmentRiskLevel === "high"),
    condition("除外候補", "風>=5 かつ展示1位なし", "wind>=5 AND selectionに展示1位なし", (r) => (r.windMps ?? -1) >= 5 && r.includesExhibitionTop1 === false),

    condition("除外候補", "選択艇に部品交換あり", "selection parts_changed_count > 0", (r) => r.selectedPartsChangedCount > 0),
    condition("監視候補", "選択艇にチルト0以外", "selection tilt != 0", (r) => r.selectedTiltNonZeroCount > 0, "チルトは攻め仕様にもなるため単純除外は危険"),
    condition("監視候補", "選択艇にチルト極端値", "selection abs(tilt) >= 1", (r) => r.selectedTiltExtremeCount > 0, "n不足・尖りすぎ注意"),
    condition("除外候補", "頭モーター上位だが展示下位", "head motor>=40 AND head exhibition rank>=4", (r) => (r.headMotorTop2Rate ?? 0) >= 40 && (r.headExhibitionRank ?? 0) >= 4),
    condition("加点候補", "頭モーター上位かつ展示上位", "head motor>=40 AND head exhibition rank<=2", (r) => (r.headMotorTop2Rate ?? 0) >= 40 && (r.headExhibitionRank ?? 99) <= 2, undefined, "低", "keep"),
    condition("加点候補", "選択艇モーター上位を含む", "selection motor>=40", (r) => r.selectedMotorTopCount > 0, undefined, "低", "keep"),
    condition("除外候補", "選択艇モーター下位を含む", "selection motor<25", (r) => r.selectedMotorLowCount > 0),

    condition("除外候補", "4/5/6絡み", "selection contains 4/5/6", (r) => r.selectionNums.some((n) => n >= 4)),
    condition("除外候補", "頭が1以外", "selection first != 1", (r) => r.selectionNums[0] !== 1),
    condition("除外候補", "1頭固定", "selection first = 1", (r) => r.selectionNums[0] === 1),
    condition("監視候補", "2着3着逆の惜しい外れ", "result = head-third-second", (r) => !r.hit && r.result === `${r.selectionNums[0]}-${r.selectionNums[2]}-${r.selectionNums[1]}`, "事後診断。レース前除外ルールには使えない", "低", "observe"),
    condition("監視候補", "頭だけ一致", "result first = selection first", (r) => !r.hit && r.resultNums[0] === r.selectionNums[0], "事後診断。2/3着改善余地を見るだけ", "低", "observe"),
    condition("監視候補", "1着2着だけ一致", "result first-second = selection first-second", (r) => !r.hit && r.resultNums[0] === r.selectionNums[0] && r.resultNums[1] === r.selectionNums[1], "事後診断。3着改善余地を見るだけ", "低", "observe"),
    condition("除外候補", "人気1-5位", "selection_popularity <= 5", (r) => (r.selectionPopularity ?? 999) <= 5, "人気過剰の可能性"),
    condition("監視候補", "人気30位以下", "selection_popularity >= 30", (r) => (r.selectionPopularity ?? 0) >= 30, "高配当1発依存に注意"),
    condition("除外候補", "シャープマネー逆行15%以上", "sharp_signal_drop >= 0.15", (r) => (r.sharpSignalDrop ?? 0) >= 0.15),
  ];

  for (const venue of unique(rows.map((r) => r.venue))) {
    conditions.push(condition("監視候補", `${venue} 風>=5`, `venue=${venue} AND wind>=5`, (r) => r.venue === venue && (r.windMps ?? -1) >= 5, "会場×天候は過学習注意"));
    conditions.push(condition("監視候補", `${venue} 1頭`, `venue=${venue} AND first=1`, (r) => r.venue === venue && r.selectionNums[0] === 1, "会場×コースはn確認必須"));
    conditions.push(condition("監視候補", `${venue} 1頭以外`, `venue=${venue} AND first!=1`, (r) => r.venue === venue && r.selectionNums[0] !== 1, "会場×コースはn確認必須"));
    conditions.push(condition("監視候補", `${venue} 展示1位なし`, `venue=${venue} AND no exhibition top1`, (r) => r.venue === venue && r.includesExhibitionTop1 === false, "会場×展示は過学習注意"));
  }

  for (const reason of unique(rows.flatMap((r) => r.decisionReasons))) {
    conditions.push(condition("減点候補", `BUY理由=${reason}`, `decision_reasons contains ${reason}`, (r) => r.decisionReasons.includes(reason), "理由はロジック由来で相関が強い"));
  }

  return conditions;
}

function condition(kind: string, label: string, sqlCondition: string, fn: (row: Row) => boolean, risk = "中", difficulty = "低", prefer: Condition["prefer"] = "remove"): Condition {
  return { kind, label, condition: sqlCondition, fn, risk, difficulty, prefer };
}

function evaluateCondition(condition: Condition, rows: Row[], splits: ReturnType<typeof splitRows>): Candidate {
  const removedRows = rows.filter(condition.fn);
  const afterRows = rows.filter((row) => !condition.fn(row));
  const removed = metric(removedRows);
  const after = metric(afterRows);
  const train = metric(splits.train.filter(condition.fn));
  const validation = metric(splits.validation.filter(condition.fn));
  const test = metric(splits.test.filter(condition.fn));
  const before = metric(rows);
  const stability = monthlyStability(removedRows);
  const fakeRisk = fakeEdgeRisk(removed, stability);
  const risk = [condition.risk ?? "中", fakeRisk].filter(Boolean).join(" / ");
  return {
    kind: condition.kind,
    label: condition.label,
    condition: condition.condition,
    prefer: condition.prefer,
    n: removed.n,
    before,
    after,
    removed,
    train,
    validation,
    test,
    monthlyStability: stability.label,
    risk,
    difficulty: condition.difficulty ?? "低",
    recommendation: recommend(condition, before, after, removed, train, validation, test, stability),
    comment: commentFor(condition, before, after, removed, stability),
  };
}

function metric(rows: Row[]): Metric {
  const n = rows.length;
  const hits = rows.filter((r) => r.hit).length;
  const hitOdds = rows.filter((r) => r.hit).map((r) => r.currentOdds).sort((a, b) => b - a);
  const returnOdds = hitOdds.reduce((a, b) => a + b, 0);
  const returnOddsExMax = hitOdds.slice(1).reduce((a, b) => a + b, 0);
  const avgOdds = n ? rows.reduce((sum, r) => sum + r.currentOdds, 0) / n : 0;
  const hitRate = n ? hits / n : 0;
  const roi = n ? (returnOdds / n) * 100 : 0;
  return {
    n,
    hits,
    hitRate,
    avgOdds,
    roi,
    ev: hitRate * avgOdds - 1,
    maxHitOdds: hitOdds[0] ?? 0,
    roiExMaxHit: n ? (returnOddsExMax / n) * 100 : 0,
  };
}

function splitRows(rows: Row[]) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const trainEnd = Math.floor(sorted.length * 0.7);
  const validationEnd = Math.floor(sorted.length * 0.9);
  return {
    train: sorted.slice(0, trainEnd),
    validation: sorted.slice(trainEnd, validationEnd),
    test: sorted.slice(validationEnd),
  };
}

function monthlyStability(rows: Row[]) {
  const monthly = groupMetrics(rows, (r) => r.ym, 20);
  const good = monthly.filter((m) => m.metric.roi >= 100).length;
  const bad = monthly.filter((m) => m.metric.roi < 80).length;
  const label = monthly.length === 0
    ? "n不足"
    : `${good}/${monthly.length}ヶ月がROI>=100、${bad}ヶ月がROI<80`;
  return { monthly, label, good, bad };
}

function recommend(condition: Condition, before: Metric, after: Metric, removed: Metric, train: Metric, validation: Metric, test: Metric, stability: ReturnType<typeof monthlyStability>): Candidate["recommendation"] {
  if (removed.n < MIN_OBSERVE_N) return "C";
  if (removed.hits <= 2 && removed.roi > 120) return "D";
  if (condition.prefer === "observe") return removed.n >= MIN_OBSERVE_N ? "B" : "C";
  if (condition.prefer === "keep") {
    if (removed.n >= STRONG_N && removed.roi >= 100 && train.roi >= 90 && validation.roi >= 90 && (test.n < 50 || test.roi >= 80)) return "A";
    if (removed.n >= MIN_OBSERVE_N && removed.roi >= 100) return "B";
    return "C";
  }
  if (after.n < STRONG_N) return "C";
  const lift = after.roi - before.roi;
  if (removed.n >= STRONG_N && removed.roi < 70 && lift >= 5 && train.roi < 90 && validation.roi < 90 && (test.n < 50 || test.roi < 100)) return "S";
  if (removed.n >= MIN_CANDIDATE_N && removed.roi < before.roi && lift >= 2 && validation.n >= 20) return "A";
  if (removed.n >= MIN_OBSERVE_N && removed.roi < before.roi) return "B";
  if (removed.n < MIN_CANDIDATE_N) return "C";
  if (stability.monthly.length > 0 && stability.good <= 1 && removed.roi > 120) return "D";
  return "C";
}

function fakeEdgeRisk(metricValue: Metric, stability: ReturnType<typeof monthlyStability>): string {
  const risks: string[] = [];
  if (metricValue.n < MIN_OBSERVE_N) risks.push("偽edge疑い:n<50");
  if (metricValue.hits <= 2 && metricValue.roi > 100) risks.push("偽edge疑い:的中1-2件依存");
  if (metricValue.avgOdds >= 40) risks.push("偽edge疑い:平均odds極端");
  if (metricValue.roi >= 120 && metricValue.roiExMaxHit < 80) risks.push("偽edge疑い:最大1hit依存");
  if (stability.monthly.length >= 3 && stability.good <= 1 && metricValue.roi >= 100) risks.push("偽edge疑い:月別偏り");
  return risks.join(" / ");
}

function commentFor(condition: Condition, before: Metric, after: Metric, removed: Metric, stability: ReturnType<typeof monthlyStability>): string {
  const lift = after.roi - before.roi;
  if (condition.prefer === "keep") return `残す条件として検証。条件ROI=${pct(removed.roi / 100)}、最大1hit除外ROI=${pct(removed.roiExMaxHit / 100)}。`;
  if (removed.n < MIN_OBSERVE_N) return "n<50のため採用せず観察候補。";
  if (lift > 0) return `除外すると残りROIが${pct(lift / 100)}改善。removed ROI=${pct(removed.roi / 100)}。${stability.label}`;
  return `除外効果は弱い。removed ROI=${pct(removed.roi / 100)}。`;
}

function groupMetrics(rows: Row[], keyFn: (row: Row) => string, minN: number) {
  const map = new Map<string, Row[]>();
  for (const row of rows) {
    const key = keyFn(row);
    map.set(key, [...(map.get(key) ?? []), row]);
  }
  return [...map.entries()]
    .map(([key, grouped]) => ({ key, metric: metric(grouped) }))
    .filter((row) => row.metric.n >= minN)
    .sort((a, b) => a.metric.roi - b.metric.roi || b.metric.n - a.metric.n);
}

function reasonMetrics(rows: Row[], minN: number) {
  const map = new Map<string, Row[]>();
  for (const row of rows) {
    for (const reason of row.decisionReasons) map.set(reason, [...(map.get(reason) ?? []), row]);
  }
  return [...map.entries()]
    .map(([key, grouped]) => ({ key, metric: metric(grouped) }))
    .filter((row) => row.metric.n >= minN)
    .sort((a, b) => a.metric.roi - b.metric.roi || b.metric.n - a.metric.n);
}

function topCauses(candidates: Candidate[]) {
  return candidates
    .filter((c) => c.prefer !== "observe" && c.removed.n >= MIN_OBSERVE_N && c.removed.roi < c.before.roi)
    .sort((a, b) => (a.removed.roi - b.removed.roi) || b.removed.n - a.removed.n)
    .slice(0, 20);
}

function venueSuggestions(rows: Row[], candidates: Candidate[]) {
  const byVenue = groupMetrics(rows, (r) => r.venue, 30);
  return byVenue.map(({ key, metric }) => {
    const related = candidates
      .filter((c) => c.label.startsWith(`${key} `) || c.label === `会場=${key}`)
      .filter((c) => c.removed.n >= MIN_OBSERVE_N)
      .sort((a, b) => (b.after.roi - b.before.roi) - (a.after.roi - a.before.roi))
      .slice(0, 3);
    const proposal = metric.roi < 70
      ? "追加除外候補。ただしvalidation/testで再確認"
      : metric.roi < 90
        ? "odds帯・展示条件で抑制候補"
        : "現状維持、強い条件だけ残す検証";
    return { venue: key, metric, proposal, related };
  });
}

function raceNoSuggestions(rows: Row[], candidates: Candidate[]) {
  return groupMetrics(rows, (r) => `${r.raceNo}R`, 30).map(({ key, metric }) => {
    const related = candidates.find((c) => c.label === key);
    return {
      raceNo: key,
      metric,
      proposal: metric.roi < 75 ? "除外追加候補" : metric.roi < 90 ? "selection/odds制限候補" : "現状維持候補",
      related,
    };
  });
}

function dataCoverage(rows: Row[]) {
  const count = (fn: (row: Row) => boolean) => rows.filter(fn).length;
  return {
    weather: count((r) => r.weatherPresent),
    exhibition: count((r) => r.exhibitionPresent),
    equipment: count((r) => r.equipmentPresent),
    motor: count((r) => r.motorPresent),
    boat: count((r) => r.boatPresent),
    f: count((r) => r.fPresent),
  };
}

function appSettingsIdeas(removalCandidates: Candidate[]) {
  const sOrA = removalCandidates.filter((c) => c.recommendation === "S" || c.recommendation === "A");
  return {
    excludedVenues_addCandidates: sOrA.filter((c) => c.label.startsWith("会場=")).map((c) => c.label.replace("会場=", "")).slice(0, 5),
    excludedRaceNos_addCandidates: sOrA.filter((c) => /^\d+R$/.test(c.label)).map((c) => Number(c.label.replace("R", ""))).slice(0, 5),
    oddsMinCandidates: sOrA.filter((c) => c.label.includes("current_odds <")).map((c) => c.label),
    oddsMaxCandidates: sOrA.filter((c) => c.label.includes("current_odds >=")).map((c) => c.label),
    weatherSkipCandidates: sOrA.filter((c) => c.label.includes("風") || c.label.includes("波") || c.label.includes("安定板")).map((c) => c.label).slice(0, 10),
    exhibitionRequiredCandidates: sOrA.filter((c) => c.label.includes("展示")).map((c) => c.label).slice(0, 10),
    fPenaltyCandidates: sOrA.filter((c) => c.label.includes("F")).map((c) => c.label).slice(0, 10),
  };
}

function roadmap(removalCandidates: Candidate[], strongKeeps: Candidate[]) {
  return [
    `読み取り専用検証をCI相当で固定: ${OUT_MD} / ${OUT_JSON} を再生成して差分を見る`,
    ...removalCandidates.filter((c) => c.recommendation === "S").slice(0, 5).map((c) => `S候補をpaper判定で検証: ${c.label}`),
    ...removalCandidates.filter((c) => c.recommendation === "A").slice(0, 5).map((c) => `A候補を月別・test期間で追加確認: ${c.label}`),
    ...strongKeeps.filter((c) => c.recommendation === "A" || c.recommendation === "B").slice(0, 5).map((c) => `残す条件の加点候補を検証: ${c.label}`),
    "選手×コース、選手ペア/トリオはn不足になりやすいため、まず監視レポートだけに留める",
  ];
}

function sharpIdeas() {
  return [
    ["BUYしないモデル", "負けBUY除外edgeを直接狙える", "decision_history + beforeinfo", "すぐ検証できる", "中"],
    ["美味しすぎるBUY疑い", "edge/EV異常値のモデル見落とし検知", "estimated_hit_rate/current_odds", "すぐ検証できる", "中"],
    ["展示逆転ルール", "事前評価より当日気配を優先", "exhibition_data + decision_history", "すぐ検証できる", "中"],
    ["攻め艇不在だけBUY", "イン逃げ系の事故率を下げる", "ST/展示/コース脚質分類", "データはあるが慎重に検証", "高"],
    ["攻め艇過多スキップ", "展開破壊レースを避ける", "展示ST/過去コース成績", "データはあるが慎重に検証", "高"],
    ["F持ち心理フィルター", "攻め前提のselectionを抑制", "racer_profiles", "すぐ検証できる", "中"],
    ["会場別に信用情報を変える", "全会場共通ルールの粗さを減らす", "venue別beforeinfo", "データはあるが慎重に検証", "高"],
    ["綺麗すぎる買い目を疑う", "1-2-3等の人気過剰を削る", "selection_popularity/current_odds", "すぐ検証できる", "中"],
    ["欠損データペナルティ", "情報不足BUYを抑制", "coverage flags", "すぐ検証できる", "低"],
    ["直近odds鮮度フィルター", "古いoddsの期待値崩れを避ける", "odds_timeseries_snapshots", "データはあるが慎重に検証", "中"],
    ["得意コース×当日展示矛盾", "過去成績の人気過剰を消す", "racer_course_stats + exhibition", "データはあるが慎重に検証", "高"],
    ["当地巧者の人気過剰", "強いが安いBUYを削る", "当地成績データが追加必要", "データ追加が必要", "高"],
    ["モーター上位の罠", "モーター上位でも展示悪い艇を消す", "motor_boat_stats + exhibition", "すぐ検証できる", "中"],
    ["低配当の的中率不足", "必要的中率未達を削る", "current_odds/result", "すぐ検証できる", "低"],
    ["高配当の夢見すぎ", "30倍以上の当たらなさを削る", "current_odds/result", "すぐ検証できる", "中"],
    ["2着3着逆転ルール", "惜しい外れの分岐条件を探す", "result/selection/features", "すぐ検証できる", "高"],
    ["惜しい外れ分析", "頭一致・2着3着逆を分類", "result/selection", "すぐ検証できる", "中"],
    ["会場別BUY数上限", "同一会場で質が落ちる日を抑制", "date/venue count", "データはあるが慎重に検証", "中"],
    ["連続で外れる日検知", "その日の水面不一致を検出", "日次ROI/weather", "データはあるが慎重に検証", "高"],
    ["検証母数の信用ランク", "n不足edgeを採用しない", "全候補", "すぐ検証できる", "低"],
  ].map(([idea, expected, data, canTry, risk]) => ({ idea, expected, data, canTry, risk }));
}

function renderMarkdown(report: {
  overall: Metric;
  period: { minDate: string | null; maxDate: string | null };
  dataCoverage: Record<string, number>;
  currentBreakdowns: Record<string, Array<{ key: string; metric: Metric }>>;
  topCauses: Candidate[];
  removalCandidates: Candidate[];
  strongKeeps: Candidate[];
  splitValidation: ReturnType<typeof splitValidationRow>[];
  venueSuggestions: ReturnType<typeof venueSuggestions>;
  raceNoSuggestions: ReturnType<typeof raceNoSuggestions>;
  sharpIdeas: ReturnType<typeof sharpIdeas>;
  appSettingsIdeas: ReturnType<typeof appSettingsIdeas>;
  roadmap: string[];
}) {
  const lines: string[] = [];
  lines.push("# ROI向上候補レポート", "");
  lines.push("## 1. 現状サマリー");
  lines.push(`- BUY件数: ${report.overall.n}`);
  lines.push(`- 的中数: ${report.overall.hits}`);
  lines.push(`- 的中率: ${pct(report.overall.hitRate)}`);
  lines.push(`- 平均odds: ${num(report.overall.avgOdds)}`);
  lines.push(`- ROI: ${pct(report.overall.roi / 100)}`);
  lines.push(`- 対象期間: ${report.period.minDate ?? "-"} 〜 ${report.period.maxDate ?? "-"}`);
  lines.push("- 対象run_kind: historical-backfill");
  lines.push("- 注意点: BUYは購入指示ではなく検証候補。ROIはpayout_yenではなくcurrent_odds基準。全候補はedge候補であり、本物のedgeとは断定しない。", "");
  lines.push("### 分析条件 / 使った集計条件");
  lines.push("- `decision_history.run_kind = 'historical-backfill'`");
  lines.push("- `decision_history.decision = 'BUY'`");
  lines.push("- `current_odds IS NOT NULL AND result IS NOT NULL`");
  lines.push("- hit判定: `result = selection`");
  lines.push("- return: `CASE WHEN result = selection THEN current_odds * 100 ELSE 0 END`");
  lines.push("- split: 日付順に train=古い70%、validation=次の20%、test=新しい10%", "");

  lines.push("### 現状分解");
  lines.push(metricTable("月別ROI", report.currentBreakdowns.monthly));
  lines.push(metricTable("会場別ROI", report.currentBreakdowns.venue));
  lines.push(metricTable("レース番号別ROI", report.currentBreakdowns.raceNo));
  lines.push(metricTable("odds帯別ROI", report.currentBreakdowns.oddsBand));
  lines.push(metricTable("selectionパターン別ROI", report.currentBreakdowns.selectionPattern));
  lines.push(metricTable("confidence帯別ROI", report.currentBreakdowns.confidenceBand));
  lines.push(metricTable("score帯別ROI", report.currentBreakdowns.scoreBand));
  lines.push(metricTable("edge帯別ROI", report.currentBreakdowns.edgeBand));
  lines.push(metricTable("BUY理由別ROI", report.currentBreakdowns.reason));
  lines.push(metricTable("データ有無別ROI", report.currentBreakdowns.dataPresence));

  lines.push("## 2. ROIを下げている主因TOP10");
  lines.push("| rank | 主因 | n | ROI | 影響 | コメント |");
  lines.push("|---:|---|---:|---:|---:|---|");
  report.topCauses.slice(0, 10).forEach((c, i) => {
    lines.push(`| ${i + 1} | ${escapeMd(c.label)} | ${c.removed.n} | ${pct(c.removed.roi / 100)} | ${pct((c.before.roi - c.removed.roi) / 100)} | ${escapeMd(c.comment)} |`);
  });
  lines.push("");

  lines.push("## 3. 除外するとROIが上がる候補TOP20");
  lines.push("| rank | 除外条件 | before ROI | after ROI | removed n | removed ROI | リスク | 推奨 |");
  lines.push("|---:|---|---:|---:|---:|---:|---|---|");
  report.removalCandidates.slice(0, 20).forEach((c, i) => {
    lines.push(`| ${i + 1} | ${escapeMd(c.label)} | ${pct(c.before.roi / 100)} | ${pct(c.after.roi / 100)} | ${c.removed.n} | ${pct(c.removed.roi / 100)} | ${escapeMd(c.risk)} | ${c.recommendation} |`);
  });
  lines.push("");

  lines.push("## 4. 残すと強いBUY条件TOP20");
  lines.push("| rank | 条件 | n | hit率 | avg odds | ROI | 安定性 | 推奨 |");
  lines.push("|---:|---|---:|---:|---:|---:|---|---|");
  report.strongKeeps.slice(0, 20).forEach((c, i) => {
    lines.push(`| ${i + 1} | ${escapeMd(c.label)} | ${c.removed.n} | ${pct(c.removed.hitRate)} | ${num(c.removed.avgOdds)} | ${pct(c.removed.roi / 100)} | ${escapeMd(c.monthlyStability)} | ${c.recommendation} |`);
  });
  lines.push("");

  lines.push("### train / validation / test 検証");
  lines.push("| 条件 | train n | train ROI | validation n | validation ROI | test n | test ROI | 判定 |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---|");
  report.splitValidation.slice(0, 30).forEach((r) => {
    lines.push(`| ${escapeMd(r.condition)} | ${r.trainN} | ${pct(r.trainRoi / 100)} | ${r.validationN} | ${pct(r.validationRoi / 100)} | ${r.testN} | ${pct(r.testRoi / 100)} | ${r.judgement} |`);
  });
  lines.push("");

  lines.push("## 5. 会場別の提案");
  lines.push("| 会場 | 現状 | 提案 | 根拠 | リスク |");
  lines.push("|---|---|---|---|---|");
  report.venueSuggestions.forEach((v) => {
    const basis = v.related.map((r) => `${r.label}: after ${pct(r.after.roi / 100)}`).join("; ") || `n=${v.metric.n}, ROI=${pct(v.metric.roi / 100)}`;
    lines.push(`| ${escapeMd(v.venue)} | n=${v.metric.n}, ROI=${pct(v.metric.roi / 100)} | ${escapeMd(v.proposal)} | ${escapeMd(basis)} | n不足・月別偏りに注意 |`);
  });
  lines.push("");

  lines.push("## 6. レース番号別の提案");
  lines.push("| raceNo | 現状ROI | 提案 | 根拠 |");
  lines.push("|---:|---:|---|---|");
  report.raceNoSuggestions.forEach((r) => {
    lines.push(`| ${r.raceNo} | ${pct(r.metric.roi / 100)} | ${escapeMd(r.proposal)} | n=${r.metric.n}, hit=${r.metric.hits}, avgOdds=${num(r.metric.avgOdds)} |`);
  });
  lines.push("");

  lines.push("## 7. 選手・コース・F系の提案");
  lines.push("| 条件 | n | ROI | 提案 | リスク |");
  lines.push("|---|---:|---:|---|---|");
  for (const c of report.removalCandidates.filter((c) => /F|頭|4\/5\/6|selection|コース|人気/.test(c.label)).slice(0, 20)) {
    lines.push(`| ${escapeMd(c.label)} | ${c.removed.n} | ${pct(c.removed.roi / 100)} | ${c.recommendation === "S" || c.recommendation === "A" ? "減点/除外候補" : "観察候補"} | ${escapeMd(c.risk)} |`);
  }
  lines.push("");

  lines.push("## 8. 展示・天候・モーター系の提案");
  lines.push("| 条件 | n | ROI | 提案 | リスク |");
  lines.push("|---|---:|---:|---|---|");
  for (const c of report.removalCandidates.filter((c) => /展示|風|波|天候|モーター|ボート|部品|チルト|安定板/.test(c.label)).slice(0, 25)) {
    lines.push(`| ${escapeMd(c.label)} | ${c.removed.n} | ${pct(c.removed.roi / 100)} | ${c.recommendation === "S" || c.recommendation === "A" ? "減点/除外候補" : "観察候補"} | ${escapeMd(c.risk)} |`);
  }
  lines.push("");

  lines.push("## 9. 尖った案");
  lines.push("| 案 | 期待効果 | 必要データ | すぐ試せるか | 過学習リスク |");
  lines.push("|---|---|---|---|---|");
  report.sharpIdeas.forEach((idea) => {
    lines.push(`| ${escapeMd(idea.idea)} | ${escapeMd(idea.expected)} | ${escapeMd(idea.data)} | ${escapeMd(idea.canTry)} | ${escapeMd(idea.risk)} |`);
  });
  lines.push("");

  lines.push("## 10. app_settings変更案");
  lines.push("実際には変更しない。候補だけ。");
  lines.push("```json");
  lines.push(JSON.stringify(report.appSettingsIdeas, null, 2));
  lines.push("```", "");

  lines.push("## 11. 次に実装するならこの順番");
  report.roadmap.forEach((item, i) => lines.push(`${i + 1}. ${item}`));
  lines.push("");
  lines.push("### 今はやらない方がいいもの");
  lines.push("- n<50の会場×選手×コース×天候×F×展示の細分化条件。過学習リスクが高い。");
  lines.push("- 高配当1件だけでROIが跳ねた条件。最大1hit除外ROIで崩れるものは危険。");
  lines.push("- 本番判定ロジックへの即時反映。まずpaper/validation/testで再現性確認が必要。", "");

  lines.push("## 12. 中学生でも分かる説明");
  lines.push("全部のレースを買おうとすると、苦手な場所、荒れやすい天気、情報が足りないレースまで混ざって負けやすくなります。今回は「もっと当てる方法」を増やすより、負けやすいBUY候補を先にやめる作戦で調べました。オッズが安すぎるもの、高すぎて夢を見すぎているもの、展示や天気やF情報が足りないもの、会場やレース番号で相性が悪いものを見つけ、まず検証候補として並べています。ここで良く見える条件も未来で勝てる保証ではないので、古い期間・次の期間・新しい期間に分けて、本当に崩れにくいかを確かめてから使います。");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function metricTable(title: string, rows: Array<{ key: string; metric: Metric }>) {
  const lines = [`#### ${title}`, "", "| 分類 | n | hit | hit率 | 平均odds | ROI | 評価 |", "|---|---:|---:|---:|---:|---:|---|"];
  for (const row of rows) {
    lines.push(`| ${escapeMd(row.key)} | ${row.metric.n} | ${row.metric.hits} | ${pct(row.metric.hitRate)} | ${num(row.metric.avgOdds)} | ${pct(row.metric.roi / 100)} | ${metricLabel(row.metric)} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function splitValidationRow(c: Candidate) {
  let judgement = "C";
  if (c.train.n >= 50 && c.validation.n >= 20 && c.test.n >= 20 && c.train.roi < 90 && c.validation.roi < 90 && c.test.roi < 90) judgement = "S";
  else if (c.train.n >= 50 && c.validation.n >= 20 && c.train.roi < 90 && c.validation.roi < 90 && c.test.n < 20) judgement = "A";
  else if (c.train.n >= 50 && c.train.roi < 90 && c.validation.roi >= 90) judgement = "B";
  else if (c.removed.n < 50) judgement = "C";
  else if (c.risk.includes("偽edge")) judgement = "D";
  return {
    condition: c.label,
    trainN: c.train.n,
    trainRoi: c.train.roi,
    validationN: c.validation.n,
    validationRoi: c.validation.roi,
    testN: c.test.n,
    testRoi: c.test.roi,
    judgement,
  };
}

function parseSelection(value: string) {
  return value.split("-").map((v) => Number(v)).filter((n) => Number.isInteger(n));
}

function parseReasons(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function selectionPattern(row: Row) {
  const nums = row.selectionNums;
  if (row.selection === "1-2-3") return "1-2-3";
  if (row.selection === "1-3-2") return "1-3-2";
  if (row.selection === "2-1-3") return "2-1-3";
  if (row.selection === "3-1-2") return "3-1-2";
  if (nums.some((n) => n >= 4)) return "4/5/6絡み";
  if (nums[0] === 1) return "1頭その他";
  if (nums[0] === 2) return "2頭その他";
  if (nums[0] === 3) return "3頭その他";
  return "その他";
}

function dataPresenceKey(row: Row) {
  return [
    row.exhibitionPresent ? "展示あり" : "展示なし",
    row.weatherPresent ? "天候あり" : "天候なし",
    row.fPresent ? "Fあり" : "Fなし",
    row.motorPresent ? "モーターあり" : "モーターなし",
    row.boatPresent ? "ボートあり" : "ボートなし",
  ].join(" / ");
}

function oddsBand(odds: number) {
  if (odds < 3) return "odds < 3";
  if (odds < 5) return "3 <= odds < 5";
  if (odds < 10) return "5 <= odds < 10";
  if (odds < 20) return "10 <= odds < 20";
  if (odds < 30) return "20 <= odds < 30";
  if (odds < 50) return "30 <= odds < 50";
  return "odds >= 50";
}

function numericBand(value: number | null, cuts: number[], label: string) {
  if (value == null || !Number.isFinite(value)) return `${label}: missing`;
  for (const cut of cuts) {
    if (value < cut) return `${label} < ${cut}`;
  }
  return `${label} >= ${cuts.at(-1)}`;
}

function metricLabel(m: Metric) {
  if (m.n < 50) return "観察候補(n不足)";
  if (m.roi >= 100 && m.n >= 300) return "採用検討";
  if (m.roi >= 100) return "観察候補";
  if (m.roi < 70 && m.n >= 100) return "除外候補";
  return "中立";
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function unique<T>(values: T[]) {
  return [...new Set(values)].filter((v) => v != null);
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

function pct(value: number) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(2)}%`;
}

function num(value: number) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(2);
}

function escapeMd(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
