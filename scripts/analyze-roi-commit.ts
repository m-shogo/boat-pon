/**
 * ROI改善コミットの読み取り専用レビュー。
 *
 * 注意:
 * - DBに書き込まない
 * - app_settingsを変更しない
 * - 本番decisionロジックを変更しない
 * - ROIはcurrent_odds基準、payout_yen不使用
 *
 * このスクリプトの「要因分解」は、既に保存済みのdecision_history BUY集合に対する
 * フィルター反実仮想です。過去コミット時点のdecision再生成ではありません。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const TARGET_SHA = "e9eabe3de747152e90fb6669a52b6e7448a83578";
const OUT_MD = "reports/roi-commit-review.md";
const OUT_JSON = "reports/roi-commit-review.json";
const STAKE_YEN = 100;

type Row = {
  id: number;
  raceId: string;
  date: string;
  ym: string;
  venue: string;
  raceNo: number;
  selection: string;
  result: string;
  currentOdds: number;
  estimatedHitRate: number | null;
  conservativeHitRate: number | null;
  requiredOdds: number | null;
  ev: number | null;
  selectionPopularity: number | null;
  head: number;
  headVenueMotorTop2Rate: number | null;
  headVenueBoatTop2Rate: number | null;
  headNationalMotorTop2Rate: number | null;
  headNationalBoatTop2Rate: number | null;
  hasVenueMotorBoat: boolean;
  hasFallbackMotorBoat: boolean;
  headExhibitionRank: number | null;
  headExhibitionSt: number | null;
  windMps: number | null;
  waveCm: number | null;
  weatherPresent: boolean;
  exhibitionPresent: boolean;
  fPresent: boolean;
  raceFlyingCount: number;
  partsChangedSelected: number;
  hit: boolean;
};

type Metric = {
  n: number;
  hits: number;
  hitRate: number;
  avgOdds: number;
  stakeYen: number;
  returnYen: number;
  roi: number;
  maxHitOdds: number;
  roiExMaxHit: number;
};

type Condition = {
  label: string;
  fn: (row: Row) => boolean;
  risk: string;
  recommendation: string;
};

if (!existsSync(DB_PATH)) {
  console.error(`[analyze-roi-commit] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

try {
  const appSettings = readAppSettings();
  const rows = loadRows();
  const overall = metric(rows);
  const patterns = buildPatternRows(rows);
  const period = periodBreakdown(rows);
  const breakdowns = {
    venue: groupMetrics(rows, (r) => r.venue, 30),
    raceNo: groupMetrics(rows, (r) => `${r.raceNo}R`, 30),
    venueRaceNo: groupMetrics(rows, (r) => `${r.venue} ${r.raceNo}R`, 50),
    selection: groupMetrics(rows, (r) => r.selection, 20),
    selectionHead: groupMetrics(rows, (r) => headBand(r.head), 30),
    oddsBand: groupMetrics(rows, (r) => oddsBand(r.currentOdds), 30),
    confidenceBand: groupMetrics(rows, (r) => numericBand(r.conservativeHitRate ?? r.estimatedHitRate, [0.03, 0.05, 0.08, 0.1], "confidence"), 30),
    edgeBand: groupMetrics(rows, (r) => numericBand(edgeValue(r), [-0.02, 0, 0.02, 0.05], "edge"), 30),
    venueMotorBand: groupMetrics(rows, (r) => numericBand(r.headVenueMotorTop2Rate, [25, 35, 45, 50], "venueMotorTop2Rate"), 30),
    venueBoatBand: groupMetrics(rows, (r) => numericBand(r.headVenueBoatTop2Rate, [25, 35, 45, 50], "venueBoatTop2Rate"), 30),
    nationalMotorBand: groupMetrics(rows, (r) => numericBand(r.headNationalMotorTop2Rate, [25, 35, 45, 50], "nationalMotorTop2Rate"), 30),
    nationalBoatBand: groupMetrics(rows, (r) => numericBand(r.headNationalBoatTop2Rate, [25, 35, 45, 50], "nationalBoatTop2Rate"), 30),
  };
  const noBuy = noBuyCandidates(rows);
  const edgeRows = edgeCandidateRows(rows, noBuy);
  const motorStrategy = motorStrategyRows(rows);
  const appSettingsProposal = buildAppSettingsProposal(appSettings, noBuy);
  const review = reviewFindings();

  const report = {
    generatedAt: new Date().toISOString(),
    dbPath: DB_PATH,
    targetSha: TARGET_SHA,
    currentHead: git(["rev-parse", "HEAD"]).trim(),
    targetCommit: {
      log: git(["show", "--no-patch", "--format=fuller", TARGET_SHA]),
      stat: git(["show", "--stat", "--oneline", TARGET_SHA]),
      files: git(["show", "--name-only", "--format=", TARGET_SHA]).trim().split("\n").filter(Boolean),
    },
    appSettings,
    review,
    overall,
    reportedRoi: { before: 0.978, after: 1.118, y2024: 1.087, y2025: 1.169 },
    patterns,
    period,
    breakdowns,
    noBuy,
    edgeRows,
    motorStrategy,
    appSettingsProposal,
    finalJudgement: finalJudgement(overall, patterns, period, noBuy),
  };

  mkdirSync("reports", { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUT_MD, renderMarkdown(report));
  console.log(`[analyze-roi-commit] wrote ${OUT_MD}`);
  console.log(`[analyze-roi-commit] wrote ${OUT_JSON}`);
  console.log(`[analyze-roi-commit] current historical-backfill BUY n=${overall.n} hit=${overall.hits} avgOdds=${num(overall.avgOdds)} ROI=${num(overall.roi)}`);
} finally {
  db.close();
}

function readAppSettings() {
  const rows = db.prepare("SELECT key, value FROM app_settings ORDER BY key").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => {
    try {
      return [row.key, JSON.parse(row.value)];
    } catch {
      return [row.key, row.value];
    }
  }));
}

function loadRows(): Row[] {
  const raw = db.prepare(`
WITH ranked_exhibition AS (
  SELECT
    race_id,
    course,
    COALESCE(
      ranking,
      RANK() OVER (PARTITION BY race_id ORDER BY exhibition_time ASC)
    ) AS derived_rank,
    start_timing
  FROM exhibition_data
  WHERE exhibition_time IS NOT NULL OR ranking IS NOT NULL OR start_timing IS NOT NULL
), race_f AS (
  SELECT
    ent.race_id,
    COUNT(rp.flying_count) AS f_present_n,
    SUM(CASE WHEN COALESCE(rp.flying_count, 0) > 0 THEN 1 ELSE 0 END) AS flying_count
  FROM race_entries ent
  LEFT JOIN racer_profiles rp ON rp.registration_no = ent.racer_reg
  GROUP BY ent.race_id
), selected_parts AS (
  SELECT
    dh.id,
    SUM(CASE WHEN COALESCE(req.parts_changed_count, 0) > 0 THEN 1 ELSE 0 END) AS selected_parts_changed
  FROM decision_history dh
  JOIN race_equipment req
    ON req.race_id = dh.race_id
   AND instr('-' || dh.selection || '-', '-' || req.course || '-') > 0
  GROUP BY dh.id
)
SELECT
  dh.id,
  dh.race_id,
  dh.date,
  dh.venue,
  dh.race_no,
  dh.selection,
  dh.result,
  dh.current_odds,
  dh.estimated_hit_rate,
  dh.conservative_hit_rate,
  dh.required_odds,
  dh.ev,
  dh.selection_popularity,
  mbs.motor_top2_rate AS venue_motor_top2_rate,
  mbs.boat_top2_rate AS venue_boat_top2_rate,
  ent.motor_no,
  ent.boat_no,
  ent.exhibition_time AS national_exhibition_time,
  re.derived_rank AS head_exhibition_rank,
  re.start_timing AS head_exhibition_st,
  rw.wind_speed_mps,
  rw.wave_height_cm,
  rw.weather,
  rf.f_present_n,
  rf.flying_count,
  sp.selected_parts_changed,
  op.raw_json
FROM decision_history dh
LEFT JOIN motor_boat_stats mbs
  ON mbs.race_id = dh.race_id
 AND mbs.course = CAST(substr(dh.selection, 1, 1) AS INTEGER)
LEFT JOIN race_entries ent
  ON ent.race_id = dh.race_id
 AND ent.boat = CAST(substr(dh.selection, 1, 1) AS INTEGER)
LEFT JOIN ranked_exhibition re
  ON re.race_id = dh.race_id
 AND re.course = CAST(substr(dh.selection, 1, 1) AS INTEGER)
LEFT JOIN race_weather rw ON rw.race_id = dh.race_id
LEFT JOIN race_f rf ON rf.race_id = dh.race_id
LEFT JOIN selected_parts sp ON sp.id = dh.id
LEFT JOIN official_programs op ON op.race_id = dh.race_id
WHERE dh.run_kind = 'historical-backfill'
  AND dh.decision = 'BUY'
  AND dh.current_odds IS NOT NULL
  AND dh.result IS NOT NULL
ORDER BY dh.date, dh.id
`).all() as Array<Record<string, unknown>>;

  return raw.map((row) => {
    const selection = String(row.selection);
    const head = Number(selection.split("-")[0]);
    const national = extractNationalMotorBoat(row.raw_json, head);
    return {
      id: Number(row.id),
      raceId: String(row.race_id),
      date: String(row.date),
      ym: String(row.date).slice(0, 7),
      venue: String(row.venue),
      raceNo: Number(row.race_no),
      selection,
      result: String(row.result),
      currentOdds: Number(row.current_odds),
      estimatedHitRate: nullableNumber(row.estimated_hit_rate),
      conservativeHitRate: nullableNumber(row.conservative_hit_rate),
      requiredOdds: nullableNumber(row.required_odds),
      ev: nullableNumber(row.ev),
      selectionPopularity: nullableNumber(row.selection_popularity),
      head,
      headVenueMotorTop2Rate: nullableNumber(row.venue_motor_top2_rate),
      headVenueBoatTop2Rate: nullableNumber(row.venue_boat_top2_rate),
      headNationalMotorTop2Rate: national.motorTop2Rate,
      headNationalBoatTop2Rate: national.boatTop2Rate,
      hasVenueMotorBoat: row.venue_motor_top2_rate != null || row.venue_boat_top2_rate != null,
      hasFallbackMotorBoat: row.venue_motor_top2_rate == null && row.venue_boat_top2_rate == null && (national.motorTop2Rate != null || national.boatTop2Rate != null),
      headExhibitionRank: nullableNumber(row.head_exhibition_rank),
      headExhibitionSt: nullableNumber(row.head_exhibition_st),
      windMps: nullableNumber(row.wind_speed_mps),
      waveCm: nullableNumber(row.wave_height_cm),
      weatherPresent: row.weather != null || row.wind_speed_mps != null || row.wave_height_cm != null,
      exhibitionPresent: row.head_exhibition_rank != null || row.head_exhibition_st != null,
      fPresent: Number(row.f_present_n ?? 0) > 0,
      raceFlyingCount: Number(row.flying_count ?? 0),
      partsChangedSelected: Number(row.selected_parts_changed ?? 0),
      hit: String(row.result) === selection,
    };
  });
}

function extractNationalMotorBoat(rawJson: unknown, course: number) {
  if (typeof rawJson !== "string") return { motorTop2Rate: null, boatTop2Rate: null };
  try {
    const parsed = JSON.parse(rawJson) as { boats?: Array<Record<string, unknown>> };
    const boat = parsed.boats?.find((b) => Number(b.course) === course);
    return {
      motorTop2Rate: nullableNumber(boat?.motorTop2Rate),
      boatTop2Rate: nullableNumber(boat?.boatTop2Rate),
    };
  } catch {
    return { motorTop2Rate: null, boatTop2Rate: null };
  }
}

function metric(rows: Row[]): Metric {
  const n = rows.length;
  const hits = rows.filter((r) => r.hit).length;
  const hitOdds = rows.filter((r) => r.hit).map((r) => r.currentOdds).sort((a, b) => b - a);
  const returnYen = hitOdds.reduce((sum, odds) => sum + odds * STAKE_YEN, 0);
  const stakeYen = n * STAKE_YEN;
  const returnExMax = Math.max(0, returnYen - (hitOdds[0] ?? 0) * STAKE_YEN);
  return {
    n,
    hits,
    hitRate: n ? hits / n : 0,
    avgOdds: n ? rows.reduce((sum, r) => sum + r.currentOdds, 0) / n : 0,
    stakeYen,
    returnYen,
    roi: stakeYen ? returnYen / stakeYen : 0,
    maxHitOdds: hitOdds[0] ?? 0,
    roiExMaxHit: stakeYen ? returnExMax / stakeYen : 0,
  };
}

function buildPatternRows(rows: Row[]) {
  const before = rows.filter((r) => ![11, 12].includes(r.raceNo));
  const motorOnly = before;
  const excluded10Only = rows.filter((r) => ![10, 11, 12].includes(r.raceNo));
  const maxMotorOnly = before.filter((r) => (r.headVenueMotorTop2Rate ?? r.headNationalMotorTop2Rate ?? -1) < 50);
  const oldCalibrationProxy = before.filter((r) => passesCalibrationProxy(r, [0.65, 0.51, 0.40]));
  const newCalibrationProxy = rows.filter((r) => passesCalibrationProxy(r, [0.40, 0.40, 0.40]));
  const latest = rows;
  return [
    pattern("A_before相当(保存BUY上の[11,12]除外のみ)", before, "motorなし再生成ではなく、保存BUYに旧raceNoを当てた参考値"),
    pattern("B_motor_boat_statsのみ反映(再生成不可)", motorOnly, "現在DBだけではmotorなしとの差分は厳密再現不可"),
    pattern("C_excludedRaceNosのみ[10,11,12]", excluded10Only, "10R除外の単独反実仮想"),
    pattern("D_maxMotorTop2Rateのみ50", maxMotorOnly, "保存BUYから頭motor>=50を削る反実仮想"),
    pattern("E_oddsCalibrationFactorsのみ0.40", newCalibrationProxy, "保存BUY内でEV/required odds proxyを通るものだけの参考値"),
    pattern("E_oldCalibrationFactors proxy", oldCalibrationProxy, "旧0.65/0.51/0.40 proxy"),
    pattern("F_最新DB保存BUY", latest, "実DBのhistorical-backfill BUY再現"),
  ];
}

function pattern(patternName: string, rows: Row[], comment: string) {
  return { pattern: patternName, ...metric(rows), comment };
}

function passesCalibrationProxy(row: Row, factors: [number, number, number]) {
  const p = row.estimatedHitRate;
  if (p == null || p <= 0) return true;
  const factor = row.currentOdds < 30 ? factors[0] : row.currentOdds < 50 ? factors[1] : factors[2];
  const calibrated = p * factor;
  const ev = calibrated * row.currentOdds;
  const requiredOdds = 1.25 / calibrated;
  if (requiredOdds < 25) return false;
  if (row.currentOdds > requiredOdds * 2) return false;
  return ev >= 1.25;
}

function periodBreakdown(rows: Row[]) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const trainEnd = Math.floor(sorted.length * 0.7);
  const validationEnd = Math.floor(sorted.length * 0.9);
  const base = [
    ...groupMetrics(rows, (r) => r.date.slice(0, 4), 1).map((x) => ({ period: x.key, ...x.metric, judgement: judgePeriod(x.metric) })),
    ...groupMetrics(rows, (r) => r.ym, 1).map((x) => ({ period: x.key, ...x.metric, judgement: judgePeriod(x.metric) })),
    ...rollingMonths(rows),
    { period: "train古い70%", ...metric(sorted.slice(0, trainEnd)), judgement: judgePeriod(metric(sorted.slice(0, trainEnd))) },
    { period: "validation次20%", ...metric(sorted.slice(trainEnd, validationEnd)), judgement: judgePeriod(metric(sorted.slice(trainEnd, validationEnd))) },
    { period: "test新しい10%", ...metric(sorted.slice(validationEnd)), judgement: judgePeriod(metric(sorted.slice(validationEnd))) },
  ];
  return base;
}

function rollingMonths(rows: Row[]) {
  const months = [...new Set(rows.map((r) => r.ym))].sort();
  const out = [];
  for (let i = 0; i <= months.length - 3; i += 1) {
    const target = new Set(months.slice(i, i + 3));
    const m = metric(rows.filter((r) => target.has(r.ym)));
    out.push({ period: `${months[i]}〜${months[i + 2]}`, ...m, judgement: judgePeriod(m) });
  }
  return out;
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

function noBuyCandidates(rows: Row[]) {
  const conditions: Condition[] = [
    cond("10R", (r) => r.raceNo === 10, "現在設定済み。testで跳ねるなら過学習注意", "A"),
    cond("11R", (r) => r.raceNo === 11, "現在設定済み。nは十分ではないが0hit", "A"),
    cond("12R", (r) => r.raceNo === 12, "現在設定済み。n<100", "B"),
    cond("current_odds >= 50", (r) => r.currentOdds >= 50, "高配当1発依存注意", "B"),
    cond("venueMotorTop2Rate >= 50", (r) => (r.headVenueMotorTop2Rate ?? -1) >= 50, "人気過剰/高モーター罠候補", "B"),
    cond("venueMotorTop2Rate < 25", (r) => (r.headVenueMotorTop2Rate ?? 999) < 25, "低モーター候補", "B"),
    cond("venueBoatTop2Rate >= 50", (r) => (r.headVenueBoatTop2Rate ?? -1) >= 50, "高ボート人気過剰候補", "B"),
    cond("venue motor/boat欠損fallback", (r) => r.hasFallbackMotorBoat, "fallbackの質確認", "B"),
    cond("展示欠損", (r) => !r.exhibitionPresent, "欠損除外は過学習しにくいがn確認", "B"),
    cond("天候欠損", (r) => !r.weatherPresent, "欠損除外は過学習しにくいがn確認", "B"),
    cond("頭展示4位以下", (r) => (r.headExhibitionRank ?? 0) >= 4, "展示下位の頭固定", "A"),
    cond("F持ち複数レース", (r) => r.raceFlyingCount > 1, "スタート心理。前回も弱い", "A"),
    cond("wind >= 5", (r) => (r.windMps ?? -1) >= 5, "水面リスク", "B"),
    cond("wind >= 8", (r) => (r.windMps ?? -1) >= 8, "強風。n不足注意", "B"),
    cond("wave >= 5", (r) => (r.waveCm ?? -1) >= 5, "波高リスク", "B"),
    cond("選択艇に部品交換あり", (r) => r.partsChangedSelected > 0, "不確実性", "B"),
    ...[...new Set(rows.map((r) => r.venue))].map((venue) => cond(`会場=${venue}`, (r) => r.venue === venue, "会場単位は過学習注意", "B")),
    ...[...new Set(rows.map((r) => `${r.venue} ${r.raceNo}R`))].map((key) => {
      const [venue, race] = key.split(" ");
      const raceNo = Number(race.replace("R", ""));
      return cond(key, (r) => r.venue === venue && r.raceNo === raceNo, "venue×raceNoは細かすぎ注意", "C");
    }),
  ];
  const before = metric(rows);
  return conditions
    .map((c) => {
      const removedRows = rows.filter(c.fn);
      const remainingRows = rows.filter((r) => !c.fn(r));
      return {
        condition: c.label,
        removed: metric(removedRows),
        remaining: metric(remainingRows),
        risk: c.risk,
        recommendation: removedRows.length < 50 ? "C" : c.recommendation,
        lift: metric(remainingRows).roi - before.roi,
      };
    })
    .filter((r) => r.removed.n >= 30)
    .sort((a, b) => b.lift - a.lift || a.removed.roi - b.removed.roi)
    .slice(0, 60);
}

function cond(label: string, fn: (row: Row) => boolean, risk: string, recommendation: string): Condition {
  return { label, fn, risk, recommendation };
}

function edgeCandidateRows(rows: Row[], noBuy: ReturnType<typeof noBuyCandidates>) {
  const split = splitSets(rows);
  return noBuy.slice(0, 30).map((c) => {
    const fn = conditionFn(c.condition);
    const selected = fn ? rows.filter(fn) : [];
    const train = fn ? metric(split.train.filter(fn)) : metric([]);
    const validation = fn ? metric(split.validation.filter(fn)) : metric([]);
    const test = fn ? metric(split.test.filter(fn)) : metric([]);
    const all = metric(selected);
    return {
      condition: c.condition,
      trainRoi: train.roi,
      validationRoi: validation.roi,
      testRoi: test.roi,
      n: all.n,
      roiExMaxHit: all.roiExMaxHit,
      judgement: judgeEdge(all, train, validation, test),
    };
  });

  function conditionFn(label: string) {
    const base: Record<string, (row: Row) => boolean> = {
      "10R": (r) => r.raceNo === 10,
      "11R": (r) => r.raceNo === 11,
      "12R": (r) => r.raceNo === 12,
      "current_odds >= 50": (r) => r.currentOdds >= 50,
      "venueMotorTop2Rate >= 50": (r) => (r.headVenueMotorTop2Rate ?? -1) >= 50,
      "venueMotorTop2Rate < 25": (r) => (r.headVenueMotorTop2Rate ?? 999) < 25,
      "venueBoatTop2Rate >= 50": (r) => (r.headVenueBoatTop2Rate ?? -1) >= 50,
      "venue motor/boat欠損fallback": (r) => r.hasFallbackMotorBoat,
      "展示欠損": (r) => !r.exhibitionPresent,
      "天候欠損": (r) => !r.weatherPresent,
      "頭展示4位以下": (r) => (r.headExhibitionRank ?? 0) >= 4,
      "F持ち複数レース": (r) => r.raceFlyingCount > 1,
      "wind >= 5": (r) => (r.windMps ?? -1) >= 5,
      "wind >= 8": (r) => (r.windMps ?? -1) >= 8,
      "wave >= 5": (r) => (r.waveCm ?? -1) >= 5,
      "選択艇に部品交換あり": (r) => r.partsChangedSelected > 0,
    };
    if (base[label]) return base[label];
    if (label.startsWith("会場=")) {
      const venue = label.replace("会場=", "");
      return (r: Row) => r.venue === venue;
    }
    return null;
  }
}

function splitSets(rows: Row[]) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const trainEnd = Math.floor(sorted.length * 0.7);
  const validationEnd = Math.floor(sorted.length * 0.9);
  return {
    train: sorted.slice(0, trainEnd),
    validation: sorted.slice(trainEnd, validationEnd),
    test: sorted.slice(validationEnd),
  };
}

function motorStrategyRows(rows: Row[]) {
  const conditions = [
    ["venueMotorTop2Rate >= 50", (r: Row) => (r.headVenueMotorTop2Rate ?? -1) >= 50],
    ["venueMotorTop2Rate 35-50", (r: Row) => (r.headVenueMotorTop2Rate ?? -1) >= 35 && (r.headVenueMotorTop2Rate ?? -1) < 50],
    ["venueMotorTop2Rate < 35", (r: Row) => (r.headVenueMotorTop2Rate ?? 999) < 35],
    ["venueMotorあり", (r: Row) => r.headVenueMotorTop2Rate != null],
    ["venueMotor欠損fallback", (r: Row) => r.hasFallbackMotorBoat],
    ["motor高いが展示下位", (r: Row) => (r.headVenueMotorTop2Rate ?? -1) >= 45 && (r.headExhibitionRank ?? 0) >= 4],
  ] as const;
  return conditions.map(([label, fn]) => ({ motorCondition: label, strategy: "original_single", ...metric(rows.filter(fn)), comment: motorComment(label, metric(rows.filter(fn))) }));
}

function motorComment(label: string, m: Metric) {
  if (m.n < 50) return "n不足。観察のみ";
  if (m.roi < 0.8) return `${label} は弱い。NO BUY/減点候補`;
  if (m.roi >= 1) return `${label} はedge候補。ただし最大1hit除外ROI確認`;
  return "中立。単独採用は弱い";
}

function reviewFindings() {
  const stat = git(["show", "--stat", "--oneline", TARGET_SHA]);
  const show = git(["show", "--format=short", "--unified=80", TARGET_SHA]);
  return {
    stat,
    findings: [
      {
        severity: "P1",
        title: "loadMotorBoatStatsMapが64万件を各list関数で全ロードする",
        detail: "listProgramInputs / listProgramInputsRange / listProgramInputsWithOddsSnapshotsRange のたびに motor_boat_stats 全件をMap化している。読み取り専用の性能確認上も、日付範囲や対象race_idで絞るべき。",
      },
      {
        severity: "P1",
        title: "maxMotorTop2Rate判定がvenueMotorTop2Rateではなくnational motorTop2Rateを見ている可能性",
        detail: "programFilterReasonsは candidate.candidateMotorTop2Rate ?? firstBoatFeature.motorTop2Rate を参照し、venueMotorTop2Rateを直接見ていない。コミット意図の会場別motor上限とズレる危険がある。",
      },
      {
        severity: "P2",
        title: "報告ROI 1.118が現在DBから再現できない",
        detail: "現在のdecision_history historical-backfill BUYをcurrent_odds基準で再計算するとROIは0.804。報告値は別条件/別DB/再生成結果の可能性がある。",
      },
      {
        severity: "P2",
        title: "motorなし/設定なしの厳密比較にはdecision再生成が必要",
        detail: "保存済みdecision_historyだけでは、motor_boat_stats統合により新たにBUYになった/消えた候補を復元できない。今回の要因分解はフィルター反実仮想として扱うべき。",
      },
    ],
    excerptHash: hashString(show),
  };
}

function buildAppSettingsProposal(appSettings: Record<string, unknown>, noBuy: ReturnType<typeof noBuyCandidates>) {
  const budgetRule = (appSettings.budget_rule ?? {}) as Record<string, unknown>;
  const programFilter = (budgetRule.programFilter ?? {}) as Record<string, unknown>;
  return {
    excludedRaceNos: {
      current: budgetRule.excludedRaceNos ?? null,
      proposal: [10, 11, 12],
      reason: "現DBでは11/12は0hit、10Rも低ROI。ただし報告ROIが再現できないため維持提案止まり。",
    },
    programFilter: {
      maxMotorTop2Rate: {
        current: programFilter.maxMotorTop2Rate ?? null,
        proposal: null,
        reason: "判定実装がvenueMotorTop2Rateを見ていない疑いがあるため、まず実装/検証修正が先。",
      },
    },
    oddsCalibrationFactors: {
      current: budgetRule.oddsCalibrationFactors ?? null,
      proposal: [],
      reason: "全帯0.40はBUY削減による見かけ改善の疑い。walk-forwardで係数探索が必要。",
    },
    betStrategyCandidates: {
      default: "original_single",
      conditional: ["second_third_reverseは前回レポートで微改善。ただし欠損率/過学習確認必須"],
    },
    noBuyFilters: noBuy.slice(0, 8).map((r) => r.condition),
  };
}

function finalJudgement(overall: Metric, patterns: Array<Record<string, unknown>>, period: Array<Record<string, unknown>>, noBuy: ReturnType<typeof noBuyCandidates>) {
  return {
    q1_roi1118: "現在DBのcurrent_odds基準では0.804で、1.118は再現できない。現時点では信用しきれない。",
    q2_source: "厳密には分解不能。保存BUY上では10R/11R/12R除外やNO BUYフィルターの影響が大きく、motor_boat_stats単独効果とは断定不可。",
    q3_exclude10: "現DBでは10R ROIが低く候補。ただしtestで跳ねる月があり、単独本番固定は追加検証が必要。",
    q4_maxMotor50: "実装がvenueMotorTop2Rateではなくnational motorTop2Rateを見ている疑いがあるため、妥当性判断前に修正/検証が必要。",
    q5_calibration040: "全帯0.40は強い。BUYを減らすだけの改善に見える危険があるため、やりすぎ疑い。",
    q6_single: "現時点では1点買いが基本。複数点は欠損率と過学習リスクが高い。",
    q7_reverse: "前回シミュレーションでは微改善だが、採用ではなく条件付きpaper検証候補。",
    q8_flow: "1-2流しは的中率だけ上がりROIは微低下。常用非推奨。",
    q9_top3box: "微改善に見えるが欠損率が高く、条件付き観察候補。",
    q10_next: "本番実装候補はなし。まずloadMotorBoatStatsMapの範囲ロード化、venueMotorTop2Rateをfilterに使うかの整合確認、再生成ベースのA/B検証。",
    summary: `現在ROI=${num(overall.roi)}、上位NO BUY候補=${noBuy[0]?.condition ?? "-"}`,
    patternCount: patterns.length,
    periodCount: period.length,
  };
}

function renderMarkdown(report: {
  targetSha: string;
  currentHead: string;
  targetCommit: { log: string; stat: string; files: string[] };
  appSettings: Record<string, unknown>;
  review: ReturnType<typeof reviewFindings>;
  overall: Metric;
  reportedRoi: Record<string, number>;
  patterns: Array<{ pattern: string; comment: string } & Metric>;
  period: Array<{ period: string; judgement: string } & Metric>;
  breakdowns: Record<string, Array<{ key: string; metric: Metric }>>;
  noBuy: ReturnType<typeof noBuyCandidates>;
  edgeRows: ReturnType<typeof edgeCandidateRows>;
  motorStrategy: ReturnType<typeof motorStrategyRows>;
  appSettingsProposal: ReturnType<typeof buildAppSettingsProposal>;
  finalJudgement: ReturnType<typeof finalJudgement>;
}) {
  const lines: string[] = [];
  lines.push("# ROI改善コミットレビュー", "");
  lines.push("## 1. 対象コミット");
  lines.push(`- sha: ${report.targetSha}`);
  lines.push("- message: motor_boat_stats をモデルに統合・キャリブレーション改善・設定最適化");
  lines.push(`- current HEAD: ${report.currentHead}`);
  lines.push(`- 変更ファイル: ${report.targetCommit.files.join(", ")}`);
  lines.push(`- 報告ROI: before ${report.reportedRoi.before} → after ${report.reportedRoi.after}、2024=${report.reportedRoi.y2024}、2025=${report.reportedRoi.y2025}`);
  lines.push("");
  lines.push("### コードレビュー所見");
  lines.push("| severity | finding | detail |");
  lines.push("|---|---|---|");
  for (const f of report.review.findings) lines.push(`| ${f.severity} | ${escapeMd(f.title)} | ${escapeMd(f.detail)} |`);
  lines.push("");
  lines.push("## 2. ROI再現結果");
  lines.push(`現在DBのhistorical-backfill BUYをcurrent_odds基準で再計算したROIは **${num(report.overall.roi)}** です。報告値1.118はこのDB状態からは再現できません。`);
  lines.push("| pattern | n | hit率 | avg odds | 投資 | 回収 | ROI | コメント |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---|");
  for (const p of report.patterns) lines.push(`| ${escapeMd(p.pattern)} | ${p.n} | ${pct(p.hitRate)} | ${num(p.avgOdds)} | ${yen(p.stakeYen)} | ${yen(p.returnYen)} | ${num(p.roi)} | ${escapeMd(p.comment)} |`);
  lines.push("");
  lines.push("## 3. 変更要因分解");
  lines.push("| 変更 | ROI改善幅 | BUY削減数 | コメント |");
  lines.push("|---|---:|---:|---|");
  const latest = report.patterns.find((p) => p.pattern.startsWith("F_")) ?? report.patterns.at(-1)!;
  for (const p of report.patterns.filter((p) => !p.pattern.startsWith("F_"))) {
    lines.push(`| ${escapeMd(p.pattern)} | ${num(p.roi - latest.roi)} | ${latest.n - p.n} | ${escapeMd(p.comment)} |`);
  }
  lines.push("");
  lines.push("## 4. 期間分割");
  lines.push("| period | n | hit | hit率 | avg odds | ROI | 最大的中odds | 最大1hit除外ROI | 判定 |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const p of report.period.slice(0, 60)) lines.push(`| ${p.period} | ${p.n} | ${p.hits} | ${pct(p.hitRate)} | ${num(p.avgOdds)} | ${num(p.roi)} | ${num(p.maxHitOdds)} | ${num(p.roiExMaxHit)} | ${p.judgement} |`);
  lines.push("");
  lines.push("## 5. 会場/raceNo/selection分解");
  lines.push(metricSection("会場別ROI", report.breakdowns.venue));
  lines.push(metricSection("raceNo別ROI", report.breakdowns.raceNo));
  lines.push(metricSection("venue × raceNo ROI", report.breakdowns.venueRaceNo.slice(0, 40)));
  lines.push(metricSection("selection別ROI", report.breakdowns.selection));
  lines.push(metricSection("selection頭別ROI", report.breakdowns.selectionHead));
  lines.push(metricSection("odds帯別ROI", report.breakdowns.oddsBand));
  lines.push(metricSection("confidence帯別ROI", report.breakdowns.confidenceBand));
  lines.push(metricSection("edge帯別ROI", report.breakdowns.edgeBand));
  lines.push("");
  lines.push("## 6. motor_boat_statsの効果");
  lines.push(metricSection("venueMotorTop2Rate帯別ROI", report.breakdowns.venueMotorBand));
  lines.push(metricSection("venueBoatTop2Rate帯別ROI", report.breakdowns.venueBoatBand));
  lines.push(metricSection("national motorTop2Rate帯別ROI", report.breakdowns.nationalMotorBand));
  lines.push(metricSection("national boatTop2Rate帯別ROI", report.breakdowns.nationalBoatBand));
  lines.push("| motor_condition | strategy | n | hit_rate | avg_odds | ROI | コメント |");
  lines.push("|---|---|---:|---:|---:|---:|---|");
  for (const r of report.motorStrategy) lines.push(`| ${escapeMd(r.motorCondition)} | ${r.strategy} | ${r.n} | ${pct(r.hitRate)} | ${num(r.avgOdds)} | ${num(r.roi)} | ${escapeMd(r.comment)} |`);
  lines.push("");
  lines.push("## 7. NO BUY候補");
  lines.push("| rank | 条件 | 削除n | 削除ROI | 残りn | 残りROI | リスク | 推奨 |");
  lines.push("|---:|---|---:|---:|---:|---:|---|---|");
  report.noBuy.slice(0, 30).forEach((r, i) => lines.push(`| ${i + 1} | ${escapeMd(r.condition)} | ${r.removed.n} | ${num(r.removed.roi)} | ${r.remaining.n} | ${num(r.remaining.roi)} | ${escapeMd(r.risk)} | ${r.recommendation} |`));
  lines.push("");
  lines.push("## 8. edge候補 / 偽edge疑い");
  lines.push("| 条件 | train ROI | validation ROI | test ROI | n | 最大1hit除外ROI | 判定 |");
  lines.push("|---|---:|---:|---:|---:|---:|---|");
  for (const r of report.edgeRows) lines.push(`| ${escapeMd(r.condition)} | ${num(r.trainRoi)} | ${num(r.validationRoi)} | ${num(r.testRoi)} | ${r.n} | ${num(r.roiExMaxHit)} | ${r.judgement} |`);
  lines.push("");
  lines.push("## 9. app_settings変更案");
  lines.push("提案のみ。実際には変更していません。");
  lines.push("```json");
  lines.push(JSON.stringify(report.appSettingsProposal, null, 2));
  lines.push("```", "");
  lines.push("## 10. 結論");
  lines.push(`1. 今回のROI 1.118は信用してよいか: ${report.finalJudgement.q1_roi1118}`);
  lines.push(`2. ROI改善は motor_boat_stats の効果か、設定変更の効果か: ${report.finalJudgement.q2_source}`);
  lines.push(`3. 10R除外は本当に妥当か: ${report.finalJudgement.q3_exclude10}`);
  lines.push(`4. maxMotorTop2Rate: 50 は本当に妥当か: ${report.finalJudgement.q4_maxMotor50}`);
  lines.push(`5. oddsCalibrationFactors 全帯0.40はやりすぎではないか: ${report.finalJudgement.q5_calibration040}`);
  lines.push(`6. 1点買いのままでよいか: ${report.finalJudgement.q6_single}`);
  lines.push(`7. 2着3着逆転保険は有効か: ${report.finalJudgement.q7_reverse}`);
  lines.push(`8. 1-2-流しは有効か: ${report.finalJudgement.q8_flow}`);
  lines.push(`9. 3艇BOXは有効か: ${report.finalJudgement.q9_top3box}`);
  lines.push(`10. 次に本番実装してよい候補は何か: ${report.finalJudgement.q10_next}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function metricSection(title: string, rows: Array<{ key: string; metric: Metric }>) {
  const lines = [`### ${title}`, "", "| 分類 | 条件 | n | hit率 | avg odds | ROI | 評価 |", "|---|---|---:|---:|---:|---:|---|"];
  for (const row of rows.slice(0, 40)) lines.push(`| ${title} | ${escapeMd(row.key)} | ${row.metric.n} | ${pct(row.metric.hitRate)} | ${num(row.metric.avgOdds)} | ${num(row.metric.roi)} | ${judgePeriod(row.metric)} |`);
  lines.push("");
  return lines.join("\n");
}

function judgePeriod(m: Metric) {
  if (m.n < 50) return "C: n不足";
  if (m.roi >= 1 && m.roiExMaxHit >= 0.9) return "S: 安定候補";
  if (m.roi >= 0.9 && m.roiExMaxHit >= 0.8) return "A: 追加確認";
  if (m.roi >= 0.8) return "B: 不安定";
  return "D: 弱い/過学習疑い";
}

function judgeEdge(all: Metric, train: Metric, validation: Metric, test: Metric) {
  if (all.n < 50) return "C: n不足";
  if (all.hits <= 2 && all.roi > 1) return "D: 的中1-2件依存";
  if (all.roi > 1 && all.roiExMaxHit < 0.8) return "D: 最大1hit依存";
  if (train.roi < 0.9 && validation.roi < 0.9 && (test.n < 30 || test.roi < 0.9)) return "S: NO BUY edge候補";
  if (train.roi < 0.9 && validation.roi < 0.9) return "A: NO BUY候補";
  if (test.n >= 30 && test.roi >= 1) return "D: testで逆行";
  return "B: 観察";
}

function edgeValue(row: Row) {
  const p = row.conservativeHitRate ?? row.estimatedHitRate;
  return p == null ? null : p - 1 / row.currentOdds;
}

function numericBand(value: number | null, cuts: number[], label: string) {
  if (value == null || !Number.isFinite(value)) return `${label}: missing`;
  for (const cut of cuts) if (value < cut) return `${label} < ${cut}`;
  return `${label} >= ${cuts.at(-1)}`;
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

function headBand(head: number) {
  if (head === 1) return "1号艇頭";
  if (head === 2) return "2号艇頭";
  if (head === 3) return "3号艇頭";
  return "4/5/6号艇頭";
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function num(value: number) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(3);
}

function pct(value: number) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(2)}%`;
}

function yen(value: number) {
  return `${Math.round(value).toLocaleString("ja-JP")}円`;
}

function escapeMd(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function git(args: string[]) {
  try {
    return execFileSync("git", args, { encoding: "utf8" });
  } catch (error) {
    return String(error);
  }
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return hash;
}
