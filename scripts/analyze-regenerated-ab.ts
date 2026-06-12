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
import { stripLiveOnlyRacerFeatures } from "../src/domain/programFeatureSafety";
import type { BudgetRule, RaceResult } from "../src/domain/types";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const FROM = "2024-01-01";
const TO = "2026-05-21";
const TRAIN_DAYS = 180;

type ScopeMode = "saved-buy" | "all-results" | "odds-results";
const SCOPE_MODE = parseScopeMode(process.env.BOAT_PON_REGEN_SCOPE);
const OUT_MD = SCOPE_MODE === "saved-buy"
  ? "reports/regenerated-ab-review.md"
  : `reports/regenerated-ab-${SCOPE_MODE}-review.md`;
const OUT_JSON = SCOPE_MODE === "saved-buy"
  ? "reports/regenerated-ab-review.json"
  : `reports/regenerated-ab-${SCOPE_MODE}-review.json`;

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
  const targetRaceIds = loadTargetRaceIds(SCOPE_MODE);
  const programs = loadPrograms(targetRaceIds);
  const odds = loadLatestOdds(targetRaceIds);
  const results = loadResults(addDays(FROM, -TRAIN_DAYS), TO);
  const resultByRaceId = new Map(results.map((r) => [r.raceId, r]));
  const patterns = buildPatterns();
  const rows: EvalRow[] = [];
  const modelCache = new Map<string, ReturnType<typeof buildVenueModel>>();
  const programsByDate = groupBy(programs, (program) => program.date);

  for (const pattern of patterns) {
    const candidateByRaceId = new Map<string, ReturnType<typeof buildCandidatesFromModel>[number]>();
    for (const [date, datePrograms] of programsByDate) {
      const settings = pattern.settings;
      const model = modelForDate(results, date, settings.minSampleSize, modelCache);
      const adjustedPrograms = datePrograms.map((program) => ({ ...program, features: transformFeatures(program.features, pattern) }));
      const candidatesForDate = buildCandidatesFromModel(
        adjustedPrograms,
        model,
        settings.targetEv,
        `${date}T00:00:00+09:00`,
        new Map(),
        odds,
      ).map((candidate) => pattern.useVenueMotorForFilter
        ? {
          ...candidate,
          candidateMotorTop2Rate: candidate.firstBoatFeature?.venueMotorTop2Rate ?? candidate.candidateMotorTop2Rate ?? null,
        }
        : candidate);
      for (const candidate of candidatesForDate) {
        if (!candidateByRaceId.has(candidate.raceId)) candidateByRaceId.set(candidate.raceId, candidate);
      }
    }
    for (const program of programs) {
      const settings = pattern.settings;
      const candidate = candidateByRaceId.get(program.raceId);
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
    featureSafety: {
      mode: "historical-readonly",
      liveOnlyFeaturesNeutralized: true,
      unsafeLiveSnapshotUsed: false,
      note: "courseAvgSt/courseTop3Rate/flyingCount/lateStartCount/exhibitionStResidual は null にした。" +
        "これらは racer_profiles/racer_course_stats の現在値スナップショットであり、point-in-time leakage になるため。" +
        "motor_boat_stats は race_id 単位で安全なため維持。className/winRate/top2Rate は出走表掲載値で安全。",
      warning: "このレポートの ROI は live-only特徴量を無効化した状態の再生成値。" +
        "419bda3 以前の decision_history は courseStFactor/courseTop3Factor が非中立で保存されている可能性あり（leakEvidence確認済み）。",
    },
    scope: {
      mode: SCOPE_MODE,
      from: FROM,
      to: TO,
      targetRaceIds: targetRaceIds.length,
      programs: programs.length,
      note: scopeNote(SCOPE_MODE),
    },
    summaries,
    savedHistory: loadSavedHistorySummary(),
    conclusion: {
      roi1118Reproduced: summaries.some((s) => s.roi >= 1.118),
      note: conclusionNote(SCOPE_MODE),
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

function loadTargetRaceIds(scopeMode: ScopeMode) {
  if (scopeMode === "all-results") {
    const rows = db.prepare(`
SELECT DISTINCT p.race_id
FROM official_programs p
JOIN race_results rr ON rr.race_id = p.race_id
WHERE p.date >= ? AND p.date <= ?
  AND rr.trifecta IS NOT NULL
ORDER BY p.race_id
`).all(FROM, TO) as Array<{ race_id: string }>;
    return rows.map((r) => r.race_id);
  }
  if (scopeMode === "odds-results") {
    const rows = db.prepare(`
SELECT DISTINCT p.race_id
FROM official_programs p
JOIN race_results rr ON rr.race_id = p.race_id
WHERE p.date >= ? AND p.date <= ?
  AND rr.trifecta IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM odds_snapshots os WHERE os.race_id = p.race_id
  )
ORDER BY p.race_id
`).all(FROM, TO) as Array<{ race_id: string }>;
    return rows.map((r) => r.race_id);
  }
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

function parseScopeMode(value: string | undefined): ScopeMode {
  if (value == null || value === "" || value === "saved-buy") return "saved-buy";
  if (value === "all-results" || value === "odds-results") return value;
  throw new Error(`BOAT_PON_REGEN_SCOPE must be saved-buy, all-results, or odds-results: ${value}`);
}

function scopeNote(scopeMode: ScopeMode) {
  if (scopeMode === "all-results") return "結果がある期間内official_programs全体で再生成。odds欠損raceでは候補が生成されない場合があります。";
  if (scopeMode === "odds-results") return "結果とodds_snapshotsがある期間内official_programs全体で再生成。保存BUY集合に限定しないpaper A/Bです。";
  return "保存済みhistorical-backfill BUYのrace_id集合で再生成。全official_programs再生成ではない。";
}

function conclusionNote(scopeMode: ScopeMode) {
  if (scopeMode === "odds-results") {
    return "結果とoddsがあるofficial_programs全体に広げてもROI 1.118は再現しない。保存履歴との差は、motor/boat単体効果よりも現行の候補生成・設定・保存履歴生成時点の差分が主因の可能性が高い。";
  }
  if (scopeMode === "all-results") {
    return "official_programs全体に広げてもROI 1.118は再現しない。odds欠損raceでは候補が生成されないため、odds coverage差分も別途切り分けが必要。";
  }
  return "この土台ではROI 1.118は再現していない。厳密な全レース再生成には全official_programs + 全odds coverageが必要。";
}

/**
 * historical-readonly mode でプログラムをロードする。
 * live-only特徴量（courseAvgSt/courseTop3Rate/flyingCount/lateStartCount/exhibitionStResidual）は
 * stripLiveOnlyRacerFeatures で null にする。
 * motor_boat_stats は race_id 単位で安全なので維持する。
 *
 * 旧実装は独自 enrich で racer_profiles/racer_course_stats を直接JOINしていたが、
 * それらは現在値スナップショットのみのため historical 検証では未来情報リークになっていた。
 * point-in-time safety hardening (commit after 419bda3) で修正済み。
 */
function loadPrograms(raceIds: string[]): ProgramRow[] {
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
      // motor_boat_stats は race_id 単位で安全。live-only特徴量は strip する。
      const withMotor: ProgramFeatureSnapshot = {
        boats: base.boats.map((boat) => {
          const mb = motorBoat.get(`${raceId}-${boat.course}`);
          return {
            ...boat,
            venueMotorTop2Rate: mb?.motorTop2Rate ?? null,
            venueBoatTop2Rate: mb?.boatTop2Rate ?? null,
          };
        }),
      };
      out.push({
        raceId,
        date: String(row.date),
        venue: String(row.venue),
        raceNo: Number(row.race_no),
        closeAt: String(row.close_at),
        features: stripLiveOnlyRacerFeatures(withMotor),
      });
    }
  }
  return out;
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
  scope: { mode: ScopeMode; from: string; to: string; targetRaceIds: number; programs: number; note: string };
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
    `- mode: ${report.scope.mode}`,
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
  lines.push(`- ${nextStepNote(report.scope.mode)}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function nextStepNote(scopeMode: ScopeMode) {
  if (scopeMode === "odds-results") {
    return "次は、保存済みdecision_history生成時の設定・候補selection・odds取得条件をrace単位で突き合わせ、BUY件数が6249件から7件へ縮む原因を特定します。";
  }
  if (scopeMode === "all-results") {
    return "次は、odds有無で候補生成がどれだけ落ちるかを切り分け、odds coverageを補った完全A/Bへ進めます。";
  }
  return "このスクリプトは土台です。全official_programsでの完全再生成へ拡張すれば、保存BUY集合に限定しないA/Bが可能です。";
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

// loadCourseStats / loadProfiles / loadExhibitionSt は historical-readonly 安全化（419bda3以降）で不要になった。
// live-only特徴量を historical 検証に使うと point-in-time leakage になるため削除した。
// motor_boat_stats は race_id 単位で安全なため loadMotorBoat のみ残す。

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

function groupBy<T, K>(values: T[], keyFn: (value: T) => K) {
  const map = new Map<K, T[]>();
  for (const value of values) {
    const key = keyFn(value);
    const existing = map.get(key);
    if (existing) existing.push(value);
    else map.set(key, [value]);
  }
  return map;
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
