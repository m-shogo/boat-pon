/**
 * historical-backfill対象レースの読み取り専用A/B再生成検証。
 *
 * - DB書き込みなし
 * - app_settings変更なし
 * - decision_history INSERTなし
 * - 対象は保存済み historical-backfill BUY の race_id 集合
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_MODEL_ALPHA, buildCandidatesFromModel, buildVenueModel, type ModelCandidateInput } from "../src/domain/model";
import { judgeCandidate, DEFAULT_APP_RULE, V4_EMPIRICAL_CALIBRATION } from "../src/domain/decision";
import { filterComparableResultsForDate } from "../src/domain/raceRegime";
import { extractProgramFeatures, type BoatFeature, type ProgramFeatureSnapshot } from "../src/domain/programFeatures";
import type { BudgetRule, RaceResult } from "../src/domain/types";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const FROM = "2024-01-01";
const TO = "2026-05-21";
const TRAIN_DAYS = 180;
const OUT_MD = "reports/regenerated-ab-review.md";
const OUT_JSON = "reports/regenerated-ab-review.json";

type PatternId =
  | "baseline_before"
  | "venue_motor_only"
  | "venue_motor_and_boat"
  | "excluded_10_11_12_only"
  | "max_motor_top2_50_national"
  | "max_motor_top2_50_venue"
  | "calibration_040_all"
  | "current_like";

type ProgramRow = ModelCandidateInput & { raceId: string; features: ProgramFeatureSnapshot };
type EvalRow = {
  pattern: PatternId;
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
  selection: string | null;
  decision: string;
  hit: boolean;
  currentOdds: number | null;
  returned: boolean;
};

if (!existsSync(DB_PATH)) {
  console.error(`[analyze-regenerated-ab] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

try {
  const targetRaceIds = loadTargetRaceIds();
  const programs = loadPrograms(targetRaceIds);
  const odds = loadLatestOdds(targetRaceIds);
  const results = loadResults(addDays(FROM, -TRAIN_DAYS), TO);
  const resultByRaceId = new Map(results.map((r) => [r.raceId, r]));
  const patterns = buildPatterns();
  const rows: EvalRow[] = [];
  const modelCache = new Map<string, ReturnType<typeof buildVenueModel>>();

  for (const pattern of patterns) {
    for (const program of programs) {
      const settings = pattern.settings;
      const model = modelForDate(results, program.date, settings.minSampleSize, modelCache);
      const adjustedProgram = { ...program, features: transformFeatures(program.features, pattern) };
      const candidates = buildCandidatesFromModel(
        [adjustedProgram],
        model,
        settings.targetEv,
        `${program.date}T00:00:00+09:00`,
        new Map(),
        odds,
      ).map((candidate) => pattern.useVenueMotorForFilter
        ? {
          ...candidate,
          candidateMotorTop2Rate: candidate.firstBoatFeature?.venueMotorTop2Rate ?? candidate.candidateMotorTop2Rate ?? null,
        }
        : candidate);
      const candidate = candidates[0];
      if (!candidate) {
        rows.push({
          pattern: pattern.id,
          raceId: program.raceId,
          date: program.date,
          venue: program.venue,
          raceNo: program.raceNo,
          selection: null,
          decision: "NO_MODEL",
          hit: false,
          currentOdds: null,
          returned: Boolean(resultByRaceId.get(program.raceId)?.returned),
        });
        continue;
      }
      const decision = judgeCandidate(candidate, settings, {
        now: beforeCloseTime(program.date, program.closeAt, settings.minMinutesBeforeClose + 10),
        buyCountToday: 0,
        reservedBudgetYen: 0,
      });
      const selection = candidate.selection.join("-");
      const result = resultByRaceId.get(program.raceId);
      rows.push({
        pattern: pattern.id,
        raceId: program.raceId,
        date: program.date,
        venue: program.venue,
        raceNo: program.raceNo,
        selection,
        decision: decision.status,
        hit: result?.trifecta === selection,
        currentOdds: candidate.currentOdds,
        returned: Boolean(result?.returned),
      });
    }
  }

  const summaries = patterns.map((pattern) => ({
    id: pattern.id,
    label: pattern.label,
    comment: pattern.comment,
    ...summarize(rows.filter((r) => r.pattern === pattern.id)),
  }));
  const report = {
    generatedAt: new Date().toISOString(),
    mode: "read-only regenerated A/B foundation",
    scope: {
      from: FROM,
      to: TO,
      targetRaceIds: targetRaceIds.length,
      programs: programs.length,
      note: "保存済みhistorical-backfill BUYのrace_id集合で再生成。全official_programs再生成ではない。",
    },
    summaries,
    savedHistory: loadSavedHistorySummary(),
    conclusion: {
      roi1118Reproduced: summaries.some((s) => s.roi >= 1.118),
      note: "この土台ではROI 1.118は再現していない。厳密な全レース再生成には全official_programs + 全odds coverageが必要。",
    },
  };

  mkdirSync("reports", { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUT_MD, renderMarkdown(report));
  console.log(`[analyze-regenerated-ab] wrote ${OUT_MD}`);
  console.log(`[analyze-regenerated-ab] wrote ${OUT_JSON}`);
  for (const s of summaries) console.log(`${s.id} BUY=${s.buy} hit=${s.hits} ROI=${fmt(s.roi)}`);
} finally {
  db.close();
}

function loadTargetRaceIds() {
  const rows = db.prepare(`
SELECT DISTINCT race_id
FROM decision_history
WHERE run_kind='historical-backfill'
  AND decision='BUY'
  AND current_odds IS NOT NULL
  AND result IS NOT NULL
ORDER BY race_id
`).all() as Array<{ race_id: string }>;
  return rows.map((r) => r.race_id);
}

function loadPrograms(raceIds: string[]): ProgramRow[] {
  const courseStats = loadCourseStats();
  const profiles = loadProfiles();
  const exhibition = loadExhibitionSt(raceIds);
  const motorBoat = loadMotorBoat(raceIds);
  const out: ProgramRow[] = [];
  for (const ids of chunks(raceIds, 500)) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(`
SELECT race_id, date, venue, race_no, close_at, raw_json
FROM official_programs
WHERE race_id IN (${placeholders})
ORDER BY date ASC, venue ASC, race_no ASC
`).all(...ids) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const raceId = String(row.race_id);
      const base = extractProgramFeatures(JSON.parse(String(row.raw_json)));
      out.push({
        raceId,
        date: String(row.date),
        venue: String(row.venue),
        raceNo: Number(row.race_no),
        closeAt: String(row.close_at),
        features: enrich(base, raceId, courseStats, profiles, exhibition, motorBoat),
      });
    }
  }
  return out;
}

function enrich(
  features: ProgramFeatureSnapshot,
  raceId: string,
  courseStats: Map<string, { avgSt: number | null; top3Rate: number | null }>,
  profiles: Map<string, { flyingCount: number | null; lateStartCount: number | null }>,
  exhibition: Map<string, number>,
  motorBoat: Map<string, { motorTop2Rate: number | null; boatTop2Rate: number | null }>,
): ProgramFeatureSnapshot {
  return {
    boats: features.boats.map((boat) => {
      const stat = boat.registrationNo ? courseStats.get(`${boat.registrationNo}-${boat.course}`) : undefined;
      const profile = boat.registrationNo ? profiles.get(boat.registrationNo) : undefined;
      const st = exhibition.get(`${raceId}-${boat.course}`) ?? null;
      const mb = motorBoat.get(`${raceId}-${boat.course}`);
      return {
        ...boat,
        courseAvgSt: stat?.avgSt ?? null,
        courseTop3Rate: stat?.top3Rate ?? null,
        flyingCount: profile?.flyingCount ?? null,
        lateStartCount: profile?.lateStartCount ?? null,
        exhibitionStResidual: stat?.avgSt != null && st != null ? stat.avgSt - st : null,
        venueMotorTop2Rate: mb?.motorTop2Rate ?? null,
        venueBoatTop2Rate: mb?.boatTop2Rate ?? null,
      };
    }),
  };
}

function transformFeatures(features: ProgramFeatureSnapshot, pattern: ReturnType<typeof buildPatterns>[number]): ProgramFeatureSnapshot {
  return {
    boats: features.boats.map((boat) => {
      const next: BoatFeature = { ...boat };
      if (!pattern.useVenueMotor) next.venueMotorTop2Rate = null;
      if (!pattern.useVenueBoat) next.venueBoatTop2Rate = null;
      return next;
    }),
  };
}

function buildPatterns() {
  const oldCalibration = [
    { maxRequiredOdds: 30, factor: 0.65 },
    { maxRequiredOdds: 50, factor: 0.51 },
    { maxRequiredOdds: Number.MAX_SAFE_INTEGER, factor: 0.40 },
  ];
  const calibration040 = [
    { maxRequiredOdds: 30, factor: 0.40 },
    { maxRequiredOdds: 50, factor: 0.40 },
    { maxRequiredOdds: Number.MAX_SAFE_INTEGER, factor: 0.40 },
  ];
  const base: BudgetRule = {
    ...DEFAULT_APP_RULE,
    excludedRaceNos: [11, 12],
    oddsCalibrationFactors: oldCalibration,
    programFilter: {
      ...DEFAULT_APP_RULE.programFilter,
      maxMotorTop2Rate: undefined,
    },
  };
  return [
    { id: "baseline_before" as const, label: "baseline_before", settings: base, useVenueMotor: false, useVenueBoat: false, useVenueMotorForFilter: false, comment: "venue motor/boatなし、旧raceNo、旧calibration" },
    { id: "venue_motor_only" as const, label: "venue_motor_only", settings: base, useVenueMotor: true, useVenueBoat: false, useVenueMotorForFilter: false, comment: "featureAdjustmentにvenue motorのみ" },
    { id: "venue_motor_and_boat" as const, label: "venue_motor_and_boat", settings: base, useVenueMotor: true, useVenueBoat: true, useVenueMotorForFilter: false, comment: "featureAdjustmentにvenue motor/boat" },
    { id: "excluded_10_11_12_only" as const, label: "excluded_10_11_12_only", settings: { ...base, excludedRaceNos: [10, 11, 12] }, useVenueMotor: false, useVenueBoat: false, useVenueMotorForFilter: false, comment: "10R除外のみ追加" },
    { id: "max_motor_top2_50_national" as const, label: "max_motor_top2_50_national", settings: { ...base, programFilter: { ...base.programFilter, maxMotorTop2Rate: 50 } }, useVenueMotor: false, useVenueBoat: false, useVenueMotorForFilter: false, comment: "national motor基準でmaxMotorTop2Rate=50" },
    { id: "max_motor_top2_50_venue" as const, label: "max_motor_top2_50_venue", settings: { ...base, programFilter: { ...base.programFilter, maxMotorTop2Rate: 50 } }, useVenueMotor: true, useVenueBoat: false, useVenueMotorForFilter: true, comment: "venue motor基準でmaxMotorTop2Rate=50" },
    { id: "calibration_040_all" as const, label: "calibration_040_all", settings: { ...base, oddsCalibrationFactors: calibration040 }, useVenueMotor: false, useVenueBoat: false, useVenueMotorForFilter: false, comment: "全帯0.40のみ" },
    { id: "current_like" as const, label: "current_like", settings: { ...DEFAULT_APP_RULE, excludedRaceNos: [10, 11, 12], oddsCalibrationFactors: calibration040, programFilter: { ...DEFAULT_APP_RULE.programFilter, maxMotorTop2Rate: 50 } }, useVenueMotor: true, useVenueBoat: true, useVenueMotorForFilter: false, comment: "現在設定に近い。filterは現実装同様national寄り" },
  ];
}

function modelForDate(results: RaceResult[], date: string, minSampleSize: number, cache: Map<string, ReturnType<typeof buildVenueModel>>) {
  const key = `${date}|${minSampleSize}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const from = addDays(date, -TRAIN_DAYS);
  const comparable = filterComparableResultsForDate(results.filter((r) => r.date < date && r.date >= from), date);
  const model = buildVenueModel(comparable, minSampleSize, DEFAULT_MODEL_ALPHA);
  cache.set(key, model);
  return model;
}

function summarize(rows: EvalRow[]) {
  const buy = rows.filter((r) => r.decision === "BUY" && !r.returned);
  const hits = buy.filter((r) => r.hit);
  const hitOdds = hits.map((r) => r.currentOdds ?? 0).sort((a, b) => b - a);
  const returnYen = hitOdds.reduce((sum, odds) => sum + odds * 100, 0);
  const stakeYen = buy.length * 100;
  const maxHitOdds = hitOdds[0] ?? 0;
  return {
    races: rows.length,
    modeled: rows.filter((r) => r.decision !== "NO_MODEL").length,
    buy: buy.length,
    watch: rows.filter((r) => r.decision === "WATCH").length,
    skip: rows.filter((r) => r.decision === "SKIP").length,
    noModel: rows.filter((r) => r.decision === "NO_MODEL").length,
    hits: hits.length,
    hitRate: buy.length ? hits.length / buy.length : 0,
    avgOdds: average(buy.map((r) => r.currentOdds)),
    stakeYen,
    returnYen,
    roi: stakeYen ? returnYen / stakeYen : 0,
    maxHitOdds,
    roiExMaxHit: stakeYen ? Math.max(0, returnYen - maxHitOdds * 100) / stakeYen : 0,
  };
}

function loadSavedHistorySummary() {
  const rows = db.prepare(`
SELECT selection, result, current_odds, returned
FROM decision_history
WHERE run_kind='historical-backfill'
  AND decision='BUY'
  AND current_odds IS NOT NULL
  AND result IS NOT NULL
`).all() as Array<{ selection: string; result: string; current_odds: number; returned: number }>;
  const buy = rows.filter((r) => !r.returned);
  const hits = buy.filter((r) => r.selection === r.result);
  const ret = hits.reduce((sum, r) => sum + Number(r.current_odds) * 100, 0);
  return {
    buy: buy.length,
    hits: hits.length,
    hitRate: buy.length ? hits.length / buy.length : 0,
    avgOdds: average(buy.map((r) => Number(r.current_odds))),
    roi: buy.length ? ret / (buy.length * 100) : 0,
  };
}

function renderMarkdown(report: {
  scope: { from: string; to: string; targetRaceIds: number; programs: number; note: string };
  summaries: Array<ReturnType<typeof summarize> & { id: PatternId; label: string; comment: string }>;
  savedHistory: ReturnType<typeof loadSavedHistorySummary>;
  conclusion: { roi1118Reproduced: boolean; note: string };
}) {
  const lines = [
    "# regenerated A/B review",
    "",
    "## 目的",
    "保存済みdecision_historyだけではできない motorあり/なし・設定あり/なし の比較を、同じ対象race inputでメモリ上再生成する土台です。DB書き込みはありません。",
    "",
    "## scope",
    `- period: ${report.scope.from}〜${report.scope.to}`,
    `- target race ids: ${report.scope.targetRaceIds}`,
    `- programs loaded: ${report.scope.programs}`,
    `- note: ${report.scope.note}`,
    "",
    "## saved decision_history baseline",
    `- BUY=${report.savedHistory.buy} hits=${report.savedHistory.hits} hitRate=${pct(report.savedHistory.hitRate)} avgOdds=${fmt(report.savedHistory.avgOdds)} ROI=${fmt(report.savedHistory.roi)}`,
    "",
    "## A/B再生成結果",
    "| pattern | BUY件数 | 的中数 | 的中率 | avg odds | 投資 | 回収 | ROI | 最大1hit除外ROI | コメント |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  ];
  for (const s of report.summaries) {
    lines.push(`| ${s.id} | ${s.buy} | ${s.hits} | ${pct(s.hitRate)} | ${fmt(s.avgOdds)} | ${yen(s.stakeYen)} | ${yen(s.returnYen)} | ${fmt(s.roi)} | ${fmt(s.roiExMaxHit)} | ${s.comment} |`);
  }
  lines.push("");
  lines.push("## 判定");
  lines.push(`- ROI 1.118再現: ${report.conclusion.roi1118Reproduced ? "yes" : "no"}`);
  lines.push(`- ${report.conclusion.note}`);
  lines.push("- このスクリプトは土台です。全official_programsでの完全再生成へ拡張すれば、保存BUY集合に限定しないA/Bが可能です。");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function loadLatestOdds(raceIds: string[]) {
  const map = new Map<string, number>();
  for (const ids of chunks(raceIds, 500)) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(`
WITH ranked AS (
  SELECT race_id, selection, odds,
         ROW_NUMBER() OVER (PARTITION BY race_id, selection ORDER BY is_final_like DESC, captured_at DESC, id DESC) AS rn
  FROM odds_snapshots
  WHERE race_id IN (${placeholders})
)
SELECT race_id, selection, odds FROM ranked WHERE rn=1
`).all(...ids) as Array<{ race_id: string; selection: string; odds: number }>;
    for (const row of rows) map.set(`${row.race_id}/${row.selection}`, Number(row.odds));
  }
  return map;
}

function loadResults(from: string, to: string): RaceResult[] {
  const rows = db.prepare(`
SELECT race_id, date, venue, race_no, trifecta, payout_yen, popularity, returned, source, fetched_at
FROM race_results
WHERE date >= ? AND date <= ?
ORDER BY date DESC, venue ASC, race_no ASC
`).all(from, to) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    raceId: String(row.race_id),
    date: String(row.date),
    venue: String(row.venue),
    raceNo: Number(row.race_no),
    trifecta: row.trifecta == null ? null : String(row.trifecta),
    payoutYen: row.payout_yen == null ? null : Number(row.payout_yen),
    popularity: row.popularity == null ? null : Number(row.popularity),
    returned: Boolean(row.returned),
    source: String(row.source),
    fetchedAt: String(row.fetched_at),
  }));
}

function loadCourseStats() {
  const rows = db.prepare("SELECT registration_no, course, avg_st, top3_rate FROM racer_course_stats").all() as Array<Record<string, unknown>>;
  return new Map(rows.map((r) => [`${r.registration_no}-${r.course}`, { avgSt: nullableNumber(r.avg_st), top3Rate: nullableNumber(r.top3_rate) }]));
}

function loadProfiles() {
  const rows = db.prepare("SELECT registration_no, flying_count, late_start_count FROM racer_profiles").all() as Array<Record<string, unknown>>;
  return new Map(rows.map((r) => [String(r.registration_no), { flyingCount: nullableNumber(r.flying_count), lateStartCount: nullableNumber(r.late_start_count) }]));
}

function loadExhibitionSt(raceIds: string[]) {
  const map = new Map<string, number>();
  for (const ids of chunks(raceIds, 500)) {
    const rows = db.prepare(`SELECT race_id, course, start_timing FROM exhibition_data WHERE race_id IN (${ids.map(() => "?").join(",")}) AND start_timing > 0.05 AND start_timing < 0.4`).all(...ids) as Array<Record<string, unknown>>;
    for (const row of rows) map.set(`${row.race_id}-${row.course}`, Number(row.start_timing));
  }
  return map;
}

function loadMotorBoat(raceIds: string[]) {
  const map = new Map<string, { motorTop2Rate: number | null; boatTop2Rate: number | null }>();
  for (const ids of chunks(raceIds, 500)) {
    const rows = db.prepare(`SELECT race_id, course, motor_top2_rate, boat_top2_rate FROM motor_boat_stats WHERE race_id IN (${ids.map(() => "?").join(",")})`).all(...ids) as Array<Record<string, unknown>>;
    for (const row of rows) map.set(`${row.race_id}-${row.course}`, { motorTop2Rate: nullableNumber(row.motor_top2_rate), boatTop2Rate: nullableNumber(row.boat_top2_rate) });
  }
  return map;
}

function beforeCloseTime(date: string, closeAt: string, minutesBeforeClose: number) {
  const [hour, minute] = closeAt.split(":").map(Number);
  const base = new Date(`${date}T00:00:00+09:00`);
  base.setHours(hour, minute, 0, 0);
  return new Date(base.getTime() - minutesBeforeClose * 60_000);
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00+09:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function chunks<T>(values: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function average(values: Array<number | null>) {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function fmt(value: number | null) {
  return value == null || !Number.isFinite(value) ? "-" : value.toFixed(3);
}

function pct(value: number | null) {
  return value == null || !Number.isFinite(value) ? "-" : `${(value * 100).toFixed(2)}%`;
}

function yen(value: number) {
  return `${Math.round(value).toLocaleString("ja-JP")}円`;
}
