/**
 * isBase内リスク削減分析 — 読み取り専用
 *
 * 禁止:
 * - DB INSERT / UPDATE / DELETE / DROP
 * - app_settings 変更
 * - 本番decisionロジック変更
 *
 * 目的:
 * isBase条件(月4/6/8/12×parts=0×wind>=3×headF=0×exSt安全)内で
 * 最大連敗102を60以下・DDをさらに低減できる条件を探す。
 * ROIは150〜180%に落ちてもよい。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/roi-isbase-risk.md";
const OUT_JSON = "reports/roi-isbase-risk.json";
const STAKE = 100;

// リスク削減目標
const TARGET_MAX_STREAK = 60;
const TARGET_MAX_DD_PCT = 12;
const MIN_ROI_AFTER_CUT = 150; // この以上なら「ROI維持」とみなす
const MIN_N_FOR_ANALYSIS = 15;

if (!existsSync(DB_PATH)) {
  console.error(`[isbase-risk] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

// ───────────────── Types ─────────────────

type Row = {
  id: number;
  raceId: string;
  date: string;
  ym: string;
  month: number;
  venue: string;
  raceNo: number;
  selection: string;
  selNums: number[];
  result: string;
  resultNums: number[];
  hit: boolean;
  currentOdds: number;
  windMps: number;
  waveCm: number | null;
  partsCount: number;
  headExSt: number | null;
  motorTop2: number | null;
  missType: MissType;
};

type MissType =
  | "HIT"
  | "COMPLETE_MISS"
  | "HEAD_CORRECT"   // 1着正解・2/3着外れ(逆含む)
  | "TOP3_INCLUDED"; // 3艇がTop3に含まれていた

type Metric = {
  n: number;
  hits: number;
  hitRate: number;
  roi: number;
  roiExMaxHit: number;
  roiExMax3Hits: number;
  maxHitOdds: number;
  avgOdds: number;
};

type DrawdownResult = {
  maxStreakN: number;
  avgStreak: number;
  maxDDPct: number;
  maxDDYen100: number;
  completeMissRate: number;
  avgHitInterval: number;
  maxHitInterval: number;
};

type SubgroupStats = {
  label: string;
  condition: string;
  n: number;
  metric: Metric;
  dd: DrawdownResult;
  // この条件を除外した場合の残り集合
  remainN: number;
  remainMetric: Metric;
  remainDd: DrawdownResult;
  // 分類
  classification: "CUT_CANDIDATE" | "KEEP_STRONG" | "PAPER_ONLY" | "WATCH" | "INSUFFICIENT";
  cutImpact: CutImpact;
  explanation: string;
  recommendation: string;
};

type CutImpact = {
  roiChange: number;        // remainMetric.roi - baselineMetric.roi
  streakChange: number;     // remainDd.maxStreakN - baselineDd.maxStreakN
  ddPctChange: number;      // remainDd.maxDDPct - baselineDd.maxDDPct
  roiAfterCut: number;
  streakAfterCut: number;
  ddAfterCut: number;
  worthCutting: boolean;    // ROI維持 AND ストリーク/DD改善
};

type RiskReport = {
  generatedAt: string;
  dbPath: string;
  isBaseN: number;
  baselineMetric: Metric;
  baselineDd: DrawdownResult;
  // 目標
  targets: { maxStreak: number; maxDDPct: number; minROI: number };
  // 各次元の分析
  dimensions: { name: string; subgroups: SubgroupStats[] }[];
  // CUT推奨
  cutCandidates: SubgroupStats[];
  // 最適化シミュレーション
  cutSimulations: CutSimulation[];
  // keepStrong
  keepStrong: SubgroupStats[];
};

type CutSimulation = {
  label: string;
  cutConditions: string[];
  remainN: number;
  remainMetric: Metric;
  remainDd: DrawdownResult;
  verdict: string;
};

// ───────────────── Load ─────────────────

function loadIsBaseRows(): Row[] {
  const raw = db.prepare(`
    SELECT
      dh.id, dh.race_id, dh.date, dh.venue, dh.race_no,
      dh.selection, dh.current_odds, dh.result,
      rw.wind_speed_mps, rw.wave_height_cm,
      re.parts_changed_count,
      ed.start_timing AS head_ex_st,
      ms.motor_top2_rate
    FROM decision_history dh
    JOIN race_equipment re ON dh.race_id = re.race_id
      AND CAST(substr(dh.selection,1,instr(dh.selection,'-')-1) AS INT) = re.course
    JOIN exhibition_data ed ON dh.race_id = ed.race_id
      AND CAST(substr(dh.selection,1,instr(dh.selection,'-')-1) AS INT) = ed.course
    LEFT JOIN race_weather rw ON dh.race_id = rw.race_id
    LEFT JOIN motor_boat_stats ms ON dh.race_id = ms.race_id
      AND CAST(substr(dh.selection,1,instr(dh.selection,'-')-1) AS INT) = ms.course
    LEFT JOIN race_entries ra ON ra.race_id = dh.race_id
      AND ra.entry_course = CAST(substr(dh.selection,1,instr(dh.selection,'-')-1) AS INT)
    LEFT JOIN racer_profiles rp ON rp.registration_no = ra.racer_reg
    WHERE dh.run_kind = 'historical-backfill'
      AND dh.decision = 'BUY'
      AND dh.current_odds IS NOT NULL
      AND dh.result IS NOT NULL
      AND substr(dh.date,6,2) IN ('04','06','08','12')
      AND re.parts_changed_count = 0
      AND dh.race_no < 10
      AND dh.venue NOT IN ('戸田','多摩川')
      AND (rw.wind_speed_mps IS NULL OR rw.wind_speed_mps >= 3)
      AND (rp.flying_count IS NULL OR rp.flying_count = 0)
      AND (ed.start_timing IS NULL OR ed.start_timing < 0.10 OR ed.start_timing >= 0.15)
    ORDER BY dh.date, dh.id
  `).all() as Array<{
    id: number; race_id: string; date: string; venue: string; race_no: number;
    selection: string; current_odds: number; result: string | null;
    wind_speed_mps: number | null; wave_height_cm: number | null;
    parts_changed_count: number | null;
    head_ex_st: number | null; motor_top2_rate: number | null;
  }>;

  return raw.map((r) => {
    const selNums = parseNums(r.selection);
    const resultNums = parseNums(r.result ?? "");
    const hit = r.result != null && r.result === r.selection;
    return {
      id: r.id,
      raceId: r.race_id,
      date: r.date,
      ym: r.date.slice(0, 7),
      month: Number(r.date.slice(5, 7)),
      venue: r.venue,
      raceNo: r.race_no,
      selection: r.selection,
      selNums,
      result: r.result ?? "",
      resultNums,
      hit,
      currentOdds: r.current_odds,
      windMps: r.wind_speed_mps ?? 3,
      waveCm: r.wave_height_cm,
      partsCount: r.parts_changed_count ?? 0,
      headExSt: r.head_ex_st,
      motorTop2: r.motor_top2_rate,
      missType: computeMissType(selNums, resultNums, hit),
    };
  });
}

function parseNums(s: string): number[] {
  return s.split("-").map(Number).filter((n) => Number.isFinite(n) && n > 0);
}

function computeMissType(selNums: number[], resultNums: number[], hit: boolean): MissType {
  if (hit) return "HIT";
  if (selNums.length < 3 || resultNums.length < 3) return "COMPLETE_MISS";
  const [s1] = selNums;
  const [r1] = resultNums;
  if (s1 === r1) return "HEAD_CORRECT";
  const selSet = new Set(selNums);
  const resSet = new Set(resultNums.slice(0, 3));
  if ([...selSet].every((n) => resSet.has(n))) return "TOP3_INCLUDED";
  return "COMPLETE_MISS";
}

// ───────────────── Metrics & Drawdown ─────────────────

function calcMetric(rows: Row[]): Metric {
  const n = rows.length;
  if (n === 0) return { n: 0, hits: 0, hitRate: 0, avgOdds: 0, roi: 0, roiExMaxHit: 0, roiExMax3Hits: 0, maxHitOdds: 0 };
  const hits = rows.filter((r) => r.hit).length;
  const hitOdds = rows.filter((r) => r.hit).map((r) => r.currentOdds).sort((a, b) => b - a);
  const total = hitOdds.reduce((s, o) => s + o, 0);
  const ex1 = hitOdds.slice(1).reduce((s, o) => s + o, 0);
  const ex3 = hitOdds.slice(3).reduce((s, o) => s + o, 0);
  const avgOdds = rows.reduce((s, r) => s + r.currentOdds, 0) / n;
  return {
    n, hits, hitRate: hits / n, avgOdds,
    roi: (total / n) * 100,
    roiExMaxHit: (ex1 / n) * 100,
    roiExMax3Hits: (ex3 / n) * 100,
    maxHitOdds: hitOdds[0] ?? 0,
  };
}

function calcDrawdown(rows: Row[]): DrawdownResult {
  if (rows.length === 0) {
    return { maxStreakN: 0, avgStreak: 0, maxDDPct: 0, maxDDYen100: 0, completeMissRate: 0, avgHitInterval: 0, maxHitInterval: 0 };
  }

  // 連敗
  const streaks: number[] = [];
  let cur = 0;
  for (const r of rows) {
    if (!r.hit) { cur++; } else { if (cur > 0) streaks.push(cur); cur = 0; }
  }
  if (cur > 0) streaks.push(cur);
  const maxStreak = streaks.length > 0 ? Math.max(...streaks) : 0;
  const avgStreak = streaks.length > 0 ? streaks.reduce((s, v) => s + v, 0) / streaks.length : 0;

  // ドローダウン (100円固定)
  let balance = 0, peak = 0, maxDD = 0;
  for (const r of rows) {
    balance -= STAKE;
    if (r.hit) balance += r.currentOdds * STAKE;
    peak = Math.max(peak, balance);
    maxDD = Math.max(maxDD, peak - balance);
  }
  // DD%: 最大ドローダウン / (最大残高 + 総投資額) の割合
  const totalInvested = rows.length * STAKE;
  const maxDDPct = totalInvested > 0 ? (maxDD / totalInvested) * 100 : 0;

  // 的中間隔
  const intervals: number[] = [];
  let lastIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].hit) { if (lastIdx >= 0) intervals.push(i - lastIdx); lastIdx = i; }
  }
  const avgInterval = intervals.length > 0 ? intervals.reduce((s, v) => s + v, 0) / intervals.length : rows.length;
  const maxInterval = intervals.length > 0 ? Math.max(...intervals) : rows.length;

  // 完全外れ率
  const misses = rows.filter((r) => !r.hit);
  const completeMissRate = misses.length > 0
    ? misses.filter((r) => r.missType === "COMPLETE_MISS").length / misses.length
    : 0;

  return {
    maxStreakN: maxStreak,
    avgStreak,
    maxDDPct,
    maxDDYen100: maxDD,
    completeMissRate,
    avgHitInterval: avgInterval,
    maxHitInterval: maxInterval,
  };
}

// ───────────────── Classify ─────────────────

function classifySubgroup(
  stats: SubgroupStats["metric"],
  dd: SubgroupStats["dd"],
  cutImpact: CutImpact,
  n: number,
): SubgroupStats["classification"] {
  if (n < MIN_N_FOR_ANALYSIS) return "INSUFFICIENT";

  // CUT_CANDIDATE: この条件を除外するとROI維持 AND ストリーク/DD改善
  if (cutImpact.worthCutting) return "CUT_CANDIDATE";

  // KEEP_STRONG: ROIも運用性能も良い
  if (stats.roi >= 150 && dd.maxStreakN <= TARGET_MAX_STREAK && dd.maxDDPct <= TARGET_MAX_DD_PCT) {
    return "KEEP_STRONG";
  }

  // PAPER_ONLY: ROIは良いが運用コストが高い
  if (stats.roi >= 120 && (dd.maxStreakN > TARGET_MAX_STREAK || dd.maxDDPct > TARGET_MAX_DD_PCT * 1.5)) {
    return "PAPER_ONLY";
  }

  return "WATCH";
}

function buildCutImpact(baseline: Metric, baselineDd: DrawdownResult, remain: Metric, remainDd: DrawdownResult): CutImpact {
  const roiChange = remain.roi - baseline.roi;
  const streakChange = remainDd.maxStreakN - baselineDd.maxStreakN;
  const ddChange = remainDd.maxDDPct - baselineDd.maxDDPct;

  // 「切る価値あり」判定:
  // - ROI後が MIN_ROI_AFTER_CUT 以上
  // - ストリーク or DD が改善 (≤ 目標)
  const roiOk = remain.roi >= MIN_ROI_AFTER_CUT || (remain.n > 0 && roiChange >= -20); // 20pp以内の低下は許容
  const streakImproved = remainDd.maxStreakN <= TARGET_MAX_STREAK && streakChange < 0;
  const ddImproved = remainDd.maxDDPct <= TARGET_MAX_DD_PCT && ddChange < 0;

  return {
    roiChange,
    streakChange,
    ddPctChange: ddChange,
    roiAfterCut: remain.roi,
    streakAfterCut: remainDd.maxStreakN,
    ddAfterCut: remainDd.maxDDPct,
    worthCutting: roiOk && (streakImproved || ddImproved),
  };
}

// ───────────────── Build Subgroup ─────────────────

function buildSubgroup(
  label: string,
  condition: string,
  subRows: Row[],
  allRows: Row[],
  baselineMetric: Metric,
  baselineDd: DrawdownResult,
): SubgroupStats {
  const remainRows = allRows.filter((r) => !subRows.includes(r));
  const m = calcMetric(subRows);
  const dd = calcDrawdown(subRows);
  const rm = calcMetric(remainRows);
  const rdd = calcDrawdown(remainRows);
  const cutImpact = buildCutImpact(baselineMetric, baselineDd, rm, rdd);
  const cls = classifySubgroup(m, dd, cutImpact, subRows.length);

  const explanation = buildExplanation(label, m, dd, cutImpact, cls);
  const recommendation = buildRecommendation(cls, cutImpact, m, dd);

  return {
    label, condition,
    n: m.n, metric: m, dd,
    remainN: rm.n, remainMetric: rm, remainDd: rdd,
    classification: cls, cutImpact,
    explanation, recommendation,
  };
}

function buildExplanation(label: string, m: Metric, dd: DrawdownResult, ci: CutImpact, cls: string): string {
  if (cls === "CUT_CANDIDATE") {
    return `除外することでROI ${pct(ci.roiAfterCut / 100)}、連敗 ${ci.streakAfterCut}回、DD ${num(ci.ddAfterCut)}% に改善。ROI低下は ${pct(Math.abs(ci.roiChange) / 100)} 以内。`;
  }
  if (cls === "KEEP_STRONG") {
    return `ROI ${pct(m.roi / 100)} × 連敗 ${dd.maxStreakN}回 × DD ${num(dd.maxDDPct)}% — 目標範囲内の良好な条件。`;
  }
  if (cls === "PAPER_ONLY") {
    return `ROI ${pct(m.roi / 100)} は良好だが連敗 ${dd.maxStreakN}回 / DD ${num(dd.maxDDPct)}% が高い。除外するとROI低下が大きすぎる。`;
  }
  return `n=${m.n} / ROI=${pct(m.roi / 100)} / 連敗=${dd.maxStreakN} — 様子見。`;
}

function buildRecommendation(cls: string, ci: CutImpact, m: Metric, dd: DrawdownResult): string {
  if (cls === "CUT_CANDIDATE") {
    return `✂️ CUT推奨: 除外後ROI=${pct(ci.roiAfterCut / 100)} / 連敗=${ci.streakAfterCut} / DD=${num(ci.ddAfterCut)}%`;
  }
  if (cls === "KEEP_STRONG") return `✅ KEEP: 目標条件を満たす`;
  if (cls === "PAPER_ONLY") return `⚠️ PAPER_ONLY: ROI高いが運用リスク大、除外コスト大`;
  if (cls === "INSUFFICIENT") return `ℹ️ n<${MIN_N_FOR_ANALYSIS}: データ不足`;
  return `△ WATCH: ROI=${pct(m.roi / 100)} / 連敗=${dd.maxStreakN}`;
}

// ───────────────── Dimension Analysis ─────────────────

function analyzeDimension(
  name: string,
  groups: { label: string; condition: string; rows: Row[] }[],
  allRows: Row[],
  bm: Metric,
  bd: DrawdownResult,
): { name: string; subgroups: SubgroupStats[] } {
  const subgroups = groups
    .filter((g) => g.rows.length > 0)
    .map((g) => buildSubgroup(g.label, g.condition, g.rows, allRows, bm, bd));
  subgroups.sort((a, b) => a.metric.roi - b.metric.roi);
  return { name, subgroups };
}

// ───────────────── Main Analysis ─────────────────

function analyzeIsBaseRisk(rows: Row[]): RiskReport {
  const bm = calcMetric(rows);
  const bd = calcDrawdown(rows);

  const dims: { name: string; subgroups: SubgroupStats[] }[] = [];

  // 1. 月別
  const monthGroups = [4, 6, 8, 12].map((m) => ({
    label: `月${m}`, condition: `month=${m}`,
    rows: rows.filter((r) => r.month === m),
  }));
  dims.push(analyzeDimension("月別", monthGroups, rows, bm, bd));

  // 2. venue別 (n>=10のみ)
  const venueMap = new Map<string, Row[]>();
  for (const r of rows) { if (!venueMap.has(r.venue)) venueMap.set(r.venue, []); venueMap.get(r.venue)!.push(r); }
  const venueGroups = [...venueMap.entries()]
    .filter(([, rs]) => rs.length >= 10)
    .map(([venue, rs]) => ({ label: `会場: ${venue}`, condition: `venue='${venue}'`, rows: rs }));
  dims.push(analyzeDimension("会場別 (n>=10)", venueGroups, rows, bm, bd));

  // 3. raceNo別
  const raceNoGroups = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((no) => ({
    label: `R${no}`, condition: `race_no=${no}`,
    rows: rows.filter((r) => r.raceNo === no),
  }));
  dims.push(analyzeDimension("レースNo別", raceNoGroups, rows, bm, bd));

  // 4. odds帯別
  const oddsGroups = [
    { label: "odds<30", condition: "odds<30", rows: rows.filter((r) => r.currentOdds < 30) },
    { label: "30<=odds<50", condition: "30<=odds<50", rows: rows.filter((r) => r.currentOdds >= 30 && r.currentOdds < 50) },
    { label: "50<=odds<80", condition: "50<=odds<80", rows: rows.filter((r) => r.currentOdds >= 50 && r.currentOdds < 80) },
    { label: "odds>=80", condition: "odds>=80", rows: rows.filter((r) => r.currentOdds >= 80) },
  ];
  dims.push(analyzeDimension("オッズ帯別", oddsGroups, rows, bm, bd));

  // 5. wind帯別 (isBase内は wind>=3 確定)
  const windGroups = [
    { label: "wind 3-5", condition: "3<=wind<5", rows: rows.filter((r) => r.windMps >= 3 && r.windMps < 5) },
    { label: "wind 5-8", condition: "5<=wind<8", rows: rows.filter((r) => r.windMps >= 5 && r.windMps < 8) },
    { label: "wind>=8", condition: "wind>=8", rows: rows.filter((r) => r.windMps >= 8) },
  ];
  dims.push(analyzeDimension("wind帯別", windGroups, rows, bm, bd));

  // 6. wave帯別
  const waveGroups = [
    { label: "wave 0-5cm", condition: "0<=wave<5", rows: rows.filter((r) => (r.waveCm ?? 0) < 5) },
    { label: "wave 5-15cm", condition: "5<=wave<15", rows: rows.filter((r) => (r.waveCm ?? 0) >= 5 && (r.waveCm ?? 0) < 15) },
    { label: "wave>=15cm", condition: "wave>=15", rows: rows.filter((r) => (r.waveCm ?? 0) >= 15) },
  ];
  dims.push(analyzeDimension("wave帯別", waveGroups, rows, bm, bd));

  // 7. 展示ST帯別 (isBase内は [0.10,0.15) 除外済み)
  const exStGroups = [
    { label: "exSt<0 (フライング域)", condition: "exSt<0", rows: rows.filter((r) => r.headExSt != null && r.headExSt < 0) },
    { label: "exSt 0-0.05", condition: "0<=exSt<0.05", rows: rows.filter((r) => r.headExSt != null && r.headExSt >= 0 && r.headExSt < 0.05) },
    { label: "exSt 0.05-0.10", condition: "0.05<=exSt<0.10", rows: rows.filter((r) => r.headExSt != null && r.headExSt >= 0.05 && r.headExSt < 0.10) },
    { label: "exSt>=0.15 (遅め)", condition: "exSt>=0.15", rows: rows.filter((r) => r.headExSt != null && r.headExSt >= 0.15) },
    { label: "exSt欠損", condition: "exSt IS NULL", rows: rows.filter((r) => r.headExSt == null) },
  ];
  dims.push(analyzeDimension("展示ST帯別", exStGroups, rows, bm, bd));

  // 8. motor帯別
  const motorGroups = [
    { label: "motor<40 (低勝率)", condition: "motor_top2<40", rows: rows.filter((r) => r.motorTop2 != null && r.motorTop2 < 40) },
    { label: "motor 40-60", condition: "40<=motor<60", rows: rows.filter((r) => r.motorTop2 != null && r.motorTop2 >= 40 && r.motorTop2 < 60) },
    { label: "motor欠損", condition: "motor IS NULL", rows: rows.filter((r) => r.motorTop2 == null) },
  ];
  dims.push(analyzeDimension("motor帯別 (head)", motorGroups, rows, bm, bd));

  // 9. 完全外れ率が高い条件
  const highMissGroups = [
    { label: "raceNo 1-3 (前半)", condition: "race_no<=3", rows: rows.filter((r) => r.raceNo <= 3) },
    { label: "raceNo 7-9 (後半)", condition: "race_no>=7", rows: rows.filter((r) => r.raceNo >= 7) },
    { label: "wave>=10cm", condition: "wave>=10", rows: rows.filter((r) => (r.waveCm ?? 0) >= 10) },
    { label: "odds>=80 (isBase内高配当)", condition: "odds>=80", rows: rows.filter((r) => r.currentOdds >= 80) },
  ];
  dims.push(analyzeDimension("完全外れリスク高条件", highMissGroups, rows, bm, bd));

  // CUT候補を収集
  const allSubgroups = dims.flatMap((d) => d.subgroups);
  const cutCandidates = allSubgroups
    .filter((s) => s.classification === "CUT_CANDIDATE")
    .sort((a, b) => a.cutImpact.streakAfterCut - b.cutImpact.streakAfterCut);
  const keepStrong = allSubgroups
    .filter((s) => s.classification === "KEEP_STRONG")
    .sort((a, b) => b.metric.roi - a.metric.roi);

  // CUTシミュレーション
  const cutSims = runCutSimulations(rows, cutCandidates, bm, bd);

  return {
    generatedAt: new Date().toISOString(),
    dbPath: DB_PATH,
    isBaseN: rows.length,
    baselineMetric: bm,
    baselineDd: bd,
    targets: { maxStreak: TARGET_MAX_STREAK, maxDDPct: TARGET_MAX_DD_PCT, minROI: MIN_ROI_AFTER_CUT },
    dimensions: dims,
    cutCandidates,
    cutSimulations: cutSims,
    keepStrong,
  };
}

// ───────────────── Cut Simulations ─────────────────

function runCutSimulations(
  rows: Row[],
  cuts: SubgroupStats[],
  bm: Metric,
  bd: DrawdownResult,
): CutSimulation[] {
  const sims: CutSimulation[] = [];

  if (cuts.length === 0) {
    sims.push({
      label: "CUT候補なし",
      cutConditions: [],
      remainN: bm.n, remainMetric: bm, remainDd: bd,
      verdict: "現状のisBase条件内ではCUT候補が見つからなかった。別の切り口を検討。",
    });
    return sims;
  }

  // シム1: 単体CUT (最も効果的な条件)
  const topCut = cuts[0];
  {
    const remain = filterRowsByCutLabel(rows, [topCut]);
    const rm = calcMetric(remain);
    const rdd = calcDrawdown(remain);
    sims.push({
      label: `単体CUT: ${topCut.label}`,
      cutConditions: [topCut.condition],
      remainN: rm.n, remainMetric: rm, remainDd: rdd,
      verdict: buildSimVerdict(rm, rdd),
    });
  }

  // シム2: 上位2条件CUT
  if (cuts.length >= 2) {
    const top2 = cuts.slice(0, 2);
    const remain = filterRowsByCutLabel(rows, top2);
    const rm = calcMetric(remain);
    const rdd = calcDrawdown(remain);
    sims.push({
      label: `2条件CUT: ${top2.map((c) => c.label).join(" + ")}`,
      cutConditions: top2.map((c) => c.condition),
      remainN: rm.n, remainMetric: rm, remainDd: rdd,
      verdict: buildSimVerdict(rm, rdd),
    });
  }

  // シム3: 上位3条件CUT
  if (cuts.length >= 3) {
    const top3 = cuts.slice(0, 3);
    const remain = filterRowsByCutLabel(rows, top3);
    const rm = calcMetric(remain);
    const rdd = calcDrawdown(remain);
    sims.push({
      label: `3条件CUT: ${top3.map((c) => c.label).join(" + ")}`,
      cutConditions: top3.map((c) => c.condition),
      remainN: rm.n, remainMetric: rm, remainDd: rdd,
      verdict: buildSimVerdict(rm, rdd),
    });
  }

  // シム4: 全CUT候補適用
  if (cuts.length >= 4) {
    const remain = filterRowsByCutLabel(rows, cuts);
    const rm = calcMetric(remain);
    const rdd = calcDrawdown(remain);
    sims.push({
      label: `全CUT (${cuts.length}条件)`,
      cutConditions: cuts.map((c) => c.condition),
      remainN: rm.n, remainMetric: rm, remainDd: rdd,
      verdict: buildSimVerdict(rm, rdd),
    });
  }

  // シム5: カスタム - odds>=80 除外
  {
    const remain = rows.filter((r) => r.currentOdds < 80);
    const rm = calcMetric(remain);
    const rdd = calcDrawdown(remain);
    sims.push({
      label: "odds<80 のみ (高配当除外)",
      cutConditions: ["odds>=80 を除外"],
      remainN: rm.n, remainMetric: rm, remainDd: rdd,
      verdict: buildSimVerdict(rm, rdd),
    });
  }

  // シム6: raceNo 4-8 限定
  {
    const remain = rows.filter((r) => r.raceNo >= 4 && r.raceNo <= 8);
    const rm = calcMetric(remain);
    const rdd = calcDrawdown(remain);
    sims.push({
      label: "raceNo 4-8 限定",
      cutConditions: ["race_no BETWEEN 4 AND 8"],
      remainN: rm.n, remainMetric: rm, remainDd: rdd,
      verdict: buildSimVerdict(rm, rdd),
    });
  }

  return sims;
}

function filterRowsByCutLabel(rows: Row[], cuts: SubgroupStats[]): Row[] {
  // CUT候補行のIDセットを構築して除外
  const cutCondPreds = cuts.map((c) => buildCutPred(c));
  return rows.filter((r) => !cutCondPreds.some((pred) => pred(r)));
}

function buildCutPred(s: SubgroupStats): (r: Row) => boolean {
  const cond = s.condition;
  if (cond.startsWith("month=")) {
    const m = Number(cond.replace("month=", ""));
    return (r) => r.month === m;
  }
  if (cond.startsWith("venue=")) {
    const v = cond.replace("venue='", "").replace("'", "");
    return (r) => r.venue === v;
  }
  if (cond.startsWith("race_no=")) {
    const n = Number(cond.replace("race_no=", ""));
    return (r) => r.raceNo === n;
  }
  if (cond === "odds>=80") return (r) => r.currentOdds >= 80;
  if (cond === "odds<30") return (r) => r.currentOdds < 30;
  if (cond === "30<=odds<50") return (r) => r.currentOdds >= 30 && r.currentOdds < 50;
  if (cond === "50<=odds<80") return (r) => r.currentOdds >= 50 && r.currentOdds < 80;
  if (cond === "3<=wind<5") return (r) => r.windMps >= 3 && r.windMps < 5;
  if (cond === "5<=wind<8") return (r) => r.windMps >= 5 && r.windMps < 8;
  if (cond === "wind>=8") return (r) => r.windMps >= 8;
  if (cond === "0<=wave<5") return (r) => (r.waveCm ?? 0) < 5;
  if (cond === "5<=wave<15") return (r) => (r.waveCm ?? 0) >= 5 && (r.waveCm ?? 0) < 15;
  if (cond === "wave>=15") return (r) => (r.waveCm ?? 0) >= 15;
  if (cond === "exSt<0") return (r) => r.headExSt != null && r.headExSt < 0;
  if (cond === "0<=exSt<0.05") return (r) => r.headExSt != null && r.headExSt >= 0 && r.headExSt < 0.05;
  if (cond === "0.05<=exSt<0.10") return (r) => r.headExSt != null && r.headExSt >= 0.05 && r.headExSt < 0.10;
  if (cond === "exSt>=0.15") return (r) => r.headExSt != null && r.headExSt >= 0.15;
  if (cond === "exSt IS NULL") return (r) => r.headExSt == null;
  if (cond === "motor_top2<40") return (r) => r.motorTop2 != null && r.motorTop2 < 40;
  if (cond === "40<=motor<60") return (r) => r.motorTop2 != null && r.motorTop2 >= 40 && r.motorTop2 < 60;
  if (cond === "motor IS NULL") return (r) => r.motorTop2 == null;
  if (cond === "race_no<=3") return (r) => r.raceNo <= 3;
  if (cond === "race_no>=7") return (r) => r.raceNo >= 7;
  if (cond === "wave>=10") return (r) => (r.waveCm ?? 0) >= 10;
  return () => false;
}

function buildSimVerdict(rm: Metric, rdd: DrawdownResult): string {
  const roiOk = rm.roi >= MIN_ROI_AFTER_CUT;
  const streakOk = rdd.maxStreakN <= TARGET_MAX_STREAK;
  const ddOk = rdd.maxDDPct <= TARGET_MAX_DD_PCT;
  if (roiOk && streakOk) return `✅ 目標達成: ROI=${pct(rm.roi / 100)} / 連敗=${rdd.maxStreakN} / DD=${num(rdd.maxDDPct)}%`;
  if (roiOk && !streakOk) return `△ ROI達成・連敗未達: ROI=${pct(rm.roi / 100)} / 連敗=${rdd.maxStreakN}(目標≤${TARGET_MAX_STREAK})`;
  if (!roiOk && streakOk) return `△ 連敗達成・ROI未達: ROI=${pct(rm.roi / 100)}(目標≥${MIN_ROI_AFTER_CUT}%) / 連敗=${rdd.maxStreakN}`;
  return `❌ 両方未達: ROI=${pct(rm.roi / 100)} / 連敗=${rdd.maxStreakN}`;
}

// ───────────────── Render ─────────────────

function renderMd(r: RiskReport): string {
  const lines: string[] = [];
  lines.push("# isBase リスク削減分析", "");
  lines.push(`生成: ${r.generatedAt} / DB: ${r.dbPath}`, "");
  lines.push(`対象: isBase条件 (月4/6/8/12×parts=0×wind>=3×headF=0×exSt安全) n=${r.isBaseN}`, "");
  lines.push("");

  // 目標と現状
  lines.push("## 目標", "");
  lines.push(`| 指標 | 現状 | 目標 |`);
  lines.push(`|---|---:|---:|`);
  lines.push(`| ROI | ${pct(r.baselineMetric.roi / 100)} | ${r.targets.minROI}%以上維持 |`);
  lines.push(`| 最大連敗 | **${r.baselineDd.maxStreakN}回** | **≤${r.targets.maxStreak}回** |`);
  lines.push(`| 最大DD | ${num(r.baselineDd.maxDDPct)}% | ≤${r.targets.maxDDPct}% |`);
  lines.push(`| 完全外れ率 | ${pct(r.baselineDd.completeMissRate)} | できる限り低減 |`);
  lines.push(`| n | ${r.isBaseN} | ※減少は許容 |`);
  lines.push("");

  // CUT候補サマリー
  if (r.cutCandidates.length > 0) {
    lines.push("## ✂️ CUT候補 (除外で目標改善)", "");
    lines.push("| 条件 | subgroup n | subgroup ROI | 除外後n | 除外後ROI | 除外後連敗 | 除外後DD | 判定 |");
    lines.push("|---|---:|---:|---:|---:|---:|---:|---|");
    for (const c of r.cutCandidates.slice(0, 15)) {
      const icon = c.cutImpact.worthCutting ? "✂️" : "△";
      lines.push(`| ${icon} ${esc(c.label)} | ${c.n} | ${pct(c.metric.roi / 100)} | ${c.remainN} | ${pct(c.cutImpact.roiAfterCut / 100)} | ${c.cutImpact.streakAfterCut} | ${num(c.cutImpact.ddAfterCut)}% | ${c.recommendation} |`);
    }
    lines.push("");
  } else {
    lines.push("## CUT候補", "");
    lines.push("> 単独条件でのCUT候補が見つかりませんでした。複合条件や別の切り口を検討してください。", "");
    lines.push("");
  }

  // CUTシミュレーション
  lines.push("## 🔬 CUTシミュレーション", "");
  lines.push("| シミュレーション | n | ROI | roiExMaxHit | 最大連敗 | DD% | 判定 |");
  lines.push("|---|---:|---:|---:|---:|---:|---|");
  for (const s of r.cutSimulations) {
    lines.push(`| ${esc(s.label)} | ${s.remainN} | ${pct(s.remainMetric.roi / 100)} | ${pct(s.remainMetric.roiExMaxHit / 100)} | ${s.remainDd.maxStreakN} | ${num(s.remainDd.maxDDPct)}% | ${s.verdict} |`);
  }
  lines.push("");

  // KEEP_STRONG
  if (r.keepStrong.length > 0) {
    lines.push("## ✅ KEEP_STRONG (目標範囲内の条件)", "");
    lines.push("| 条件 | n | ROI | roiExMaxHit | 連敗 | DD% |");
    lines.push("|---|---:|---:|---:|---:|---:|");
    for (const s of r.keepStrong.slice(0, 10)) {
      lines.push(`| ${esc(s.label)} | ${s.n} | ${pct(s.metric.roi / 100)} | ${pct(s.metric.roiExMaxHit / 100)} | ${s.dd.maxStreakN} | ${num(s.dd.maxDDPct)}% |`);
    }
    lines.push("");
  }

  // 次元別詳細
  lines.push("## 次元別詳細分析", "");
  for (const dim of r.dimensions) {
    lines.push(`### ${dim.name}`, "");
    lines.push("| 条件 | n | ROI | roiExMaxHit | 最大連敗 | DD% | 完全外れ率 | 除外後連敗 | 除外後ROI | 分類 |");
    lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|:---:|");
    for (const s of dim.subgroups) {
      const icon = s.classification === "CUT_CANDIDATE" ? "✂️" : s.classification === "KEEP_STRONG" ? "✅" : s.classification === "PAPER_ONLY" ? "⚠️" : s.classification === "INSUFFICIENT" ? "ℹ️" : "△";
      lines.push(`| ${icon} ${esc(s.label)} | ${s.n} | ${pct(s.metric.roi / 100)} | ${pct(s.metric.roiExMaxHit / 100)} | ${s.dd.maxStreakN} | ${num(s.dd.maxDDPct)}% | ${pct(s.dd.completeMissRate)} | ${s.cutImpact.streakAfterCut} | ${pct(s.cutImpact.roiAfterCut / 100)} | ${icon} ${s.classification} |`);
    }
    lines.push("");
  }

  // 解説
  lines.push("## 各条件の解説", "");
  const notableGroups = r.dimensions.flatMap((d) =>
    d.subgroups.filter((s) => s.classification === "CUT_CANDIDATE" || s.classification === "KEEP_STRONG"),
  );
  for (const s of notableGroups.slice(0, 20)) {
    lines.push(`### ${s.label} — ${s.classification}`, "");
    lines.push(`${s.explanation}`, "");
    lines.push(`**推奨**: ${s.recommendation}`, "");
    lines.push("");
  }

  lines.push("---");
  lines.push(`*生成: ${r.generatedAt} / DB: ${r.dbPath}*`);
  return lines.join("\n");
}

// ───────────────── Helpers ─────────────────

function pct(v: number): string {
  if (!Number.isFinite(v)) return "-";
  return `${(v * 100).toFixed(2)}%`;
}

function num(v: number): string {
  if (!Number.isFinite(v)) return "-";
  return v.toFixed(2);
}

function esc(s: string): string {
  return s.replaceAll("|", "\\|");
}

// ───────────────── Main ─────────────────

console.log("[isbase-risk] loading isBase rows...");
const rows = loadIsBaseRows();
console.log(`[isbase-risk] loaded ${rows.length} rows`);

const report = analyzeIsBaseRisk(rows);

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, renderMd(report), "utf8");
writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), "utf8");

console.log(`[isbase-risk] done → ${OUT_MD} / ${OUT_JSON}`);
console.log(`  baseline: ROI=${num(report.baselineMetric.roi)}% / 連敗=${report.baselineDd.maxStreakN} / DD=${num(report.baselineDd.maxDDPct)}%`);
if (report.cutCandidates.length > 0) {
  console.log(`  CUT候補 ${report.cutCandidates.length}件:`);
  for (const c of report.cutCandidates.slice(0, 5)) {
    console.log(`    ✂️ ${c.label}: 除外後ROI=${num(c.cutImpact.roiAfterCut)}% / 連敗=${c.cutImpact.streakAfterCut} / DD=${num(c.cutImpact.ddAfterCut)}%`);
  }
} else {
  console.log("  CUT候補: なし (単独条件では目標改善に届かず)");
}
console.log("  シミュレーション:");
for (const s of report.cutSimulations) {
  console.log(`    ${s.label}: 連敗=${s.remainDd.maxStreakN} / ROI=${num(s.remainMetric.roi)}% — ${s.verdict.slice(0, 60)}`);
}
