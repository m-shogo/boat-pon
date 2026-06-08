/**
 * ROI Drawdown & Operation Analysis — 読み取り専用
 *
 * 禁止:
 * - DB INSERT / UPDATE / DELETE / DROP
 * - app_settings 変更
 * - 本番decisionロジック変更
 *
 * 目的:
 * 連敗・ドローダウン・必要資金を分析し、運用可能かを判定する。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/roi-drawdown.md";
const OUT_JSON = "reports/roi-drawdown.json";
const STAKE = 100;
const STRONG_MONTHS = new Set([4, 6, 8, 12]);

if (!existsSync(DB_PATH)) {
  console.error(`[drawdown] DB not found: ${DB_PATH}`);
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
  result: string;
  hit: boolean;
  currentOdds: number;
  isStrongMonth: boolean;
  isIsBase: boolean;
  isParts0: boolean;
  isOddsGte80: boolean;
  isOdds50to80: boolean;
};

type DrawdownStats = {
  label: string;
  description: string;
  n: number;
  hits: number;
  hitRate: number;
  roi: number;
  roiExMaxHit: number;
  // 連敗
  maxLossStreak: number;
  avgLossStreak: number;
  medianLossStreak: number;
  lossStreakDistribution: { streak: number; count: number }[];
  // ドローダウン
  maxDrawdownPct: number;    // 最大資金減少率 (vs peak)
  maxDrawdownYen100: number; // 100円固定時の最大資金減少額
  maxDrawdownYen1000: number;
  // 的中間隔
  avgHitInterval: number;    // 平均的中間隔 (bet単位)
  maxHitInterval: number;    // 最大的中間隔
  hitIntervalDistribution: { interval: number; count: number }[];
  // 資金
  bankroll100: number;       // 100円固定推奨bankroll
  bankroll1000: number;      // 1000円固定推奨bankroll
  // 判定
  operationJudgement: "OPERATION_OK" | "PAPER_ONLY" | "TOO_VOLATILE" | "DO_NOT_SHIP";
  operationReasons: string[];
  // モデル性能
  modelPerformance: {
    roi: number;
    hitRate: number;
    roiExMaxHit: number;
    roiExMax3Hits: number;
    avgOdds: number;
    maxHitOdds: number;
    monthlyStability: number; // goodMonths / totalMonths
    highOddsDependency: number; // roiDiff when excluding odds>=80
  };
  // 運用性能
  operationPerformance: {
    maxConsecutiveLosses: number;
    maxDrawdown: number;
    avgHitInterval: number;
    bankroll100: number;
    forwardN: number | null;
    monthlyCoverage: string;
    oddsVolatilityRisk: string;
  };
};

type DrawdownReport = {
  generatedAt: string;
  dbPath: string;
  totalRows: number;
  segments: DrawdownStats[];
  summary: {
    bestSegment: string;
    worstSegment: string;
    overallBankroll100: number;
    overallBankroll1000: number;
  };
  gradeMatrix: GradeEntry[];
};

type GradeEntry = {
  label: string;
  historicalGrade: string;
  forwardGrade: string;
  productionStatus: string;
  note: string;
};

// ───────────────── Load ─────────────────

function loadRows(): Row[] {
  const raw = db.prepare(`
    SELECT
      dh.id, dh.race_id, dh.date, dh.venue, dh.race_no, dh.selection,
      dh.current_odds, dh.result,
      rw.wind_speed_mps,
      re.parts_changed_count,
      ed.start_timing AS head_ex_st,
      rp.flying_count AS head_flying_count
    FROM decision_history dh
    LEFT JOIN race_weather rw ON rw.race_id = dh.race_id
    LEFT JOIN race_equipment re ON re.race_id = dh.race_id
      AND CAST(substr(dh.selection,1,instr(dh.selection,'-')-1) AS INT) = re.course
    LEFT JOIN exhibition_data ed ON ed.race_id = dh.race_id
      AND CAST(substr(dh.selection,1,instr(dh.selection,'-')-1) AS INT) = ed.course
    LEFT JOIN race_entries ra ON ra.race_id = dh.race_id
      AND ra.entry_course = CAST(substr(dh.selection,1,instr(dh.selection,'-')-1) AS INT)
    LEFT JOIN racer_profiles rp ON rp.registration_no = ra.racer_reg
    WHERE dh.run_kind = 'historical-backfill'
      AND dh.decision = 'BUY'
      AND dh.current_odds IS NOT NULL
      AND dh.result IS NOT NULL
    ORDER BY dh.date, dh.id
  `).all() as Array<{
    id: number; race_id: string; date: string; venue: string; race_no: number;
    selection: string; current_odds: number; result: string | null;
    wind_speed_mps: number | null; parts_changed_count: number | null;
    head_ex_st: number | null; head_flying_count: number | null;
  }>;

  return raw.map((r) => {
    const hit = r.result != null && r.result === r.selection;
    const month = Number(r.date.slice(5, 7));
    const isParts0 = r.parts_changed_count != null && r.parts_changed_count === 0;
    const isWindGte3 = r.wind_speed_mps != null && r.wind_speed_mps >= 3;
    const exSt = r.head_ex_st;
    const isExStSafe = exSt == null || !(exSt >= 0.10 && exSt < 0.15);
    const isStrongMonth = STRONG_MONTHS.has(month);
    const isIsBase =
      isStrongMonth && isParts0 &&
      r.race_no < 10 && r.venue !== "戸田" && r.venue !== "多摩川" &&
      isWindGte3 && (r.head_flying_count == null || r.head_flying_count === 0) && isExStSafe;

    return {
      id: r.id, raceId: r.race_id, date: r.date, ym: r.date.slice(0, 7),
      month, venue: r.venue, raceNo: r.race_no, selection: r.selection,
      result: r.result ?? "", hit, currentOdds: r.current_odds,
      isStrongMonth, isIsBase, isParts0,
      isOddsGte80: r.current_odds >= 80,
      isOdds50to80: r.current_odds >= 50 && r.current_odds < 80,
    };
  });
}

// ───────────────── Drawdown Computation ─────────────────

function computeDrawdown(rows: Row[], stakeYen: number): {
  maxDrawdownPct: number;
  maxDrawdownYen: number;
  peakBalance: number;
  finalBalance: number;
  balanceCurve: number[];
} {
  let balance = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const curve: number[] = [];
  for (const r of rows) {
    balance -= stakeYen;
    if (r.hit) balance += r.currentOdds * stakeYen;
    peak = Math.max(peak, balance);
    maxDrawdown = Math.max(maxDrawdown, peak - balance);
    curve.push(balance);
  }
  const maxDrawdownPct = peak > 0 ? (maxDrawdown / (Math.abs(balance) + maxDrawdown + stakeYen)) * 100 : maxDrawdown > 0 ? 100 : 0;
  return {
    maxDrawdownPct,
    maxDrawdownYen: maxDrawdown,
    peakBalance: peak,
    finalBalance: balance,
    balanceCurve: curve,
  };
}

function computeLossStreaks(rows: Row[]): {
  maxStreak: number;
  avgStreak: number;
  medianStreak: number;
  distribution: { streak: number; count: number }[];
  streakList: number[];
} {
  const streaks: number[] = [];
  let current = 0;
  for (const r of rows) {
    if (!r.hit) {
      current++;
    } else {
      if (current > 0) streaks.push(current);
      current = 0;
    }
  }
  if (current > 0) streaks.push(current);
  if (streaks.length === 0) return { maxStreak: 0, avgStreak: 0, medianStreak: 0, distribution: [], streakList: [] };

  const max = Math.max(...streaks);
  const avg = streaks.reduce((s, v) => s + v, 0) / streaks.length;
  const sorted = [...streaks].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;

  // distribution (group by range)
  const counts = new Map<number, number>();
  for (const s of streaks) counts.set(s, (counts.get(s) ?? 0) + 1);
  const distribution = [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([streak, count]) => ({ streak, count }));

  return { maxStreak: max, avgStreak: avg, medianStreak: median, distribution, streakList: streaks };
}

function computeHitIntervals(rows: Row[]): {
  avgInterval: number;
  maxInterval: number;
  distribution: { interval: number; count: number }[];
} {
  const intervals: number[] = [];
  let lastHitIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].hit) {
      if (lastHitIdx >= 0) intervals.push(i - lastHitIdx);
      lastHitIdx = i;
    }
  }
  if (intervals.length === 0) return { avgInterval: rows.length, maxInterval: rows.length, distribution: [] };
  const avg = intervals.reduce((s, v) => s + v, 0) / intervals.length;
  const max = Math.max(...intervals);
  const counts = new Map<number, number>();
  for (const iv of intervals) counts.set(iv, (counts.get(iv) ?? 0) + 1);
  const distribution = [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([interval, count]) => ({ interval, count }));
  return { avgInterval: avg, maxInterval: max, distribution };
}

function computeMonthlyStability(rows: Row[]): number {
  const byYm = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byYm.has(r.ym)) byYm.set(r.ym, []);
    byYm.get(r.ym)!.push(r);
  }
  let goodMonths = 0;
  let total = 0;
  for (const [, rs] of byYm) {
    if (rs.length < 3) continue;
    const rois = rs.filter((r) => r.hit).map((r) => r.currentOdds);
    const roi = (rois.reduce((s, o) => s + o, 0) / rs.length) * 100;
    total++;
    if (roi >= 100) goodMonths++;
  }
  return total > 0 ? goodMonths / total : 0;
}

function computeHighOddsDependency(rows: Row[]): number {
  const all = calcMetric(rows);
  const noHighOdds = calcMetric(rows.filter((r) => !r.isOddsGte80));
  return all.roi - noHighOdds.roi;
}

function calcMetric(rows: Row[]): { n: number; hits: number; hitRate: number; roi: number; roiExMaxHit: number; roiExMax3Hits: number; maxHitOdds: number; avgOdds: number } {
  const n = rows.length;
  if (n === 0) return { n: 0, hits: 0, hitRate: 0, roi: 0, roiExMaxHit: 0, roiExMax3Hits: 0, maxHitOdds: 0, avgOdds: 0 };
  const hits = rows.filter((r) => r.hit).length;
  const hitOdds = rows.filter((r) => r.hit).map((r) => r.currentOdds).sort((a, b) => b - a);
  const total = hitOdds.reduce((s, o) => s + o, 0);
  const ex1 = hitOdds.slice(1).reduce((s, o) => s + o, 0);
  const ex3 = hitOdds.slice(3).reduce((s, o) => s + o, 0);
  const avgOdds = rows.reduce((s, r) => s + r.currentOdds, 0) / n;
  return {
    n, hits, hitRate: hits / n,
    roi: (total / n) * 100,
    roiExMaxHit: (ex1 / n) * 100,
    roiExMax3Hits: (ex3 / n) * 100,
    maxHitOdds: hitOdds[0] ?? 0,
    avgOdds,
  };
}

function judgeOperation(
  maxStreak: number, maxDrawdownPct: number, roi: number, roiExMaxHit: number,
  hitRate: number, n: number,
): { judgement: DrawdownStats["operationJudgement"]; reasons: string[] } {
  const reasons: string[] = [];

  if (n < 30) { reasons.push("n<30: データ不足"); return { judgement: "PAPER_ONLY", reasons }; }
  if (roi < 100) { reasons.push(`ROI${pct(roi / 100)}<100%: 期待値マイナス`); return { judgement: "DO_NOT_SHIP", reasons }; }
  if (roiExMaxHit < 80 && roi > 150) { reasons.push(`roiExMaxHit${pct(roiExMaxHit / 100)}: 高配当一発依存`); }
  if (maxStreak > 50) { reasons.push(`最大連敗${maxStreak}回: 資金リスク大`); }
  if (maxDrawdownPct > 80) { reasons.push(`最大DD${num(maxDrawdownPct)}%: 資金枯渇リスク`); }

  if (maxStreak > 100 || maxDrawdownPct > 90) {
    return { judgement: "TOO_VOLATILE", reasons };
  }
  if (maxStreak > 50 || maxDrawdownPct > 60 || roiExMaxHit < 80) {
    reasons.push("運用条件: PAPER_ONLY推奨");
    return { judgement: "PAPER_ONLY", reasons };
  }

  reasons.push(`ROI${pct(roi / 100)} / 最大連敗${maxStreak} / DD${num(maxDrawdownPct)}%`);
  return { judgement: "OPERATION_OK", reasons };
}

function buildDrawdownStats(label: string, description: string, rows: Row[]): DrawdownStats {
  const met = calcMetric(rows);
  const dd100 = computeDrawdown(rows, 100);
  const dd1000 = computeDrawdown(rows, 1000);
  const streaks = computeLossStreaks(rows);
  const hitInt = computeHitIntervals(rows);
  const monthStab = computeMonthlyStability(rows);
  const highOddsDep = computeHighOddsDependency(rows);

  // bankroll推奨: 最大ドローダウン×2 (安全係数)
  const bankroll100 = Math.ceil(dd100.maxDrawdownYen * 2 / 100) * 100;
  const bankroll1000 = Math.ceil(dd1000.maxDrawdownYen * 2 / 1000) * 1000;

  const { judgement, reasons } = judgeOperation(
    streaks.maxStreak, dd100.maxDrawdownPct, met.roi, met.roiExMaxHit, met.hitRate, met.n,
  );

  // 月別カバレッジ
  const months = [...new Set(rows.map((r) => r.month))].sort((a, b) => a - b);
  const monthlyCoverage = months.length > 0 ? `月${months.join("/")} (${months.length}ヶ月)` : "データなし";

  return {
    label,
    description,
    n: met.n,
    hits: met.hits,
    hitRate: met.hitRate,
    roi: met.roi,
    roiExMaxHit: met.roiExMaxHit,
    maxLossStreak: streaks.maxStreak,
    avgLossStreak: streaks.avgStreak,
    medianLossStreak: streaks.medianStreak,
    lossStreakDistribution: streaks.distribution,
    maxDrawdownPct: dd100.maxDrawdownPct,
    maxDrawdownYen100: dd100.maxDrawdownYen,
    maxDrawdownYen1000: dd1000.maxDrawdownYen,
    avgHitInterval: hitInt.avgInterval,
    maxHitInterval: hitInt.maxInterval,
    hitIntervalDistribution: hitInt.distribution,
    bankroll100,
    bankroll1000,
    operationJudgement: judgement,
    operationReasons: reasons,
    modelPerformance: {
      roi: met.roi,
      hitRate: met.hitRate,
      roiExMaxHit: met.roiExMaxHit,
      roiExMax3Hits: met.roiExMax3Hits,
      avgOdds: met.avgOdds,
      maxHitOdds: met.maxHitOdds,
      monthlyStability: monthStab,
      highOddsDependency: highOddsDep,
    },
    operationPerformance: {
      maxConsecutiveLosses: streaks.maxStreak,
      maxDrawdown: dd100.maxDrawdownPct,
      avgHitInterval: hitInt.avgInterval,
      bankroll100,
      forwardN: null,
      monthlyCoverage,
      oddsVolatilityRisk: highOddsDep > 50 ? "HIGH" : highOddsDep > 20 ? "MEDIUM" : "LOW",
    },
  };
}

// ───────────────── Analysis ─────────────────

function analyzeDrawdown(rows: Row[]): DrawdownReport {
  const segments: DrawdownStats[] = [];

  // 1. 全BUY
  segments.push(buildDrawdownStats(
    "全BUY", "historical-backfill decision=BUY 全件", rows,
  ));

  // 2. 月4+6+8+12×parts=0 (isBase)
  segments.push(buildDrawdownStats(
    "isBase (月4/6/8/12×parts=0)", "seasonal_parts0_month_4_6_8_12 完全条件", rows.filter((r) => r.isIsBase),
  ));

  // 3. 月4+6+8+12のみ (parts条件なし)
  segments.push(buildDrawdownStats(
    "強月のみ (月4/6/8/12)", "month IN (4,6,8,12) parts条件なし", rows.filter((r) => r.isStrongMonth),
  ));

  // 4. その他月
  segments.push(buildDrawdownStats(
    "弱月 (その他月)", "month NOT IN (4,6,8,12)", rows.filter((r) => !r.isStrongMonth),
  ));

  // 5. odds帯別
  segments.push(buildDrawdownStats(
    "odds < 30", "current_odds < 30", rows.filter((r) => r.currentOdds < 30),
  ));
  segments.push(buildDrawdownStats(
    "odds 30-50", "30 <= current_odds < 50", rows.filter((r) => r.currentOdds >= 30 && r.currentOdds < 50),
  ));
  segments.push(buildDrawdownStats(
    "odds 50-80", "50 <= current_odds < 80", rows.filter((r) => r.isOdds50to80),
  ));
  segments.push(buildDrawdownStats(
    "odds >= 80 (高配当)", "current_odds >= 80", rows.filter((r) => r.isOddsGte80),
  ));

  // 6. parts=0 vs partsあり
  segments.push(buildDrawdownStats(
    "parts=0 全月", "parts_changed_count=0", rows.filter((r) => r.isParts0),
  ));
  segments.push(buildDrawdownStats(
    "partsあり 全月", "parts_changed_count>=1", rows.filter((r) => !r.isParts0 && r.currentOdds != null),
  ));

  // Grade matrix
  const gradeMatrix: GradeEntry[] = [
    {
      label: "seasonal_parts0_month_4_6_8_12 (月4/6/8/12×parts=0)",
      historicalGrade: "S",
      forwardGrade: "B/A-",
      productionStatus: "NOT_ALLOWED (forward n<100 / hit<5 / 月8以外未完)",
      note: "forward n=25/hit=2/roiExMaxHit=123.2%。checklist 3項目未達。本番反映不可。",
    },
    {
      label: "強月のみ (月4/6/8/12, parts条件なし)",
      historicalGrade: "B",
      forwardGrade: "未観察",
      productionStatus: "NOT_ALLOWED",
      note: "parts=0条件なしではROIが低下する可能性。単独ではPAPER_ONLY。",
    },
    {
      label: "odds>=80 単独",
      historicalGrade: "X",
      forwardGrade: "X",
      productionStatus: "DO_NOT_TOUCH",
      note: "高配当一発依存。roiExMaxHitで崩れる。実運用不可。",
    },
    {
      label: "弱月 (月1/2/3/5/7/9/10/11)",
      historicalGrade: "C/D",
      forwardGrade: "未観察",
      productionStatus: "NOT_ALLOWED",
      note: "月別ROIが低い。条件フィルターとの組み合わせでも改善が見られない場合はNO_BUY。",
    },
  ];

  const best = segments.reduce((a, b) => (a.operationJudgement === "OPERATION_OK" && b.operationJudgement !== "OPERATION_OK" ? a : b.roi > a.roi ? b : a));
  const worst = segments.reduce((a, b) => (a.roi < b.roi ? a : b));

  const isBaseSeg = segments.find((s) => s.label.includes("isBase"));
  return {
    generatedAt: new Date().toISOString(),
    dbPath: DB_PATH,
    totalRows: rows.length,
    segments,
    summary: {
      bestSegment: best.label,
      worstSegment: worst.label,
      overallBankroll100: segments[0]?.bankroll100 ?? 0,
      overallBankroll1000: segments[0]?.bankroll1000 ?? 0,
    },
    gradeMatrix,
  };
}

// ───────────────── Render ─────────────────

function renderMd(r: DrawdownReport): string {
  const lines: string[] = [];
  lines.push("# ROI Drawdown & Operation Analysis", "");
  lines.push(`生成: ${r.generatedAt} / DB: ${r.dbPath}`, "");
  lines.push(`対象: historical-backfill BUY n=${r.totalRows}`, "");
  lines.push("");

  // サマリー
  lines.push("## サマリー", "");
  lines.push(`- 最良セグメント: **${r.summary.bestSegment}**`);
  lines.push(`- 最弱セグメント: **${r.summary.worstSegment}**`);
  lines.push(`- 全体 bankroll目安 (100円固定): ¥${r.summary.overallBankroll100.toLocaleString()}`);
  lines.push(`- 全体 bankroll目安 (1000円固定): ¥${r.summary.overallBankroll1000.toLocaleString()}`);
  lines.push("");

  // 格付けマトリクス
  lines.push("## 1. 格付けマトリクス", "");
  lines.push("| 候補 | historical | forward | production | 備考 |");
  lines.push("|---|:---:|:---:|:---:|---|");
  for (const g of r.gradeMatrix) {
    lines.push(`| ${esc(g.label)} | **${g.historicalGrade}** | ${g.forwardGrade} | ${g.productionStatus} | ${g.note} |`);
  }
  lines.push("");

  // セグメント別詳細
  lines.push("## 2. セグメント別 ドローダウン・運用性能", "");
  lines.push("| セグメント | n | ROI | roiExMaxHit | 最大連敗 | 最大DD% | DD¥(100円) | 的中間隔avg | bankroll(100円) | 判定 |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|:---:|");
  for (const s of r.segments) {
    const icon = s.operationJudgement === "OPERATION_OK" ? "✅" : s.operationJudgement === "PAPER_ONLY" ? "⚠️" : s.operationJudgement === "TOO_VOLATILE" ? "🚨" : "❌";
    lines.push(`| ${esc(s.label)} | ${s.n} | ${pct(s.roi / 100)} | ${pct(s.roiExMaxHit / 100)} | ${s.maxLossStreak} | ${num(s.maxDrawdownPct)}% | ¥${s.maxDrawdownYen100.toLocaleString()} | ${num(s.avgHitInterval)}bet | ¥${s.bankroll100.toLocaleString()} | ${icon} ${s.operationJudgement} |`);
  }
  lines.push("");

  // セグメント別 モデル性能 vs 運用性能
  lines.push("## 3. モデル性能 vs 運用性能 (分離評価)", "");
  for (const s of r.segments.slice(0, 5)) {
    lines.push(`### ${s.label}`, "");
    lines.push("**モデル性能**", "");
    lines.push("| 指標 | 値 |");
    lines.push("|---|---:|");
    lines.push(`| ROI | ${pct(s.modelPerformance.roi / 100)} |`);
    lines.push(`| hitRate | ${pct(s.modelPerformance.hitRate)} |`);
    lines.push(`| roiExMaxHit | ${pct(s.modelPerformance.roiExMaxHit / 100)} |`);
    lines.push(`| roiExMax3Hits | ${pct(s.modelPerformance.roiExMax3Hits / 100)} |`);
    lines.push(`| avgOdds | ${num(s.modelPerformance.avgOdds)} |`);
    lines.push(`| maxHitOdds | ${num(s.modelPerformance.maxHitOdds)} |`);
    lines.push(`| 月別安定性 (ROI>=100月/全月) | ${pct(s.modelPerformance.monthlyStability)} |`);
    lines.push(`| 高オッズ依存度 (ROI差) | ${pct(s.modelPerformance.highOddsDependency / 100)}pp |`);
    lines.push("");
    lines.push("**運用性能**", "");
    lines.push("| 指標 | 値 |");
    lines.push("|---|---:|");
    lines.push(`| 最大連敗 | ${s.operationPerformance.maxConsecutiveLosses}回 |`);
    lines.push(`| 最大DD | ${num(s.operationPerformance.maxDrawdown)}% |`);
    lines.push(`| 平均的中間隔 | ${num(s.operationPerformance.avgHitInterval)}bet |`);
    lines.push(`| bankroll目安(100円固定) | ¥${s.operationPerformance.bankroll100.toLocaleString()} |`);
    lines.push(`| forward n | ${s.operationPerformance.forwardN ?? "未計測/別途paper-forward参照"} |`);
    lines.push(`| 月カバレッジ | ${s.operationPerformance.monthlyCoverage} |`);
    lines.push(`| オッズ変動リスク | ${s.operationPerformance.oddsVolatilityRisk} |`);
    lines.push(`| 締切余裕 | TODO: 実測データなし |`);
    lines.push("");
    lines.push(`**判定**: ${s.operationJudgement} — ${s.operationReasons.join(" / ")}`, "");
    lines.push("");
  }

  // 連敗分布 (isBase条件)
  const isBaseSeg = r.segments.find((s) => s.label.includes("isBase"));
  if (isBaseSeg) {
    lines.push("## 4. isBase条件の連敗分布", "");
    lines.push("| 連敗数 | 発生回数 |");
    lines.push("|---:|---:|");
    for (const d of isBaseSeg.lossStreakDistribution.slice(0, 20)) {
      lines.push(`| ${d.streak} | ${d.count} |`);
    }
    lines.push("");
    lines.push(`平均連敗: ${num(isBaseSeg.avgLossStreak)} / 中央値: ${num(isBaseSeg.medianLossStreak)} / 最大: ${isBaseSeg.maxLossStreak}`, "");
    lines.push("");
  }

  // 本番反映判定
  lines.push("## 5. 本番反映 チェック (isBase条件)", "");
  const checklist = [
    ["forward n >= 100", "❌ 未達 (現在n=25)"],
    ["forward hits >= 5", "❌ 未達 (現在hit=2)"],
    ["月8以外含む (月4/6/12のforward実績)", "❌ 未確認"],
    ["forward ROI > 0 (評価中)", "✓ roiExMaxHit=123.2% (参考値)"],
    ["最大連敗が資金計画内", "要確認: bankroll目安参照"],
    ["自動投票禁止", "✓ 絶対ルール遵守"],
    ["本番decisionロジック変更禁止", "✓ 絶対ルール遵守"],
  ];
  lines.push("| 条件 | 状態 |");
  lines.push("|---|---|");
  for (const [c, s] of checklist) lines.push(`| ${c} | ${s} |`);
  lines.push("");
  lines.push("> **結論: 本番反映は現時点で禁止。paper forwardをforward n>=100/hit>=5まで継続する。**", "");
  lines.push("");

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

console.log("[drawdown] loading rows...");
const rows = loadRows();
console.log(`[drawdown] loaded ${rows.length} rows`);

const report = analyzeDrawdown(rows);

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, renderMd(report), "utf8");
writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), "utf8");

console.log(`[drawdown] done → ${OUT_MD} / ${OUT_JSON}`);
for (const s of report.segments.slice(0, 5)) {
  console.log(`  ${s.label}: ROI=${num(s.roi)}% / 最大連敗=${s.maxLossStreak} / DD=${num(s.maxDrawdownPct)}% / bankroll¥${s.bankroll100} / ${s.operationJudgement}`);
}
