/**
 * ROI Decision Lab — 読み取り専用
 *
 * 禁止:
 * - DB INSERT / UPDATE / DELETE / DROP
 * - app_settings 変更
 * - 本番decisionロジック変更
 * - 自動投票・ログイン保存
 *
 * ROI定義:
 * - 対象: decision_history run_kind='historical-backfill' decision='BUY'
 * - ヒット: result = selection
 * - 1件100円想定、的中回収 = current_odds * 100
 * - payout_yen は使わない
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/roi-decision-lab.md";
const OUT_JSON = "reports/roi-decision-lab.json";
const STAKE = 100;

// ───────────────── DB ─────────────────

if (!existsSync(DB_PATH)) {
  console.error(`[roi-decision-lab] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

// ───────────────── Types ─────────────────

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
  exTime: number | null;
  exRank: number | null;
  exSt: number | null;  // exhibition_data.start_timing
  tilt: number | null;
  partsCount: number;
  motorTop2: number | null;
  boatTop2: number | null;
  flyingCount: number | null;
  lateStartCount: number | null;
  racerTop3Rate: number | null;
  racerAvgSt: number | null;
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
  requiredOdds: number | null;
  requiredHitRate: number;
  confidence: number | null;
  score: number | null;
  sampleSize: number | null;
  sharpSignalDrop: number | null;
  environmentRiskLevel: string | null;
  selectionPopularity: number | null;
  decisionReasons: string[];
  // weather
  weather: string | null;
  windMps: number | null;
  waveCm: number | null;
  stablePlate: boolean | null;
  weatherPresent: boolean;
  // exhibition
  headExRank: number | null;
  headExTime: number | null;
  headExSt: number | null;
  exhibitionPresent: boolean;
  selectedAvgExRank: number | null;
  selectedSlowStCount: number;  // ST >= 0.15
  selectedExTop3Count: number;  // 買い目3艇のうち展示Top3に入る艇数
  // equipment
  equipmentPresent: boolean;
  selectedPartsCount: number;
  selectedTiltNonZero: number;
  // motor/boat
  headMotorTop2: number | null;
  headBoatTop2: number | null;
  motorPresent: boolean;
  boatPresent: boolean;
  selectedMotorTopCount: number;  // >= 50%
  selectedMotorLowCount: number;  // < 25%
  // F
  headFlyingCount: number | null;
  raceFlyingCount: number;
  attackFlyingCount: number;
  selectedFlyingTotal: number;
  fPresent: boolean;
  // race_payouts trifecta: actual payout for the winning combination
  winningPayoutYen: number | null;  // yen per 100yen stake (100 = odds 1.0)
  // course features per boat
  courseFeaturesMap: Map<number, CourseFeature>;
};

type Metric = {
  n: number;
  hits: number;
  hitRate: number;
  avgOdds: number;
  roi: number;
  maxHitOdds: number;
  roiExMaxHit: number;
  roiExMax3Hits: number;
};

type MonthlyStability = {
  label: string;
  goodMonths: number;    // ROI >= 100
  badMonths: number;     // ROI < 70
  totalMonths: number;
  worstMonthRoi: number;
};

type Judgement = "S" | "A" | "B" | "C" | "D";

type LabCandidate = {
  action: "NO_BUY" | "BET_SELECTOR" | "KEEP";
  family: string;
  label: string;
  condition: string;
  n: number;           // removed n (NO_BUY: 除外される行数, KEEP: 対象行数)
  removedROI: number;  // ROI of removed/subset rows
  afterN: number;
  afterROI: number;
  baselineROI: number;
  improvement: number; // afterROI - baselineROI
  hitRate: number;
  avgOdds: number;
  stake: number;       // total_stake_yen
  returnYen: number;   // total_return_yen
  avgTickets: number;
  maxHitOdds: number;
  roiExMaxHit: number;
  roiExMax3Hits: number;
  trainROI: number;
  trainN: number;
  validationROI: number;
  validationN: number;
  testROI: number;
  testN: number;
  worstMonthROI: number;
  goodMonths: number;
  badMonths: number;
  totalMonths: number;
  warnings: string[];
  judgement: Judgement;
  comment: string;
};

type BetSelectorCandidate = {
  action: "BET_SELECTOR";
  family: string;
  label: string;
  selectorName: string;
  applyCondition: string;
  n: number;
  totalTickets: number;
  avgTickets: number;
  hitRaces: number;
  hitRate: number;
  totalStake: number;
  totalReturn: number;
  roi: number;
  baselineROI: number;
  improvement: number;
  maxHitOdds: number;
  roiExMaxHit: number;
  trainROI: number;
  validationROI: number;
  testROI: number;
  worstMonthROI: number;
  goodMonths: number;
  badMonths: number;
  warnings: string[];
  judgement: Judgement;
};

// ───────────────── Load ─────────────────

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
  const weatherMap = loadWeather(raceIds);
  const exhibitionMap = loadExhibition(raceIds);
  const equipmentMap = loadEquipment(raceIds);
  const motorMap = loadMotorBoat(raceIds);
  const entryMap = loadEntries(raceIds);
  const payoutsMap = loadTrifectaPayouts(raceIds);

  return decisions.map((d) => {
    const selNums = parseNums(d.selection);
    const resultNums = parseNums(d.result ?? "");
    const hit = d.result != null && d.result === d.selection;
    const weather = weatherMap.get(d.race_id);
    const exhibitionByBow = exhibitionMap.get(d.race_id) ?? new Map<number, CourseFeature>();
    const entriesByBow = entryMap.get(d.race_id) ?? new Map<number, { flyingCount: number | null; racerTop3: number | null; racerAvgSt: number | null }>();

    // head (first boat in selection)
    const head = selNums[0] ?? 0;
    const headEx = exhibitionByBow.get(head);
    const headEntry = entriesByBow.get(head);

    // racing flying count (all boats in race)
    const allEntries = [...entriesByBow.values()];
    const raceFlyingCount = allEntries.reduce((sum, e) => sum + (e.flyingCount ?? 0), 0);

    // selected boats features
    const selectedEx = selNums.map((n) => exhibitionByBow.get(n)).filter((e): e is CourseFeature => e != null);
    const selectedEntries = selNums.map((n) => entriesByBow.get(n)).filter(Boolean);

    // selectedExTop3Count: 買い目3艇のうち展示rank<=3に入る数
    const selectedExTop3Count = selectedEx.filter((e) => e.exRank != null && e.exRank <= 3).length;
    const selectedSlowStCount = selectedEx.filter((e) => e.exSt != null && e.exSt >= 0.15).length;
    const selectedAvgExRank = selectedEx.length > 0
      ? selectedEx.reduce((s, e) => s + (e.exRank ?? 0), 0) / selectedEx.length
      : null;
    const selectedPartsCount = selectedEx.reduce((s, e) => s + e.partsCount, 0);
    const selectedTiltNonZero = selectedEx.filter((e) => e.tilt != null && e.tilt !== 0).length;
    const selectedMotorTopCount = selectedEx.filter((e) => e.motorTop2 != null && e.motorTop2 >= 50).length;
    const selectedMotorLowCount = selectedEx.filter((e) => e.motorTop2 != null && e.motorTop2 < 25).length;
    const selectedFlyingTotal = selectedEntries.reduce((s, e) => s + (e?.flyingCount ?? 0), 0);
    const attackFlyingCount = selNums.slice(1).reduce((s, n) => s + (entriesByBow.get(n)?.flyingCount ?? 0), 0);

    const motorMap2 = motorMap.get(d.race_id) ?? new Map<number, { motorTop2: number | null; boatTop2: number | null }>();
    const headMotorEntry = motorMap2.get(head);

    return {
      id: d.id,
      raceId: d.race_id,
      date: d.date,
      ym: d.date.slice(0, 7),
      venue: d.venue,
      raceNo: d.race_no,
      selection: d.selection,
      selectionNums: selNums,
      result: d.result ?? "",
      resultNums,
      hit,
      currentOdds: d.current_odds,
      estimatedHitRate: nn(d.estimated_hit_rate),
      requiredOdds: nn(d.required_odds),
      requiredHitRate: d.required_odds != null ? 1 / d.required_odds : d.current_odds > 0 ? 1 / d.current_odds : 0,
      confidence: nn(d.conservative_hit_rate ?? d.estimated_hit_rate),
      score: nn(d.model_selection_score),
      sampleSize: nn(d.sample_size),
      sharpSignalDrop: nn(d.sharp_signal_drop),
      environmentRiskLevel: d.environment_risk_level ?? null,
      selectionPopularity: nn(d.selection_popularity),
      decisionReasons: parseReasons(d.decision_reasons),
      // weather
      weather: weather?.weather ?? null,
      windMps: weather?.windMps ?? null,
      waveCm: weather?.waveCm ?? null,
      stablePlate: weather?.stablePlate ?? null,
      weatherPresent: weather != null,
      // exhibition
      headExRank: headEx?.exRank ?? null,
      headExTime: headEx?.exTime ?? null,
      headExSt: headEx?.exSt ?? null,
      exhibitionPresent: exhibitionByBow.size > 0,
      selectedAvgExRank,
      selectedSlowStCount,
      selectedExTop3Count,
      // equipment
      equipmentPresent: selectedEx.some((e) => e.partsCount >= 0),
      selectedPartsCount,
      selectedTiltNonZero,
      // motor/boat
      headMotorTop2: headMotorEntry?.motorTop2 ?? headEx?.motorTop2 ?? null,
      headBoatTop2: headMotorEntry?.boatTop2 ?? headEx?.boatTop2 ?? null,
      motorPresent: headEx?.motorTop2 != null || headMotorEntry?.motorTop2 != null,
      boatPresent: headEx?.boatTop2 != null || headMotorEntry?.boatTop2 != null,
      selectedMotorTopCount,
      selectedMotorLowCount,
      // F
      headFlyingCount: headEntry?.flyingCount ?? null,
      raceFlyingCount,
      attackFlyingCount,
      selectedFlyingTotal,
      fPresent: allEntries.some((e) => e.flyingCount != null),
      winningPayoutYen: payoutsMap.get(d.race_id) ?? null,
      courseFeaturesMap: exhibitionByBow,
    } satisfies Row;
  });
}

type WeatherData = { weather: string | null; windMps: number | null; waveCm: number | null; stablePlate: boolean | null };

function loadWeather(raceIds: string[]): Map<string, WeatherData> {
  const map = new Map<string, WeatherData>();
  for (const ids of chunks(raceIds, 400)) {
    const ph = ids.map(() => "?").join(",");
    // race_weather has wind_speed_mps, wave_height_cm
    // race_conditions has wind_mps, wave_cm
    for (const row of db.prepare(`
      SELECT
        COALESCE(rw.race_id, rc.race_id) AS race_id,
        COALESCE(rw.weather, rc.weather) AS weather,
        COALESCE(rw.wind_speed_mps, rc.wind_mps) AS wind_mps,
        COALESCE(rw.wave_height_cm, rc.wave_cm) AS wave_cm,
        rw.stable_plate
      FROM race_weather rw
      LEFT JOIN race_conditions rc ON rc.race_id = rw.race_id
      WHERE rw.race_id IN (${ph})
      UNION
      SELECT
        rc.race_id,
        COALESCE(rw.weather, rc.weather),
        COALESCE(rw.wind_speed_mps, rc.wind_mps),
        COALESCE(rw.wave_height_cm, rc.wave_cm),
        rw.stable_plate
      FROM race_conditions rc
      LEFT JOIN race_weather rw ON rw.race_id = rc.race_id
      WHERE rc.race_id IN (${ph})
    `).all(...ids, ...ids) as Array<{ race_id: string; weather: string | null; wind_mps: number | null; wave_cm: number | null; stable_plate: number | null }>) {
      if (!map.has(row.race_id)) {
        map.set(row.race_id, {
          weather: row.weather,
          windMps: nn(row.wind_mps),
          waveCm: nn(row.wave_cm),
          stablePlate: row.stable_plate != null ? row.stable_plate !== 0 : null,
        });
      }
    }
  }
  return map;
}

function loadExhibition(raceIds: string[]): Map<string, Map<number, CourseFeature>> {
  const map = new Map<string, Map<number, CourseFeature>>();
  for (const ids of chunks(raceIds, 400)) {
    const ph = ids.map(() => "?").join(",");
    // exhibition_data: race_id, course, exhibition_time, start_timing, ranking
    for (const row of db.prepare(`
      SELECT
        ed.race_id, ed.course,
        ed.exhibition_time, ed.start_timing AS ex_st, ed.ranking AS ex_rank,
        re.tilt_angle, re.parts_changed_count,
        mbs.motor_top2_rate, mbs.boat_top2_rate,
        rp.flying_count, rp.avg_st AS racer_avg_st, rp.top3_rate AS racer_top3_rate,
        ra.racer_reg
      FROM exhibition_data ed
      LEFT JOIN race_equipment re ON re.race_id = ed.race_id AND re.course = ed.course
      LEFT JOIN motor_boat_stats mbs ON mbs.race_id = ed.race_id AND mbs.course = ed.course
      LEFT JOIN race_entries ra ON ra.race_id = ed.race_id AND ra.entry_course = ed.course
      LEFT JOIN racer_profiles rp ON rp.registration_no = ra.racer_reg
      WHERE ed.race_id IN (${ph})
    `).all(...ids) as Array<{
      race_id: string;
      course: number;
      exhibition_time: number | null;
      ex_st: number | null;
      ex_rank: number | null;
      tilt_angle: number | null;
      parts_changed_count: number;
      motor_top2_rate: number | null;
      boat_top2_rate: number | null;
      flying_count: number | null;
      racer_avg_st: number | null;
      racer_top3_rate: number | null;
      racer_reg: string | null;
    }>) {
      if (!map.has(row.race_id)) map.set(row.race_id, new Map());
      map.get(row.race_id)!.set(row.course, {
        exTime: nn(row.exhibition_time),
        exRank: nn(row.ex_rank),
        exSt: nn(row.ex_st),
        tilt: nn(row.tilt_angle),
        partsCount: row.parts_changed_count ?? 0,
        motorTop2: nn(row.motor_top2_rate),
        boatTop2: nn(row.boat_top2_rate),
        flyingCount: nn(row.flying_count),
        lateStartCount: null,
        racerTop3Rate: nn(row.racer_top3_rate),
        racerAvgSt: nn(row.racer_avg_st),
      });
    }
  }
  return map;
}

function loadEquipment(raceIds: string[]): Map<string, Map<number, { partsCount: number; tilt: number | null }>> {
  const map = new Map<string, Map<number, { partsCount: number; tilt: number | null }>>();
  for (const ids of chunks(raceIds, 400)) {
    const ph = ids.map(() => "?").join(",");
    for (const row of db.prepare(`
      SELECT race_id, course, parts_changed_count, tilt_angle
      FROM race_equipment WHERE race_id IN (${ph})
    `).all(...ids) as Array<{ race_id: string; course: number; parts_changed_count: number; tilt_angle: number | null }>) {
      if (!map.has(row.race_id)) map.set(row.race_id, new Map());
      map.get(row.race_id)!.set(row.course, { partsCount: row.parts_changed_count ?? 0, tilt: nn(row.tilt_angle) });
    }
  }
  return map;
}

function loadMotorBoat(raceIds: string[]): Map<string, Map<number, { motorTop2: number | null; boatTop2: number | null }>> {
  const map = new Map<string, Map<number, { motorTop2: number | null; boatTop2: number | null }>>();
  for (const ids of chunks(raceIds, 400)) {
    const ph = ids.map(() => "?").join(",");
    for (const row of db.prepare(`
      SELECT race_id, course, motor_top2_rate, boat_top2_rate
      FROM motor_boat_stats WHERE race_id IN (${ph})
    `).all(...ids) as Array<{ race_id: string; course: number; motor_top2_rate: number | null; boat_top2_rate: number | null }>) {
      if (!map.has(row.race_id)) map.set(row.race_id, new Map());
      map.get(row.race_id)!.set(row.course, { motorTop2: nn(row.motor_top2_rate), boatTop2: nn(row.boat_top2_rate) });
    }
  }
  return map;
}

function loadEntries(raceIds: string[]): Map<string, Map<number, { flyingCount: number | null; racerTop3: number | null; racerAvgSt: number | null }>> {
  const map = new Map<string, Map<number, { flyingCount: number | null; racerTop3: number | null; racerAvgSt: number | null }>>();
  for (const ids of chunks(raceIds, 400)) {
    const ph = ids.map(() => "?").join(",");
    for (const row of db.prepare(`
      SELECT
        re.race_id, re.boat,
        rp.flying_count, rp.top3_rate AS racer_top3, rp.avg_st AS racer_avg_st
      FROM race_entries re
      LEFT JOIN racer_profiles rp ON rp.registration_no = re.racer_reg
      WHERE re.race_id IN (${ph})
    `).all(...ids) as Array<{ race_id: string; boat: number; flying_count: number | null; racer_top3: number | null; racer_avg_st: number | null }>) {
      if (!map.has(row.race_id)) map.set(row.race_id, new Map());
      map.get(row.race_id)!.set(row.boat, {
        flyingCount: nn(row.flying_count),
        racerTop3: nn(row.racer_top3),
        racerAvgSt: nn(row.racer_avg_st),
      });
    }
  }
  return map;
}

function loadTrifectaPayouts(raceIds: string[]): Map<string, number> {
  // race_payouts stores the winning combination and its payout_yen (yen per 100yen stake)
  // payout_yen / 100 ≈ odds
  const map = new Map<string, number>();
  for (const ids of chunks(raceIds, 400)) {
    const ph = ids.map(() => "?").join(",");
    for (const row of db.prepare(`
      SELECT race_id, payout_yen
      FROM race_payouts
      WHERE bet_type = 'trifecta' AND race_id IN (${ph}) AND returned = 0
    `).all(...ids) as Array<{ race_id: string; payout_yen: number }>) {
      if (!map.has(row.race_id)) map.set(row.race_id, row.payout_yen);
    }
  }
  return map;
}

// ───────────────── Metric ─────────────────

function metric(rows: Row[]): Metric {
  const n = rows.length;
  const hits = rows.filter((r) => r.hit).length;
  const hitOdds = rows.filter((r) => r.hit).map((r) => r.currentOdds).sort((a, b) => b - a);
  const totalReturn = hitOdds.reduce((s, o) => s + o, 0);
  const returnEx1 = hitOdds.slice(1).reduce((s, o) => s + o, 0);
  const returnEx3 = hitOdds.slice(3).reduce((s, o) => s + o, 0);
  const avgOdds = n ? rows.reduce((s, r) => s + r.currentOdds, 0) / n : 0;
  return {
    n,
    hits,
    hitRate: n ? hits / n : 0,
    avgOdds,
    roi: n ? (totalReturn / n) * 100 : 0,
    maxHitOdds: hitOdds[0] ?? 0,
    roiExMaxHit: n ? (returnEx1 / n) * 100 : 0,
    roiExMax3Hits: n ? (returnEx3 / n) * 100 : 0,
  };
}

function splitRows(rows: Row[]) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const t = Math.floor(sorted.length * 0.7);
  const v = Math.floor(sorted.length * 0.9);
  return {
    train: sorted.slice(0, t),
    validation: sorted.slice(t, v),
    test: sorted.slice(v),
  };
}

function monthlyStability(rows: Row[]): MonthlyStability {
  const byYm = groupBy(rows, (r) => r.ym);
  const monthly = [...byYm.entries()].map(([, rs]) => metric(rs).roi);
  if (monthly.length === 0) return { label: "n不足", goodMonths: 0, badMonths: 0, totalMonths: 0, worstMonthRoi: 0 };
  const good = monthly.filter((r) => r >= 100).length;
  const bad = monthly.filter((r) => r < 70).length;
  const worst = Math.min(...monthly);
  return {
    label: `${good}/${monthly.length}ヶ月ROI>=100 / ${bad}ヶ月ROI<70 / worst=${pct(worst / 100)}`,
    goodMonths: good,
    badMonths: bad,
    totalMonths: monthly.length,
    worstMonthRoi: worst,
  };
}

// ───────────────── NO_BUY Conditions ─────────────────

type Condition = {
  action: "NO_BUY" | "KEEP";
  family: string;
  label: string;
  fn: (row: Row) => boolean;
};

function buildConditions(): Condition[] {
  const nb = (family: string, label: string, fn: (r: Row) => boolean): Condition => ({ action: "NO_BUY", family, label, fn });
  const kp = (family: string, label: string, fn: (r: Row) => boolean): Condition => ({ action: "KEEP", family, label, fn });

  return [
    // ── A. オッズ系 ──
    nb("odds", "odds >= 30", (r) => r.currentOdds >= 30),
    nb("odds", "odds >= 50", (r) => r.currentOdds >= 50),
    nb("odds", "odds >= 80", (r) => r.currentOdds >= 80),
    nb("odds", "odds >= 100", (r) => r.currentOdds >= 100),
    nb("odds", "odds < 3", (r) => r.currentOdds < 3),
    nb("odds", "odds < 2", (r) => r.currentOdds < 2),
    nb("odds", "3 <= odds < 5", (r) => r.currentOdds >= 3 && r.currentOdds < 5),
    nb("odds", "5 <= odds < 10", (r) => r.currentOdds >= 5 && r.currentOdds < 10),
    nb("odds", "10 <= odds < 20", (r) => r.currentOdds >= 10 && r.currentOdds < 20),
    nb("odds", "20 <= odds < 30", (r) => r.currentOdds >= 20 && r.currentOdds < 30),
    kp("odds", "5 <= odds < 15", (r) => r.currentOdds >= 5 && r.currentOdds < 15),
    kp("odds", "8 <= odds < 20", (r) => r.currentOdds >= 8 && r.currentOdds < 20),
    kp("odds", "10 <= odds < 30", (r) => r.currentOdds >= 10 && r.currentOdds < 30),

    // ── B. 人気系 ──
    nb("popularity", "popularity == 1", (r) => r.selectionPopularity === 1),
    nb("popularity", "popularity <= 2", (r) => (r.selectionPopularity ?? 99) <= 2),
    nb("popularity", "popularity >= 10", (r) => (r.selectionPopularity ?? 0) >= 10),
    nb("popularity", "popularity >= 15", (r) => (r.selectionPopularity ?? 0) >= 15),
    nb("popularity", "popularity >= 20", (r) => (r.selectionPopularity ?? 0) >= 20),

    // ── C. F系 ──
    nb("F", "head F >= 1", (r) => (r.headFlyingCount ?? 0) >= 1),
    nb("F", "head F >= 2", (r) => (r.headFlyingCount ?? 0) >= 2),
    nb("F", "attack F >= 1 (2/3着)", (r) => r.attackFlyingCount >= 1),
    nb("F", "attack F >= 2 (2/3着)", (r) => r.attackFlyingCount >= 2),
    nb("F", "selected F total >= 1", (r) => r.selectedFlyingTotal >= 1),
    nb("F", "selected F total >= 2", (r) => r.selectedFlyingTotal >= 2),
    nb("F", "race F count >= 2", (r) => r.raceFlyingCount >= 2),
    nb("F", "race F count >= 3", (r) => r.raceFlyingCount >= 3),
    nb("F", "head F >= 1 AND wind >= 5", (r) => (r.headFlyingCount ?? 0) >= 1 && (r.windMps ?? 0) >= 5),
    nb("F", "head F >= 1 AND odds >= 20", (r) => (r.headFlyingCount ?? 0) >= 1 && r.currentOdds >= 20),
    nb("F", "head F >= 1 AND ex_rank >= 4", (r) => (r.headFlyingCount ?? 0) >= 1 && (r.headExRank ?? 0) >= 4),

    // ── D. 展示系 ──
    nb("exhibition", "head exRank >= 4", (r) => r.exhibitionPresent && (r.headExRank ?? 0) >= 4),
    nb("exhibition", "head exRank >= 5", (r) => r.exhibitionPresent && (r.headExRank ?? 0) >= 5),
    nb("exhibition", "head exRank >= 6", (r) => r.exhibitionPresent && (r.headExRank ?? 0) >= 6),
    nb("exhibition", "head exSt >= 0.15", (r) => r.exhibitionPresent && (r.headExSt ?? 0) >= 0.15),
    nb("exhibition", "head exSt >= 0.20", (r) => r.exhibitionPresent && (r.headExSt ?? 0) >= 0.20),
    nb("exhibition", "slowSt count >= 2", (r) => r.exhibitionPresent && r.selectedSlowStCount >= 2),
    nb("exhibition", "exTop3 overlap == 0", (r) => r.exhibitionPresent && r.selectedExTop3Count === 0),
    nb("exhibition", "exTop3 overlap <= 1", (r) => r.exhibitionPresent && r.selectedExTop3Count <= 1),
    nb("exhibition", "avgExRank >= 4", (r) => r.exhibitionPresent && (r.selectedAvgExRank ?? 0) >= 4),
    kp("exhibition", "head exRank <= 2", (r) => r.exhibitionPresent && (r.headExRank ?? 99) <= 2),
    kp("exhibition", "head exRank == 1", (r) => r.exhibitionPresent && (r.headExRank ?? 99) === 1),
    kp("exhibition", "exTop3 overlap == 3 (全員Top3)", (r) => r.exhibitionPresent && r.selectedExTop3Count === 3),
    kp("exhibition", "head exSt < 0.10", (r) => r.exhibitionPresent && (r.headExSt ?? 1) < 0.10),
    // 展示悪いのに高オッズ = 更に除外候補
    nb("exhibition", "exRank >= 4 AND odds >= 20", (r) => r.exhibitionPresent && (r.headExRank ?? 0) >= 4 && r.currentOdds >= 20),
    // 展示良いのに高オッズ = keep候補
    kp("exhibition", "exRank <= 2 AND odds >= 15", (r) => r.exhibitionPresent && (r.headExRank ?? 99) <= 2 && r.currentOdds >= 15),

    // ── E. モーター/ボート系 ──
    nb("motor", "head motor < 25%", (r) => r.motorPresent && (r.headMotorTop2 ?? 50) < 25),
    nb("motor", "head motor < 30%", (r) => r.motorPresent && (r.headMotorTop2 ?? 50) < 30),
    nb("motor", "head motor missing", (r) => !r.motorPresent),
    nb("motor", "selected motor low >= 2", (r) => r.selectedMotorLowCount >= 2),
    kp("motor", "head motor >= 50%", (r) => r.motorPresent && (r.headMotorTop2 ?? 0) >= 50),
    kp("motor", "head motor >= 60%", (r) => r.motorPresent && (r.headMotorTop2 ?? 0) >= 60),
    nb("motor", "motor < 25 AND odds >= 20", (r) => r.motorPresent && (r.headMotorTop2 ?? 50) < 25 && r.currentOdds >= 20),
    kp("motor", "motor >= 50 AND odds >= 15", (r) => r.motorPresent && (r.headMotorTop2 ?? 0) >= 50 && r.currentOdds >= 15),
    // モーター高い×展示悪い
    nb("motor", "motor >= 50 AND exRank >= 4", (r) => r.motorPresent && r.exhibitionPresent && (r.headMotorTop2 ?? 0) >= 50 && (r.headExRank ?? 0) >= 4),

    // ── F. 天気系 ──
    nb("weather", "wind >= 5mps", (r) => (r.windMps ?? 0) >= 5),
    nb("weather", "wind >= 8mps", (r) => (r.windMps ?? 0) >= 8),
    nb("weather", "wind >= 10mps", (r) => (r.windMps ?? 0) >= 10),
    nb("weather", "wave >= 5cm", (r) => (r.waveCm ?? 0) >= 5),
    nb("weather", "wave >= 8cm", (r) => (r.waveCm ?? 0) >= 8),
    nb("weather", "wave >= 10cm", (r) => (r.waveCm ?? 0) >= 10),
    nb("weather", "stable_plate=true", (r) => r.stablePlate === true),
    nb("weather", "weather missing", (r) => !r.weatherPresent),
    nb("weather", "wind >= 5 AND wave >= 5", (r) => (r.windMps ?? 0) >= 5 && (r.waveCm ?? 0) >= 5),
    nb("weather", "wind >= 5 AND head F >= 1", (r) => (r.windMps ?? 0) >= 5 && (r.headFlyingCount ?? 0) >= 1),
    nb("weather", "wind >= 5 AND odds >= 30", (r) => (r.windMps ?? 0) >= 5 && r.currentOdds >= 30),
    kp("weather", "wind < 3 AND wave < 3", (r) => r.weatherPresent && (r.windMps ?? 99) < 3 && (r.waveCm ?? 99) < 3),

    // ── G. 会場系 ──
    nb("venue", "venue=桐生", (r) => r.venue === "桐生"),
    nb("venue", "venue=戸田", (r) => r.venue === "戸田"),
    nb("venue", "venue=江戸川", (r) => r.venue === "江戸川"),
    nb("venue", "venue=平和島", (r) => r.venue === "平和島"),
    nb("venue", "venue=多摩川", (r) => r.venue === "多摩川"),
    nb("venue", "venue=浜名湖", (r) => r.venue === "浜名湖"),
    nb("venue", "venue=蒲郡", (r) => r.venue === "蒲郡"),
    nb("venue", "venue=常滑", (r) => r.venue === "常滑"),
    nb("venue", "venue=津", (r) => r.venue === "津"),
    nb("venue", "venue=三国", (r) => r.venue === "三国"),
    nb("venue", "venue=びわこ", (r) => r.venue === "びわこ"),
    nb("venue", "venue=住之江", (r) => r.venue === "住之江"),
    nb("venue", "venue=尼崎", (r) => r.venue === "尼崎"),
    nb("venue", "venue=鳴門", (r) => r.venue === "鳴門"),
    nb("venue", "venue=丸亀", (r) => r.venue === "丸亀"),
    nb("venue", "venue=児島", (r) => r.venue === "児島"),
    nb("venue", "venue=宮島", (r) => r.venue === "宮島"),
    nb("venue", "venue=徳山", (r) => r.venue === "徳山"),
    nb("venue", "venue=下関", (r) => r.venue === "下関"),
    nb("venue", "venue=若松", (r) => r.venue === "若松"),
    nb("venue", "venue=芦屋", (r) => r.venue === "芦屋"),
    nb("venue", "venue=福岡", (r) => r.venue === "福岡"),
    nb("venue", "venue=唐津", (r) => r.venue === "唐津"),
    nb("venue", "venue=大村", (r) => r.venue === "大村"),

    // ── H. レース番号 ──
    nb("raceNo", "raceNo=1", (r) => r.raceNo === 1),
    nb("raceNo", "raceNo=2", (r) => r.raceNo === 2),
    nb("raceNo", "raceNo=3", (r) => r.raceNo === 3),
    nb("raceNo", "raceNo=4", (r) => r.raceNo === 4),
    nb("raceNo", "raceNo=5", (r) => r.raceNo === 5),
    nb("raceNo", "raceNo=6", (r) => r.raceNo === 6),
    nb("raceNo", "raceNo=7", (r) => r.raceNo === 7),
    nb("raceNo", "raceNo=8", (r) => r.raceNo === 8),
    nb("raceNo", "raceNo=9", (r) => r.raceNo === 9),
    nb("raceNo", "raceNo=10", (r) => r.raceNo === 10),
    nb("raceNo", "raceNo=11", (r) => r.raceNo === 11),
    nb("raceNo", "raceNo=12", (r) => r.raceNo === 12),
    nb("raceNo", "raceNo >= 10", (r) => r.raceNo >= 10),
    nb("raceNo", "raceNo <= 6", (r) => r.raceNo <= 6),
    kp("raceNo", "raceNo 7-9", (r) => r.raceNo >= 7 && r.raceNo <= 9),
    kp("raceNo", "raceNo 8-10", (r) => r.raceNo >= 8 && r.raceNo <= 10),

    // ── I. 部品・傾斜 ──
    nb("equipment", "parts >= 1 (1着艇)", (r) => r.equipmentPresent && (r.courseFeaturesMap.get(r.selectionNums[0])?.partsCount ?? 0) >= 1),
    nb("equipment", "selected parts total >= 2", (r) => r.equipmentPresent && r.selectedPartsCount >= 2),
    nb("equipment", "tilt non-zero (1着艇)", (r) => r.equipmentPresent && (r.courseFeaturesMap.get(r.selectionNums[0])?.tilt ?? 0) !== 0),

    // ── J. selection pattern ──
    nb("selection", "4/5/6 含む", (r) => r.selectionNums.some((n) => n >= 4)),
    nb("selection", "1 頭以外", (r) => r.selectionNums[0] !== 1),
    nb("selection", "head == 4", (r) => r.selectionNums[0] === 4),
    nb("selection", "head == 5", (r) => r.selectionNums[0] === 5),
    nb("selection", "head == 6", (r) => r.selectionNums[0] === 6),
    kp("selection", "head == 1", (r) => r.selectionNums[0] === 1),
    kp("selection", "head == 2", (r) => r.selectionNums[0] === 2),
    kp("selection", "1-2-3", (r) => r.selection === "1-2-3"),
    kp("selection", "1-3-2", (r) => r.selection === "1-3-2"),
    kp("selection", "head == 1 AND odds >= 10", (r) => r.selectionNums[0] === 1 && r.currentOdds >= 10),

    // ── K. confidence / score / edge ──
    nb("confidence", "confidence missing", (r) => r.confidence == null),
    nb("confidence", "confidence < 0.05", (r) => r.confidence != null && r.confidence < 0.05),
    nb("confidence", "thin edge (conf ≈ req)", (r) => {
      if (r.confidence == null) return false;
      const margin = r.confidence - r.requiredHitRate;
      return margin >= 0 && margin < 0.01;
    }),
    kp("confidence", "confidence >= 0.12", (r) => (r.confidence ?? 0) >= 0.12),
    kp("confidence", "confidence >= 0.15", (r) => (r.confidence ?? 0) >= 0.15),

    // ── L. 欠損 ──
    nb("missing", "F missing", (r) => !r.fPresent),
    nb("missing", "exhibition missing", (r) => !r.exhibitionPresent),
    nb("missing", "motor missing", (r) => !r.motorPresent),
    nb("missing", "all data missing", (r) => !r.fPresent && !r.exhibitionPresent && !r.motorPresent),

    // ── M. 高配当依存検証 ──
    nb("highOdds", "max1hit odds >= 30 AND roiExMaxHit < 80 proxy", (r) => r.currentOdds >= 30),

    // ── N. environment risk ──
    nb("envRisk", "envRisk = high", (r) => r.environmentRiskLevel === "high"),
    nb("envRisk", "sharpSignalDrop >= 0.1", (r) => (r.sharpSignalDrop ?? 0) >= 0.1),
    nb("envRisk", "sharpSignalDrop >= 0.05", (r) => (r.sharpSignalDrop ?? 0) >= 0.05),

    // ── O. 複合条件 ──
    nb("combo", "F >= 1 AND raceNo >= 10", (r) => (r.headFlyingCount ?? 0) >= 1 && r.raceNo >= 10),
    nb("combo", "F >= 1 AND exSt >= 0.15", (r) => (r.headFlyingCount ?? 0) >= 1 && r.exhibitionPresent && (r.headExSt ?? 0) >= 0.15),
    nb("combo", "F >= 1 AND exRank >= 4", (r) => (r.headFlyingCount ?? 0) >= 1 && r.exhibitionPresent && (r.headExRank ?? 0) >= 4),
    nb("combo", "F >= 1 AND wave >= 5", (r) => (r.headFlyingCount ?? 0) >= 1 && (r.waveCm ?? 0) >= 5),
    nb("combo", "odds >= 50 AND raceNo >= 10", (r) => r.currentOdds >= 50 && r.raceNo >= 10),
    nb("combo", "odds >= 30 AND F >= 1", (r) => r.currentOdds >= 30 && (r.headFlyingCount ?? 0) >= 1),
    nb("combo", "exSt >= 0.15 AND raceNo >= 10", (r) => r.exhibitionPresent && (r.headExSt ?? 0) >= 0.15 && r.raceNo >= 10),
    nb("combo", "exRank >= 4 AND F >= 1 AND odds >= 20", (r) => r.exhibitionPresent && (r.headExRank ?? 0) >= 4 && (r.headFlyingCount ?? 0) >= 1 && r.currentOdds >= 20),
    kp("combo", "raceNo 7-9 AND F == 0", (r) => r.raceNo >= 7 && r.raceNo <= 9 && (r.headFlyingCount ?? 0) === 0),
    kp("combo", "raceNo 7-9 AND odds 5-30", (r) => r.raceNo >= 7 && r.raceNo <= 9 && r.currentOdds >= 5 && r.currentOdds < 30),
    kp("combo", "raceNo 7-9 AND exRank <= 3", (r) => r.raceNo >= 7 && r.raceNo <= 9 && r.exhibitionPresent && (r.headExRank ?? 99) <= 3),
    kp("combo", "raceNo 7-9 AND wind < 5", (r) => r.raceNo >= 7 && r.raceNo <= 9 && r.weatherPresent && (r.windMps ?? 99) < 5),
    kp("combo", "head==1 AND F==0 AND odds>=10", (r) => r.selectionNums[0] === 1 && (r.headFlyingCount ?? 0) === 0 && r.currentOdds >= 10),
    kp("combo", "head==1 AND exRank<=2", (r) => r.selectionNums[0] === 1 && r.exhibitionPresent && (r.headExRank ?? 99) <= 2),
    kp("combo", "motor>=50 AND F==0", (r) => r.motorPresent && (r.headMotorTop2 ?? 0) >= 50 && (r.headFlyingCount ?? 0) === 0),
    kp("combo", "motor>=50 AND exRank<=3", (r) => r.motorPresent && r.exhibitionPresent && (r.headMotorTop2 ?? 0) >= 50 && (r.headExRank ?? 99) <= 3),
    nb("combo", "F >= 1 AND attack F >= 1", (r) => (r.headFlyingCount ?? 0) >= 1 && r.attackFlyingCount >= 1),
    nb("combo", "venue=戸田 AND F >= 1", (r) => r.venue === "戸田" && (r.headFlyingCount ?? 0) >= 1),
    nb("combo", "venue=戸田 AND raceNo >= 10", (r) => r.venue === "戸田" && r.raceNo >= 10),

    // ── P. 選手質 ──
    kp("racerQuality", "racerTop3 >= 0.5 (1着候補)", (r) => {
      const headFeat = r.courseFeaturesMap.get(r.selectionNums[0]);
      return (headFeat?.racerTop3Rate ?? 0) >= 0.5;
    }),
    kp("racerQuality", "racerTop3 >= 0.6 (1着候補)", (r) => {
      const headFeat = r.courseFeaturesMap.get(r.selectionNums[0]);
      return (headFeat?.racerTop3Rate ?? 0) >= 0.6;
    }),
    nb("racerQuality", "racerTop3 < 0.3 (1着候補)", (r) => {
      const headFeat = r.courseFeaturesMap.get(r.selectionNums[0]);
      return headFeat != null && (headFeat.racerTop3Rate ?? 1) < 0.3;
    }),
    kp("racerQuality", "racerAvgSt < 0.15 (1着候補)", (r) => {
      const headFeat = r.courseFeaturesMap.get(r.selectionNums[0]);
      return headFeat != null && (headFeat.racerAvgSt ?? 1) < 0.15;
    }),

    // ── Q. 季節性 ──
    kp("season", "month 4-6 (春)", (r) => {
      const month = Number(r.ym.slice(5));
      return month >= 4 && month <= 6;
    }),
    kp("season", "month 7-9 (夏)", (r) => {
      const month = Number(r.ym.slice(5));
      return month >= 7 && month <= 9;
    }),
    kp("season", "month 10-12 (秋冬)", (r) => {
      const month = Number(r.ym.slice(5));
      return month >= 10 && month <= 12;
    }),
    nb("season", "month 1-3 (寒期)", (r) => {
      const month = Number(r.ym.slice(5));
      return month >= 1 && month <= 3;
    }),

    // ── R. 惜しい外れ分析 (KEEP候補) ──
    kp("miss", "1着一致・2/3着逆 (惜しい外れ)", (r) => {
      if (!r.exhibitionPresent) return false;
      const [a, b, c] = r.selectionNums;
      const [ra, rb, rc] = r.resultNums;
      return !r.hit && a === ra && b === rc && c === rb;
    }),

    // ── S. 複合除外 (複数弱条件の組み合わせ) ──
    nb("multiFilter", "F>=1 OR raceNo>=10 (複合除外)", (r) => (r.headFlyingCount ?? 0) >= 1 || r.raceNo >= 10),
    nb("multiFilter", "F>=1 OR month1-3 (複合除外)", (r) => (r.headFlyingCount ?? 0) >= 1 || Number(r.ym.slice(5)) <= 3),
    nb("multiFilter", "month1-3 OR raceNo>=10 (複合除外)", (r) => Number(r.ym.slice(5)) <= 3 || r.raceNo >= 10),
    nb("multiFilter", "F>=1 OR exSt>=0.15 (複合除外)", (r) => (r.headFlyingCount ?? 0) >= 1 || (r.exhibitionPresent && (r.headExSt ?? 0) >= 0.15)),
    nb("multiFilter", "F>=1 OR exSt>=0.15 OR raceNo>=10", (r) =>
      (r.headFlyingCount ?? 0) >= 1 ||
      (r.exhibitionPresent && (r.headExSt ?? 0) >= 0.15) ||
      r.raceNo >= 10,
    ),

    // ── T. 温かい季節KEEP ──
    kp("season", "month 4-9 (春夏)", (r) => {
      const m = Number(r.ym.slice(5));
      return m >= 4 && m <= 9;
    }),
    kp("season", "month 4-12 (非冬期)", (r) => {
      const m = Number(r.ym.slice(5));
      return m >= 4;
    }),

    // ── U. 複合KEEP ──
    kp("comboKeep", "raceNo7-9 AND F==0 AND month4-12 (非冬)", (r) => {
      const m = Number(r.ym.slice(5));
      return r.raceNo >= 7 && r.raceNo <= 9 && (r.headFlyingCount ?? 0) === 0 && m >= 4;
    }),
    kp("comboKeep", "raceNo7-9 AND F==0 AND exSt<0.15", (r) =>
      r.raceNo >= 7 && r.raceNo <= 9 &&
      (r.headFlyingCount ?? 0) === 0 &&
      (!r.exhibitionPresent || (r.headExSt ?? 0) < 0.15),
    ),
    kp("comboKeep", "exSt<0.10 AND F==0", (r) =>
      r.exhibitionPresent &&
      (r.headExSt ?? 1) < 0.10 &&
      (r.headFlyingCount ?? 0) === 0,
    ),
    kp("comboKeep", "raceNo7-9 AND exSt<0.10", (r) =>
      r.raceNo >= 7 && r.raceNo <= 9 &&
      r.exhibitionPresent && (r.headExSt ?? 1) < 0.10,
    ),
    kp("comboKeep", "month4-9 AND F==0", (r) => {
      const m = Number(r.ym.slice(5));
      return m >= 4 && m <= 9 && (r.headFlyingCount ?? 0) === 0;
    }),
    kp("comboKeep", "month4-9 AND raceNo7-9", (r) => {
      const m = Number(r.ym.slice(5));
      return m >= 4 && m <= 9 && r.raceNo >= 7 && r.raceNo <= 9;
    }),
  ];
}

// ───────────────── Evaluate Condition ─────────────────

function evaluateCondition(cond: Condition, rows: Row[], splits: ReturnType<typeof splitRows>, baseline: Metric): LabCandidate {
  const isNoBuy = cond.action === "NO_BUY";
  const removedRows = rows.filter(cond.fn);
  const afterRows = rows.filter((r) => !cond.fn(r));
  const subsetRows = isNoBuy ? removedRows : removedRows; // for KEEP, subset IS the matching rows

  const removed = metric(removedRows);
  const after = metric(afterRows);
  const subset = removed;

  const trainRemoved = metric(splits.train.filter(cond.fn));
  const validationRemoved = metric(splits.validation.filter(cond.fn));
  const testRemoved = metric(splits.test.filter(cond.fn));

  const trainAfter = metric(splits.train.filter((r) => !cond.fn(r)));
  const validationAfter = metric(splits.validation.filter((r) => !cond.fn(r)));
  const testAfter = metric(splits.test.filter((r) => !cond.fn(r)));

  const stability = monthlyStability(isNoBuy ? afterRows : removedRows);
  const stableRemoved = monthlyStability(removedRows);

  const afterROI = isNoBuy ? after.roi : subset.roi;
  const afterN = isNoBuy ? after.n : subset.n;
  const improvement = afterROI - baseline.roi;

  const trainROI = isNoBuy ? trainAfter.roi : trainRemoved.roi;
  const validationROI = isNoBuy ? validationAfter.roi : validationRemoved.roi;
  const testROI = isNoBuy ? testAfter.roi : testRemoved.roi;
  const trainN = isNoBuy ? trainAfter.n : trainRemoved.n;
  const validationN = isNoBuy ? validationAfter.n : validationRemoved.n;
  const testN = isNoBuy ? testAfter.n : testRemoved.n;

  const warnings = buildWarnings(cond, removed, after, baseline, stableRemoved);
  const judgement = judgeCondition(cond, removed, after, baseline, stability, stableRemoved, trainAfter, validationAfter, testAfter, trainRemoved, validationRemoved, testRemoved);

  return {
    action: cond.action === "KEEP" ? "KEEP" : "NO_BUY",
    family: cond.family,
    label: cond.label,
    condition: cond.label,
    n: removed.n,
    removedROI: removed.roi,
    afterN,
    afterROI,
    baselineROI: baseline.roi,
    improvement,
    hitRate: isNoBuy ? after.hitRate : subset.hitRate,
    avgOdds: isNoBuy ? after.avgOdds : subset.avgOdds,
    stake: afterN * STAKE,
    returnYen: isNoBuy ? (after.roi / 100) * afterN * STAKE : (subset.roi / 100) * subset.n * STAKE,
    avgTickets: 1,
    maxHitOdds: isNoBuy ? after.maxHitOdds : subset.maxHitOdds,
    roiExMaxHit: isNoBuy ? after.roiExMaxHit : subset.roiExMaxHit,
    roiExMax3Hits: isNoBuy ? after.roiExMax3Hits : subset.roiExMax3Hits,
    trainROI,
    trainN,
    validationROI,
    validationN,
    testROI,
    testN,
    worstMonthROI: stability.worstMonthRoi,
    goodMonths: stability.goodMonths,
    badMonths: stability.badMonths,
    totalMonths: stability.totalMonths,
    warnings,
    judgement,
    comment: commentFor(cond, removed, after, baseline, stability),
  };
}

function buildWarnings(cond: Condition, removed: Metric, after: Metric, baseline: Metric, stability: MonthlyStability): string[] {
  const w: string[] = [];
  if (removed.n < 50) w.push("n<50:偽edge疑い");
  if (removed.hits <= 2 && removed.roi > 100) w.push("的中<=2件:高配当依存");
  if (removed.roi > 120 && removed.roiExMaxHit < 80) w.push("最大1hit依存:roiExMax崩れ");
  if (removed.avgOdds >= 50) w.push("平均odds>=50:過剰夢見リスク");
  if (stability.badMonths >= 3) w.push(`月別不安定:${stability.badMonths}ヶ月ROI<70`);
  if (stability.goodMonths <= 1 && stability.totalMonths >= 3) w.push("月別勝ち少ない");
  if (after.n < 300 && cond.action === "NO_BUY") w.push("除外後n<300");
  return w;
}

function judgeCondition(
  cond: Condition,
  removed: Metric,
  after: Metric,
  baseline: Metric,
  stability: MonthlyStability,
  stableRemoved: MonthlyStability,
  trainAfter: Metric,
  validationAfter: Metric,
  testAfter: Metric,
  trainRemoved: Metric,
  validationRemoved: Metric,
  testRemoved: Metric,
): Judgement {
  if (removed.n < 50) return "C";
  if (removed.hits <= 2 && removed.roi > 100) return "D";
  if (removed.roi > 120 && removed.roiExMaxHit < 80) return "D";

  if (cond.action === "NO_BUY") {
    const lift = after.roi - baseline.roi;
    const removedROI = removed.roi;
    const crossSplit = trainAfter.n >= 200 && validationAfter.n >= 50;
    const trainOK = trainAfter.roi >= baseline.roi - 5;
    const validationOK = validationAfter.roi >= baseline.roi - 5;
    const testOK = testAfter.n < 30 || testAfter.roi >= baseline.roi - 10;

    if (
      removed.n >= 300 &&
      removedROI < 70 &&
      lift >= 3 &&
      after.n >= 1000 &&
      crossSplit &&
      trainOK && validationOK && testOK &&
      after.roiExMaxHit >= baseline.roi - 5 &&
      stability.badMonths <= 4  // after rowsが安定 (除外後の残りが月別で崩れない)
    ) return "S";

    if (
      removed.n >= 100 &&
      removedROI < baseline.roi &&
      lift >= 1.5 &&
      after.n >= 300 &&
      crossSplit &&
      trainOK && validationOK
    ) return "A";

    if (removed.n >= 50 && removedROI < baseline.roi && lift > 0) return "B";
    if (removed.n < 100) return "C";
    if (stability.badMonths >= 3 && stableRemoved.goodMonths <= 1) return "D";
    return "C";
  }

  // KEEP
  const crossSplit = trainRemoved.n >= 100 && validationRemoved.n >= 30;
  if (
    removed.n >= 1000 &&
    removed.roi >= 100 &&
    removed.roiExMaxHit >= 90 &&
    crossSplit &&
    trainRemoved.roi >= 90 && validationRemoved.roi >= 90
  ) return "S";
  if (removed.n >= 300 && removed.roi >= 95 && crossSplit && trainRemoved.roi >= 80) return "A";
  if (removed.n >= 100 && removed.roi >= 90) return "B";
  if (removed.n >= 50 && removed.roi >= 85) return "C";
  return "D";
}

function commentFor(cond: Condition, removed: Metric, after: Metric, baseline: Metric, stability: MonthlyStability): string {
  if (cond.action === "NO_BUY") {
    const lift = after.roi - baseline.roi;
    if (removed.n < 50) return `n=${removed.n}<50のため観察のみ。`;
    if (lift > 0) return `除外で残りROI ${pct(lift / 100)}改善。removed ROI=${pct(removed.roi / 100)}。${stability.label}`;
    return `除外効果弱い。removed ROI=${pct(removed.roi / 100)}。`;
  }
  return `残す強BUY候補。n=${removed.n} ROI=${pct(removed.roi / 100)} exMax=${pct(removed.roiExMaxHit / 100)}。${stability.label}`;
}

// ───────────────── Bet Selectors ─────────────────

type BetTicket = { selection: string; odds: number | null };
type BetResult = { tickets: BetTicket[]; hit: boolean; hitOdds: number | null; stakeYen: number; returnYen: number };

function singleTicket(row: Row): BetTicket[] {
  return [{ selection: row.selection, odds: row.currentOdds }];
}

function reverseTicket(row: Row): BetTicket[] {
  const [a, b, c] = row.selectionNums;
  if (!a || !b || !c) return singleTicket(row);
  const rev = `${a}-${c}-${b}`;
  // odds for reverse: we don't have it in DB, use null
  return [
    { selection: row.selection, odds: row.currentOdds },
    { selection: rev, odds: null },
  ];
}

function flowTickets(row: Row): BetTicket[] {
  const [a, b, c] = row.selectionNums;
  if (!a || !b || !c) return singleTicket(row);
  // 1着固定、2/3着総流し (boats 1-6 except a)
  const others = [1, 2, 3, 4, 5, 6].filter((n) => n !== a);
  const tickets: BetTicket[] = [];
  for (let i = 0; i < others.length; i++) {
    for (let j = 0; j < others.length; j++) {
      if (i !== j) tickets.push({ selection: `${a}-${others[i]}-${others[j]}`, odds: null });
    }
  }
  // override original with known odds
  const orig = tickets.find((t) => t.selection === row.selection);
  if (orig) orig.odds = row.currentOdds;
  return tickets;
}

function flow1Fixed2Tickets(row: Row): BetTicket[] {
  const [a, b, c] = row.selectionNums;
  if (!a || !b || !c) return singleTicket(row);
  // 1着・2着固定、3着流し
  const others = [1, 2, 3, 4, 5, 6].filter((n) => n !== a && n !== b);
  return others.map((n) => ({
    selection: `${a}-${b}-${n}`,
    odds: n === c ? row.currentOdds : null,
  }));
}

function boxTickets(row: Row): BetTicket[] {
  const [a, b, c] = row.selectionNums;
  if (!a || !b || !c) return singleTicket(row);
  const boats = [a, b, c];
  const tickets: BetTicket[] = [];
  for (let i = 0; i < boats.length; i++) {
    for (let j = 0; j < boats.length; j++) {
      for (let k = 0; k < boats.length; k++) {
        if (i !== j && j !== k && i !== k) {
          tickets.push({ selection: `${boats[i]}-${boats[j]}-${boats[k]}`, odds: null });
        }
      }
    }
  }
  const orig = tickets.find((t) => t.selection === row.selection);
  if (orig) orig.odds = row.currentOdds;
  return tickets;
}

function evaluateTickets(row: Row, tickets: BetTicket[]): BetResult {
  const stakeYen = tickets.length * STAKE;
  let hit = false;
  let hitOdds: number | null = null;
  let returnYen = 0;

  for (const t of tickets) {
    if (t.selection === row.result) {
      if (t.odds != null) {
        // Original selection: use current_odds (as required)
        hitOdds = t.odds;
      } else if (row.winningPayoutYen != null) {
        // Alternate selection (reverse/flow/box): use actual payout as proxy
        // payout_yen is yen per 100yen, so payout_yen / 100 = odds
        hitOdds = row.winningPayoutYen / 100;
      }
      if (hitOdds != null) {
        hit = true;
        returnYen = hitOdds * STAKE;
      }
      break;
    }
  }
  return { tickets, hit, hitOdds, stakeYen, returnYen };
}

type SelectorDef = {
  name: string;
  family: string;
  label: string;
  applyFn: (row: Row) => boolean;  // どの行に適用するか
  ticketsFn: (row: Row) => BetTicket[];
};

function buildSelectors(): SelectorDef[] {
  return [
    {
      name: "SINGLE_all",
      family: "SINGLE",
      label: "SINGLE (全件ベースライン)",
      applyFn: () => true,
      ticketsFn: singleTicket,
    },
    {
      name: "REVERSE_all",
      family: "REVERSE",
      label: "REVERSE 全件 (2/3着逆)",
      applyFn: () => true,
      ticketsFn: reverseTicket,
    },
    {
      name: "REVERSE_orderUncertain",
      family: "REVERSE",
      label: "REVERSE: 2/3着順序不確実 (headExRank<=3 AND avgExRank>=3)",
      applyFn: (r) => r.exhibitionPresent && (r.headExRank ?? 0) <= 3 && (r.selectedAvgExRank ?? 0) >= 3,
      ticketsFn: reverseTicket,
    },
    {
      name: "FLOW_all",
      family: "FLOW",
      label: "FLOW 1着固定 全件 (20点)",
      applyFn: () => true,
      ticketsFn: flowTickets,
    },
    {
      name: "FLOW_1fix2flow",
      family: "FLOW",
      label: "FLOW 1-2固定 3着流し (4点)",
      applyFn: () => true,
      ticketsFn: flow1Fixed2Tickets,
    },
    {
      name: "FLOW_highWind",
      family: "FLOW",
      label: "FLOW 1着固定 荒天時 (wind>=5)",
      applyFn: (r) => (r.windMps ?? 0) >= 5,
      ticketsFn: flowTickets,
    },
    {
      name: "BOX_all",
      family: "BOX",
      label: "BOX top3 全件 (6点)",
      applyFn: () => true,
      ticketsFn: boxTickets,
    },
    {
      name: "BOX_orderUncertain",
      family: "BOX",
      label: "BOX: 3艇合ってるが順序不確実 (exTop3>=2)",
      applyFn: (r) => r.exhibitionPresent && r.selectedExTop3Count >= 2,
      ticketsFn: boxTickets,
    },
    {
      name: "BOX_highWave",
      family: "BOX",
      label: "BOX: 荒天 (wave>=5cm)",
      applyFn: (r) => (r.waveCm ?? 0) >= 5,
      ticketsFn: boxTickets,
    },
    {
      name: "PAPER_F",
      family: "PAPER_ONLY",
      label: "PAPER_ONLY: head F>=1",
      applyFn: (r) => (r.headFlyingCount ?? 0) >= 1,
      ticketsFn: singleTicket,
    },
    {
      name: "PAPER_highOdds",
      family: "PAPER_ONLY",
      label: "PAPER_ONLY: odds>=30",
      applyFn: (r) => r.currentOdds >= 30,
      ticketsFn: singleTicket,
    },
    {
      name: "PAPER_badEx",
      family: "PAPER_ONLY",
      label: "PAPER_ONLY: exRank>=5",
      applyFn: (r) => r.exhibitionPresent && (r.headExRank ?? 0) >= 5,
      ticketsFn: singleTicket,
    },
    {
      name: "BOX_raceNo7to9",
      family: "BOX",
      label: "BOX: raceNo7-9 (順序不確実な中日レース)",
      applyFn: (r) => r.raceNo >= 7 && r.raceNo <= 9,
      ticketsFn: boxTickets,
    },
    {
      name: "REVERSE_noF",
      family: "REVERSE",
      label: "REVERSE: F==0 (F無し×2/3着逆)",
      applyFn: (r) => (r.headFlyingCount ?? 0) === 0,
      ticketsFn: reverseTicket,
    },
    {
      name: "BOX_goodEx",
      family: "BOX",
      label: "BOX: exRank<=3 (展示上位3艇)",
      applyFn: (r) => r.exhibitionPresent && (r.headExRank ?? 99) <= 3 && r.selectedExTop3Count >= 2,
      ticketsFn: boxTickets,
    },
    {
      name: "FLOW_noF_7to9",
      family: "FLOW",
      label: "FLOW 1-2固定: raceNo7-9 AND F==0",
      applyFn: (r) => r.raceNo >= 7 && r.raceNo <= 9 && (r.headFlyingCount ?? 0) === 0,
      ticketsFn: flow1Fixed2Tickets,
    },
  ];
}

function evaluateSelector(sel: SelectorDef, rows: Row[], splits: ReturnType<typeof splitRows>, baseline: Metric): BetSelectorCandidate {
  const applyRows = rows.filter(sel.applyFn);
  // 正しい比較ベース: 同じサブセットにSINGLEを適用した場合のROI
  const subsetSingleROI = metric(applyRows).roi;

  function calcSelector(rs: Row[]) {
    let totalStake = 0;
    let totalReturn = 0;
    let hitRaces = 0;
    let totalTickets = 0;
    const hitOddsList: number[] = [];
    const ymHits = new Map<string, number>();
    const ymStakes = new Map<string, number>();

    for (const r of rs) {
      const result = evaluateTickets(r, sel.ticketsFn(r));
      totalStake += result.stakeYen;
      totalReturn += result.returnYen;
      totalTickets += result.tickets.length;
      if (result.hit) {
        hitRaces++;
        if (result.hitOdds != null) hitOddsList.push(result.hitOdds);
      }
      ymHits.set(r.ym, (ymHits.get(r.ym) ?? 0) + (result.hit ? result.returnYen : 0));
      ymStakes.set(r.ym, (ymStakes.get(r.ym) ?? 0) + result.stakeYen);
    }

    const n = rs.length;
    const roi = totalStake > 0 ? (totalReturn / totalStake) * 100 : 0;
    const hitOddsSorted = [...hitOddsList].sort((a, b) => b - a);
    const returnEx1 = hitOddsSorted.slice(1).reduce((s, o) => s + o * STAKE, 0);
    const roiExMaxHit = totalStake > 0 ? ((totalReturn - (hitOddsSorted[0] ?? 0) * STAKE + returnEx1 - returnEx1) / totalStake) * 100 : 0;
    // simplified roiExMaxHit
    const roiExMax = hitOddsSorted.length > 0
      ? ((totalReturn - hitOddsSorted[0] * STAKE) / (totalStake - STAKE)) * 100  // remove 1 stake too
      : roi;

    const monthlyRois = [...ymStakes.entries()].map(([ym, stake]) => ({
      ym,
      roi: stake > 0 ? ((ymHits.get(ym) ?? 0) / stake) * 100 : 0,
    }));
    const goodMonths = monthlyRois.filter((m) => m.roi >= 100).length;
    const badMonths = monthlyRois.filter((m) => m.roi < 70).length;
    const worstMonthROI = monthlyRois.length > 0 ? Math.min(...monthlyRois.map((m) => m.roi)) : 0;

    return { n, totalStake, totalReturn, roi, hitRaces, totalTickets, maxHitOdds: hitOddsSorted[0] ?? 0, roiExMaxHit: roiExMax, goodMonths, badMonths, worstMonthROI, monthCount: monthlyRois.length };
  }

  const full = calcSelector(applyRows);
  const trainRows = splits.train.filter(sel.applyFn);
  const validationRows = splits.validation.filter(sel.applyFn);
  const testRows = splits.test.filter(sel.applyFn);
  const trainCalc = calcSelector(trainRows);
  const validationCalc = calcSelector(validationRows);
  const testCalc = calcSelector(testRows);

  // improvement: vs サブセットSINGLE (全件比較ではなく同subset比較)
  const improvement = full.roi - subsetSingleROI;
  const warnings: string[] = [];
  if (full.n < 50) warnings.push("n<50");
  if (full.totalTickets / Math.max(full.n, 1) > 10) warnings.push("avg_tickets>10:コスト増大");
  if (full.maxHitOdds > 50 && full.roiExMaxHit < 70) warnings.push("高配当1発依存");
  if (full.badMonths >= 3) warnings.push(`${full.badMonths}ヶ月ROI<70`);
  if (sel.name !== "SINGLE_all" && Math.abs(subsetSingleROI - baseline.roi) > 3) {
    warnings.push(`subsetSingle=${pct(subsetSingleROI / 100)} vs baseAll=${pct(baseline.roi / 100)}`);
  }

  const judgement = judgeSelector(full, { ...baseline, roi: subsetSingleROI }, trainCalc, validationCalc, testCalc, improvement);

  return {
    action: "BET_SELECTOR",
    family: sel.family,
    label: sel.label,
    selectorName: sel.name,
    applyCondition: sel.label,
    n: full.n,
    totalTickets: full.totalTickets,
    avgTickets: full.n > 0 ? full.totalTickets / full.n : 0,
    hitRaces: full.hitRaces,
    hitRate: full.n > 0 ? full.hitRaces / full.n : 0,
    totalStake: full.totalStake,
    totalReturn: full.totalReturn,
    roi: full.roi,
    baselineROI: subsetSingleROI,  // サブセットSINGLEを比較ベースに
    improvement,
    maxHitOdds: full.maxHitOdds,
    roiExMaxHit: full.roiExMaxHit,
    trainROI: trainCalc.roi,
    validationROI: validationCalc.roi,
    testROI: testCalc.roi,
    worstMonthROI: full.worstMonthROI,
    goodMonths: full.goodMonths,
    badMonths: full.badMonths,
    warnings,
    judgement,
  };
}

function judgeSelector(
  full: { n: number; roi: number; roiExMaxHit: number; maxHitOdds: number; badMonths: number; totalTickets: number },
  baseline: Metric,
  train: { roi: number; n: number },
  validation: { roi: number; n: number },
  test: { roi: number; n: number },
  improvement: number,
): Judgement {
  if (full.n < 50) return "C";
  if (full.maxHitOdds > 50 && full.roiExMaxHit < 70) return "D";
  if (full.totalTickets / Math.max(full.n, 1) > 15) return "D"; // too many tickets

  const crossSplit = train.n >= 200 && validation.n >= 50;
  if (
    full.n >= 1000 &&
    improvement >= 3 &&
    full.roiExMaxHit >= baseline.roi - 5 &&
    crossSplit &&
    train.roi >= baseline.roi - 5 &&
    validation.roi >= baseline.roi - 5 &&
    (test.n < 30 || test.roi >= baseline.roi - 10) &&
    full.badMonths <= 1
  ) return "S";

  if (full.n >= 300 && improvement >= 1.5 && crossSplit && train.roi >= baseline.roi - 5 && validation.roi >= baseline.roi - 5) return "A";
  if (full.n >= 100 && improvement > 0) return "B";
  if (full.n < 100) return "C";
  return "C";
}

// ───────────────── Main ─────────────────

try {
  console.log("[roi-decision-lab] loading rows...");
  const rows = loadRows();
  const splits = splitRows(rows);
  const baseline = metric(rows);
  const baselineStability = monthlyStability(rows);

  const payoutCoverage = rows.filter((r) => r.winningPayoutYen != null).length;
  console.log(`[roi-decision-lab] loaded ${rows.length} BUY rows`);
  console.log(`[roi-decision-lab] baseline ROI=${pct(baseline.roi / 100)} n=${baseline.n} hits=${baseline.hits} hitRate=${pct(baseline.hitRate)}`);
  console.log(`[roi-decision-lab] trifecta payout coverage: ${payoutCoverage}/${rows.length} races (${pct(payoutCoverage / rows.length)})`);


  const conditions = buildConditions();
  const candidates = conditions.map((c) => evaluateCondition(c, rows, splits, baseline));
  const selectors = buildSelectors();
  const selectorResults = selectors.map((s) => evaluateSelector(s, rows, splits, baseline));

  // Sort
  const noBuyCandidates = candidates
    .filter((c) => c.action === "NO_BUY")
    .sort((a, b) => b.improvement - a.improvement || b.n - a.n);
  const keepCandidates = candidates
    .filter((c) => c.action === "KEEP")
    .sort((a, b) => b.afterROI - a.afterROI || b.afterN - a.afterN);
  const sOrA = [...noBuyCandidates, ...keepCandidates].filter((c) => c.judgement === "S" || c.judgement === "A");
  const selectorSOrA = selectorResults.filter((s) => s.judgement === "S" || s.judgement === "A");
  const risky = [...noBuyCandidates, ...keepCandidates].filter((c) => c.judgement === "D");

  const report = {
    generatedAt: new Date().toISOString(),
    dbPath: DB_PATH,
    baseline: {
      n: baseline.n,
      hits: baseline.hits,
      hitRate: baseline.hitRate,
      avgOdds: baseline.avgOdds,
      roi: baseline.roi,
      roiExMaxHit: baseline.roiExMaxHit,
      roiExMax3Hits: baseline.roiExMax3Hits,
      maxHitOdds: baseline.maxHitOdds,
      period: { from: rows[0]?.date ?? null, to: rows.at(-1)?.date ?? null },
      monthlyStability: baselineStability,
    },
    stableCandidates: sOrA,
    noBuyCandidates: noBuyCandidates.slice(0, 50),
    keepCandidates: keepCandidates.slice(0, 30),
    betSelectors: selectorResults,
    betSelectorSOrA: selectorSOrA,
    risky,
    allConditions: candidates,
  };

  mkdirSync("reports", { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUT_MD, renderMarkdown(report));
  console.log(`[roi-decision-lab] wrote ${OUT_MD}`);
  console.log(`[roi-decision-lab] wrote ${OUT_JSON}`);
  console.log(`[roi-decision-lab] S/A candidates: ${sOrA.length} condition, ${selectorSOrA.length} selector`);
} finally {
  db.close();
}

// ───────────────── Render ─────────────────

function renderMarkdown(r: {
  baseline: { n: number; hits: number; hitRate: number; avgOdds: number; roi: number; roiExMaxHit: number; roiExMax3Hits: number; maxHitOdds: number; period: { from: string | null; to: string | null }; monthlyStability: MonthlyStability };
  stableCandidates: LabCandidate[];
  noBuyCandidates: LabCandidate[];
  keepCandidates: LabCandidate[];
  betSelectors: BetSelectorCandidate[];
  betSelectorSOrA: BetSelectorCandidate[];
  risky: LabCandidate[];
}) {
  const lines: string[] = [];
  const b = r.baseline;

  lines.push("# ROI Decision Lab", "");
  lines.push("**禁止事項**: DB変更不可 / app_settings変更不可 / 本番decision変更不可 / 自動投票禁止 / BUYは検証候補のみ", "");

  // 1. 結論
  const hasS = r.stableCandidates.some((c) => c.judgement === "S") || r.betSelectorSOrA.some((c) => c.judgement === "S");
  const hasA = r.stableCandidates.some((c) => c.judgement === "A") || r.betSelectorSOrA.some((c) => c.judgement === "A");
  const verdict = hasS ? "PAPER-STRONG" : hasA ? "PAPER" : "NO-GO";
  lines.push("## 1. 結論", "");
  lines.push(`**判定: ${verdict}**`, "");
  lines.push(`- S候補: ${r.stableCandidates.filter((c) => c.judgement === "S").length}件 (条件) + ${r.betSelectorSOrA.filter((c) => c.judgement === "S").length}件 (selector)`);
  lines.push(`- A候補: ${r.stableCandidates.filter((c) => c.judgement === "A").length}件 (条件) + ${r.betSelectorSOrA.filter((c) => c.judgement === "A").length}件 (selector)`);
  lines.push(`- **本番反映: 不可 — まずpaper検証候補として扱うこと**`, "");

  // 2. Baseline
  lines.push("## 2. Baseline", "");
  lines.push(`| 項目 | 値 |`);
  lines.push(`|---|---|`);
  lines.push(`| 対象期間 | ${b.period.from ?? "-"} 〜 ${b.period.to ?? "-"} |`);
  lines.push(`| BUY件数 (n) | ${b.n} |`);
  lines.push(`| 的中数 | ${b.hits} |`);
  lines.push(`| 的中率 | ${pct(b.hitRate)} |`);
  lines.push(`| 平均odds | ${num(b.avgOdds)} |`);
  lines.push(`| ROI | **${pct(b.roi / 100)}** |`);
  lines.push(`| ROI (最大1hit除外) | ${pct(b.roiExMaxHit / 100)} |`);
  lines.push(`| ROI (最大3hit除外) | ${pct(b.roiExMax3Hits / 100)} |`);
  lines.push(`| 最大的中odds | ${num(b.maxHitOdds)} |`);
  lines.push(`| 月別安定性 | ${b.monthlyStability.label} |`);
  lines.push("");

  // 3. Stable Candidates (S/A)
  lines.push("## 3. Stable Candidates (S/A — paper検証候補)", "");
  if (r.stableCandidates.length === 0) {
    lines.push("S/A候補なし。", "");
  } else {
    lines.push("| 判定 | action | family | label | removed n | removed ROI | afterN | afterROI | +ROI | hitRate | roiExMax | trainROI | valROI | testROI | worstMth | warnings |");
    lines.push("|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|");
    for (const c of r.stableCandidates) {
      lines.push(`| **${c.judgement}** | ${c.action} | ${c.family} | ${esc(c.label)} | ${c.n} | ${pct(c.removedROI / 100)} | ${c.afterN} | ${pct(c.afterROI / 100)} | ${signPct(c.improvement / 100)} | ${pct(c.hitRate)} | ${pct(c.roiExMaxHit / 100)} | ${pct(c.trainROI / 100)} | ${pct(c.validationROI / 100)} | ${pct(c.testROI / 100)} | ${pct(c.worstMonthROI / 100)} | ${c.warnings.join(", ")} |`);
    }
    lines.push("");
  }

  // 4. NO BUY Candidates
  lines.push("## 4. NO BUY Candidates (除外でROI改善)", "");
  const topNoBuy = r.noBuyCandidates.filter((c) => c.improvement > 0).slice(0, 30);
  if (topNoBuy.length === 0) {
    lines.push("有効なNO BUY候補なし。", "");
  } else {
    lines.push("| 判定 | family | label | removed n | removed ROI | afterN | afterROI | +ROI | roiExMax | warnings |");
    lines.push("|---|---|---|---:|---:|---:|---:|---:|---:|---|");
    for (const c of topNoBuy) {
      lines.push(`| ${c.judgement} | ${c.family} | ${esc(c.label)} | ${c.n} | ${pct(c.removedROI / 100)} | ${c.afterN} | ${pct(c.afterROI / 100)} | ${signPct(c.improvement / 100)} | ${pct(c.roiExMaxHit / 100)} | ${c.warnings.join(", ")} |`);
    }
    lines.push("");
  }

  // 5. Bet Selector Candidates
  lines.push("## 5. Bet Selector Candidates", "");
  lines.push("| 判定 | family | label | n | avgTickets | hitRate | ROI | base ROI | +ROI | roiExMax | trainROI | valROI | testROI | worst月 | warnings |");
  lines.push("|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const s of r.betSelectors.sort((a, b) => b.improvement - a.improvement)) {
    lines.push(`| ${s.judgement} | ${s.family} | ${esc(s.label)} | ${s.n} | ${num(s.avgTickets)} | ${pct(s.hitRate)} | ${pct(s.roi / 100)} | ${pct(s.baselineROI / 100)} | ${signPct(s.improvement / 100)} | ${pct(s.roiExMaxHit / 100)} | ${pct(s.trainROI / 100)} | ${pct(s.validationROI / 100)} | ${pct(s.testROI / 100)} | ${pct(s.worstMonthROI / 100)} | ${s.warnings.join(", ")} |`);
  }
  lines.push("");

  // 6. Risky / Do Not Ship
  lines.push("## 6. Risky / Do Not Ship (D判定)", "");
  if (r.risky.length === 0) {
    lines.push("D候補なし。", "");
  } else {
    lines.push("| family | label | n | ROI | warnings |");
    lines.push("|---|---|---:|---:|---|");
    for (const c of r.risky.slice(0, 20)) {
      lines.push(`| ${c.family} | ${esc(c.label)} | ${c.n} | ${pct(c.afterROI / 100)} | ${c.warnings.join(", ")} |`);
    }
    lines.push("");
  }

  // 7. 月別安定性
  lines.push("## 7. 月別安定性 (Baseline)", "");
  lines.push(`- worst month ROI: ${pct(b.monthlyStability.worstMonthRoi / 100)}`);
  lines.push(`- ROI >= 100 ヶ月: ${b.monthlyStability.goodMonths} / ${b.monthlyStability.totalMonths}`);
  lines.push(`- ROI < 70 ヶ月: ${b.monthlyStability.badMonths} / ${b.monthlyStability.totalMonths}`);
  lines.push("");

  // 8. KEEP Candidates (top)
  lines.push("## 8. KEEP Candidates (強いBUY条件)", "");
  const topKeep = r.keepCandidates.slice(0, 20);
  if (topKeep.length === 0) {
    lines.push("B以上候補なし。全KEEP候補はJSONを参照。", "");
  } else {
    lines.push("| 判定 | family | label | n | ROI | roiExMax | trainROI | valROI | testROI | worst月 | warnings |");
    lines.push("|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|");
    for (const c of topKeep) {
      lines.push(`| ${c.judgement} | ${c.family} | ${esc(c.label)} | ${c.n} | ${pct(c.removedROI / 100)} | ${pct(c.roiExMaxHit / 100)} | ${pct(c.trainROI / 100)} | ${pct(c.validationROI / 100)} | ${pct(c.testROI / 100)} | ${pct(c.worstMonthROI / 100)} | ${c.warnings.join(", ")} |`);
    }
    lines.push("");
  }

  // 9. 次にpaper検証すべき候補
  lines.push("## 9. 次にpaper検証すべき候補", "");
  const nextPaper = [...r.stableCandidates, ...r.betSelectorSOrA].slice(0, 5);
  if (nextPaper.length === 0) {
    lines.push("まずB候補の月別・test期間安定性を追加確認すること。", "");
  } else {
    for (const c of nextPaper) {
      lines.push(`- ${c.judgement}: ${c.label} (n=${"n" in c ? c.n : "?"}, ROI=${pct(("afterROI" in c ? c.afterROI : (c as BetSelectorCandidate).roi) / 100)})`);
    }
    lines.push("");
  }

  // 10. まだ足りないfeature
  lines.push("## 10. まだ足りないfeature / 次の仮説", "");
  lines.push("- 選手×コース一致率（当地巧者 vs 非当地）");
  lines.push("- 直近5走の成績トレンド");
  lines.push("- CLV（closing line value）— odds動き最終比較");
  lines.push("- 買い目3艇の展示順位一致スコア");
  lines.push("- 会場別 × レース番号 × 天候の複合条件（n>=100確保できる範囲で）");
  lines.push("- 当地モーター vs 全国モーターの乖離");
  lines.push("- 惜しい外れ（1着一致・2/3着逆）の分析");
  lines.push("");

  lines.push("---");
  lines.push(`*生成: ${new Date().toISOString()} / DB: ${DB_PATH}*`);
  lines.push("");

  return lines.join("\n");
}

// ───────────────── Helpers ─────────────────

function parseNums(s: string): number[] {
  return s.split("-").map(Number).filter((n) => Number.isFinite(n) && n > 0);
}

function parseReasons(s: string | null): string[] {
  if (!s) return [];
  try {
    const p = JSON.parse(s);
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return [];
  }
}

function nn(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

function pct(v: number): string {
  if (!Number.isFinite(v)) return "-";
  return `${(v * 100).toFixed(2)}%`;
}

function signPct(v: number): string {
  if (!Number.isFinite(v)) return "-";
  const s = v >= 0 ? "+" : "";
  return `${s}${(v * 100).toFixed(2)}%`;
}

function num(v: number): string {
  if (!Number.isFinite(v)) return "-";
  return v.toFixed(2);
}

function esc(s: string): string {
  return s.replaceAll("|", "\\|");
}
