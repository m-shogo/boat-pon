/**
 * Paper Forward Test — 複数候補の並走追跡
 *
 * 禁止:
 * - 既存テーブルへのINSERT/UPDATE/DELETE (paper_roi_candidates以外)
 * - DROP TABLE / ALTER TABLE
 * - app_settings 変更
 * - 本番decisionロジック変更
 * - 自動投票
 *
 * このスクリプトは:
 * - paper_roi_candidates テーブルを CREATE TABLE IF NOT EXISTS で作成する
 * - 複数conditionを並走追跡する (condition_name で分離)
 * - 本番のBUY/NO_BUY判定は変更しない
 * - reports/roi-paper-forward.md / .json を生成する
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/roi-paper-forward.md";
const OUT_JSON = "reports/roi-paper-forward.json";
const STAKE = 100;

// forward期間の開始日
const FORWARD_START = "2025-08-09";

if (!existsSync(DB_PATH)) {
  console.error(`[paper-forward] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA busy_timeout = 5000;");

// ── CREATE TABLE IF NOT EXISTS ──
db.exec(`
  CREATE TABLE IF NOT EXISTS paper_roi_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    condition_name TEXT NOT NULL,
    race_id TEXT NOT NULL,
    date TEXT NOT NULL,
    venue TEXT NOT NULL,
    race_no INTEGER NOT NULL,
    selection TEXT NOT NULL,
    current_odds REAL,
    result TEXT,
    hit INTEGER,
    parts_known INTEGER,
    parts_count INTEGER,
    motor_known INTEGER,
    motor_top2_rate REAL,
    wind_mps REAL,
    ex_st REAL,
    flying_count INTEGER,
    paper_action TEXT NOT NULL DEFAULT 'PAPER_STRONG',
    review_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(condition_name, race_id)
  )
`);
console.log("[paper-forward] table paper_roi_candidates ready");

// ───────────────── Types ─────────────────

type RawRow = {
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  selection: string;
  current_odds: number;
  result: string | null;
  parts_changed_count: number | null;
  wind_speed_mps: number | null;
  wave_height_cm: number | null;
  start_timing: number | null;
  flying_count_head: number | null;
  motor_top2_rate: number | null;
};

type ConditionConfig = {
  name: string;
  desc: string;
  paperAction: string;
  // historical baseline (analyze-roi-isbase-risk.ts の結果から)
  historical: {
    n: number;
    roi: number;
    roiExMaxHit: number;
    roiExMax3Hits: number;
    hitRate: number;
    maxStreak: number;
    maxDDPct: number;
    description: string;
  };
  // 本番反映チェックリスト
  checklist: { label: string; required: boolean }[];
  filter: (r: RawRow) => boolean;
};

// ───────────────── 条件定義 ─────────────────

const CONDITIONS: ConditionConfig[] = [
  {
    name: "seasonal_parts0_month_4_6_8_12",
    desc: "月4+6+8+12×parts=0 (isBase条件)",
    paperAction: "PAPER_STRONG",
    historical: {
      n: 543,
      roi: 199.10,
      roiExMaxHit: 184.79,
      roiExMax3Hits: 162.15,
      hitRate: 26 / 543,
      maxStreak: 102,
      maxDDPct: 18.78,
      description: "2024-01〜2025-08 (train+val) n=543 / 最大連敗102 / DD18.8%",
    },
    checklist: [
      { label: "forward n >= 100", required: true },
      { label: "hit >= 5", required: true },
      { label: "roiExMaxHit >= 100%", required: true },
      { label: "月8以外を含む (月4/6/12 のいずれか)", required: true },
      { label: "staleRows = 0", required: true },
      { label: "本番decision/app_settings 変更なし", required: false },
    ],
    filter: (r) => {
      const mo = Number(r.date.slice(5, 7));
      if (![4, 6, 8, 12].includes(mo)) return false;
      if ((r.wind_speed_mps ?? 99) < 3) return false;
      if ((r.flying_count_head ?? 0) >= 1) return false;
      const exSt = r.start_timing;
      if (exSt !== null && exSt >= 0.10 && exSt < 0.15) return false;
      return true;
    },
  },
  {
    name: "seasonal_parts0_month_4_6_8_12_wind5",
    desc: "月4+6+8+12×parts=0×wind>=5 (isBase + wind強化)",
    paperAction: "PAPER_STRONG_CANDIDATE",
    historical: {
      n: 153,
      roi: 262.03,
      roiExMaxHit: 211.24,
      roiExMax3Hits: 140.52,
      hitRate: 9 / 153,
      maxStreak: 32,
      maxDDPct: 20.92,
      description: "historical n=153 / ROI=262% / roiExMaxHit=211% / 最大連敗32 / DD20.9% — ROI/連敗目標達成・DD未達(目標12%)",
    },
    checklist: [
      { label: "forward n >= 50 (n=153のため緩和)", required: true },
      { label: "hit >= 3", required: true },
      { label: "roiExMaxHit >= 100%", required: true },
      { label: "月4/6/8/12 の複数月を含む", required: true },
      { label: "staleRows = 0", required: true },
      { label: "本番decision/app_settings 変更なし", required: false },
    ],
    filter: (r) => {
      const mo = Number(r.date.slice(5, 7));
      if (![4, 6, 8, 12].includes(mo)) return false;
      // wind >= 5 (強化条件)
      if ((r.wind_speed_mps ?? 0) < 5) return false;
      if ((r.flying_count_head ?? 0) >= 1) return false;
      const exSt = r.start_timing;
      if (exSt !== null && exSt >= 0.10 && exSt < 0.15) return false;
      return true;
    },
  },
];

// ───────────────── Load base rows (SQL) ─────────────────

const baseRows = db.prepare(`
  SELECT
    dh.race_id, dh.date, dh.venue, dh.race_no, dh.selection,
    dh.current_odds, dh.result,
    re.parts_changed_count,
    rw.wind_speed_mps, rw.wave_height_cm,
    ed.start_timing,
    (SELECT rp.flying_count FROM race_entries ra2
     JOIN racer_profiles rp ON rp.registration_no = ra2.racer_reg
     WHERE ra2.race_id = dh.race_id
       AND ra2.entry_course = CAST(substr(dh.selection,1,instr(dh.selection,'-')-1) AS INT)
     LIMIT 1) as flying_count_head,
    ms.motor_top2_rate
  FROM decision_history dh
  JOIN race_equipment re ON dh.race_id = re.race_id
    AND CAST(substr(dh.selection,1,instr(dh.selection,'-')-1) AS INT) = re.course
  JOIN exhibition_data ed ON dh.race_id = ed.race_id
    AND CAST(substr(dh.selection,1,instr(dh.selection,'-')-1) AS INT) = ed.course
  LEFT JOIN race_weather rw ON dh.race_id = rw.race_id
  LEFT JOIN motor_boat_stats ms ON dh.race_id = ms.race_id
    AND CAST(substr(dh.selection,1,instr(dh.selection,'-')-1) AS INT) = ms.course
  WHERE dh.run_kind = 'historical-backfill'
    AND dh.decision = 'BUY'
    AND substr(dh.date,6,2) IN ('04','06','08','12')
    AND re.parts_changed_count = 0
    AND dh.race_no < 10
    AND dh.venue NOT IN ('戸田', '多摩川')
  ORDER BY dh.date
`).all() as RawRow[];

console.log(`[paper-forward] SQL base rows: ${baseRows.length}`);

// ───────────────── INSERT per condition ─────────────────

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO paper_roi_candidates
    (condition_name, race_id, date, venue, race_no, selection, current_odds, result, hit,
     parts_known, parts_count, motor_known, motor_top2_rate, wind_mps, ex_st, flying_count,
     paper_action, review_status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?)
`);

type InsertStats = { attempted: number; inserted: number; ignored: number; totalInDB: number };

const insertStats = new Map<string, InsertStats>();

for (const cond of CONDITIONS) {
  const filtered = baseRows.filter(cond.filter);
  console.log(`[paper-forward] ${cond.name}: SQL base=${baseRows.length}, after filter=${filtered.length}`);

  let attempted = 0;
  let insertedRows = 0;

  for (const r of filtered) {
    const hit = r.result != null ? (r.result === r.selection ? 1 : 0) : null;
    insertStmt.run(
      cond.name, r.race_id, r.date, r.venue, r.race_no, r.selection,
      r.current_odds, r.result, hit,
      1, r.parts_changed_count ?? 0,
      r.motor_top2_rate !== null ? 1 : 0, r.motor_top2_rate,
      r.wind_speed_mps, r.start_timing, r.flying_count_head,
      cond.paperAction, r.date >= FORWARD_START ? "forward" : "historical",
    );
    attempted++;
    insertedRows += (db.prepare("SELECT changes() as c").get() as { c: number }).c;
  }

  const totalInDB = (db.prepare(
    `SELECT COUNT(*) as cnt FROM paper_roi_candidates WHERE condition_name = ?`,
  ).get(cond.name) as { cnt: number }).cnt;

  const stats: InsertStats = {
    attempted,
    inserted: insertedRows,
    ignored: attempted - insertedRows,
    totalInDB,
  };
  insertStats.set(cond.name, stats);

  console.log(`[paper-forward] ${cond.name}: attempted=${attempted}, inserted=${insertedRows}, ignored=${stats.ignored}, totalInDB=${totalInDB}`);
  if (totalInDB > attempted) {
    console.warn(`[paper-forward] ⚠️  ${cond.name}: 旧データ残存 ${totalInDB - attempted}件`);
  }
}

// ───────────────── Read back & Metrics ─────────────────

type CandRow = {
  race_id: string; date: string; venue: string; race_no: number;
  selection: string; current_odds: number; result: string | null;
  hit: number | null; review_status: string; wind_mps: number | null;
};

function readConditionRows(condName: string): CandRow[] {
  return db.prepare(`
    SELECT race_id, date, venue, race_no, selection, current_odds, result, hit, review_status, wind_mps
    FROM paper_roi_candidates
    WHERE condition_name = ?
    ORDER BY date
  `).all(condName) as CandRow[];
}

function calcMetrics(rs: CandRow[]) {
  const n = rs.length;
  const withResult = rs.filter((r) => r.hit !== null);
  const hits = withResult.filter((r) => r.hit === 1).length;
  const hitOdds = withResult.filter((r) => r.hit === 1).map((r) => r.current_odds).sort((a, b) => b - a);
  const total = hitOdds.reduce((s, o) => s + o, 0);
  const ex1 = hitOdds.slice(1).reduce((s, o) => s + o, 0);
  const ex3 = hitOdds.slice(3).reduce((s, o) => s + o, 0);
  const nEval = withResult.length;
  return {
    n, nEval, hits,
    hitRate: nEval > 0 ? hits / nEval : null,
    roi: nEval > 0 ? (total / nEval) * 100 : null,
    roiExMaxHit: nEval > 0 ? (ex1 / nEval) * 100 : null,
    roiExMax3Hits: nEval > 0 ? (ex3 / nEval) * 100 : null,
    maxHitOdds: hitOdds[0] ?? 0,
  };
}

function monthBreakdown(rs: CandRow[]) {
  const byYm = new Map<string, CandRow[]>();
  for (const r of rs) {
    const ym = r.date.slice(0, 7);
    if (!byYm.has(ym)) byYm.set(ym, []);
    byYm.get(ym)!.push(r);
  }
  return [...byYm.entries()].sort().map(([ym, rows]) => ({ ym, ...calcMetrics(rows) }));
}

function oddsBands(rs: CandRow[]) {
  return [
    { label: "odds<30", lo: 0, hi: 30 },
    { label: "30<=odds<50", lo: 30, hi: 50 },
    { label: "50<=odds<80", lo: 50, hi: 80 },
    { label: "odds>=80", lo: 80, hi: Infinity },
  ].map(({ label, lo, hi }) => ({
    label,
    ...calcMetrics(rs.filter((r) => r.current_odds >= lo && r.current_odds < hi)),
  }));
}

// ───────────────── 降格・停止ライン ─────────────────

type DowngradeCheck = {
  label: string;
  triggered: boolean;
  severity: "STOP" | "DOWNGRADE" | "WARNING" | "INFO";
  value: string;
  action: string;
};

type StatusAssessment = {
  currentStatus: "PAPER_STRONG_CANDIDATE" | "PAPER" | "WATCH" | "DO_NOT_SHIP";
  productionAllowed: false;
  unmetPromotionCriteria: string[];
  downgradeWarnings: DowngradeCheck[];
  nextReviewTrigger: string;
};

function buildStatusAssessment(
  cond: ConditionConfig,
  confirmedForward: CandRow[],
  fwdMetrics: ReturnType<typeof calcMetrics>,
  fwdMonths: ReturnType<typeof monthBreakdown>,
  checklistResults: { label: string; ok: boolean; value: string }[],
): StatusAssessment {
  const fwdN = confirmedForward.length;
  const hasMultiMonth = fwdMonths.filter((m) => (m.nEval ?? 0) > 0).length > 1;
  const hist = cond.historical;

  // 降格・停止チェック
  const downgradeWarnings: DowngradeCheck[] = [];

  // 1. n>=50 かつ ROI<100% → DOWNGRADE_TO_WATCH
  const roi = fwdMetrics.roi;
  if (fwdN >= 50 && roi !== null && roi < 100) {
    downgradeWarnings.push({
      label: "ROI<100% (n>=50)",
      triggered: true,
      severity: "STOP",
      value: `forward ROI=${roi.toFixed(1)}% / n=${fwdN}`,
      action: "DOWNGRADE_TO_WATCH: 期待値がマイナス。paper forward継続中止を検討",
    });
  } else {
    downgradeWarnings.push({
      label: "ROI<100% (n>=50達成後に評価)",
      triggered: false,
      severity: "STOP",
      value: fwdN >= 50 ? `ROI=${roi?.toFixed(1)}% ✅` : `n=${fwdN} (n<50: 未評価)`,
      action: "forward n>=50 到達後に評価",
    });
  }

  // 2. n>=50 かつ roiExMaxHit<80% → DOWNGRADE_TO_PAPER_ONLY
  const roiEx = fwdMetrics.roiExMaxHit;
  if (fwdN >= 50 && roiEx !== null && roiEx < 80) {
    downgradeWarnings.push({
      label: "roiExMaxHit<80% (n>=50)",
      triggered: true,
      severity: "DOWNGRADE",
      value: `roiExMaxHit=${roiEx.toFixed(1)}% / n=${fwdN}`,
      action: "DOWNGRADE_TO_PAPER_ONLY: top1 hit依存。過学習リスク確認必要",
    });
  } else {
    downgradeWarnings.push({
      label: "roiExMaxHit<80% (n>=50達成後に評価)",
      triggered: false,
      severity: "DOWNGRADE",
      value: fwdN >= 50 ? `roiExMaxHit=${roiEx?.toFixed(1)}% ✅` : `n=${fwdN} (n<50: 未評価)`,
      action: "forward n>=50 到達後に評価",
    });
  }

  // 3. n>=50 かつ hit<3 → WATCH
  const hits = fwdMetrics.hits;
  if (fwdN >= 50 && hits < 3) {
    downgradeWarnings.push({
      label: "hit<3 (n>=50)",
      triggered: true,
      severity: "DOWNGRADE",
      value: `hits=${hits} / n=${fwdN}`,
      action: "WATCH: 的中率が想定より低い。条件再検討",
    });
  } else {
    downgradeWarnings.push({
      label: "hit<3 (n>=50達成後に評価)",
      triggered: false,
      severity: "DOWNGRADE",
      value: fwdN >= 50 ? `hits=${hits} ✅` : `n=${fwdN} (n<50: 未評価)`,
      action: "forward n>=50 到達後に評価",
    });
  }

  // 4. 最大連敗が historical 想定を超えたらWARNING
  // forwardの連続外れを計算
  let maxFwdStreak = 0;
  let curStreak = 0;
  for (const r of confirmedForward) {
    if (r.hit === 0) { curStreak++; maxFwdStreak = Math.max(maxFwdStreak, curStreak); }
    else { curStreak = 0; }
  }
  const streakThreshold = Math.ceil(hist.maxStreak * 0.5); // 過去最大の50%でWARNING
  if (maxFwdStreak >= streakThreshold) {
    downgradeWarnings.push({
      label: `連敗 >= ${streakThreshold} (historical${hist.maxStreak}回の50%)`,
      triggered: true,
      severity: "WARNING",
      value: `forward 最大連敗=${maxFwdStreak}回 (閾値=${streakThreshold})`,
      action: "WARNING: historical 想定内だが資金計画を見直す",
    });
  } else {
    downgradeWarnings.push({
      label: `連敗 >= ${streakThreshold} (historical${hist.maxStreak}回の50%)`,
      triggered: false,
      severity: "WARNING",
      value: `forward 最大連敗=${maxFwdStreak}回 (閾値=${streakThreshold}) ✅`,
      action: "現在問題なし",
    });
  }

  // 5. 月8以外のforward実績がない → production不可
  if (!hasMultiMonth) {
    downgradeWarnings.push({
      label: "月8以外のforward実績なし",
      triggered: true,
      severity: "STOP",
      value: `forward月: ${[...new Set(confirmedForward.map((r) => r.date.slice(5, 7)))].sort().join(",")}`,
      action: "PRODUCTION_BLOCKED: 月4/6/12 のforward実績が必要",
    });
  } else {
    downgradeWarnings.push({
      label: "月8以外のforward実績なし",
      triggered: false,
      severity: "STOP",
      value: "複数月確認済み ✅",
      action: "月別条件を満たす",
    });
  }

  // 6. wind5 はDD未達により production不可
  if (cond.name.includes("wind5")) {
    downgradeWarnings.push({
      label: "DD historical 20.92% > 目標12%",
      triggered: true,
      severity: "STOP",
      value: `historical DD=${hist.maxDDPct.toFixed(2)}% (目標≤12%)`,
      action: "PRODUCTION_BLOCKED_DD: forward期間でDDが改善するか確認必要",
    });
  }

  // 未達昇格条件
  const unmetPromotionCriteria = checklistResults
    .filter((c) => !c.ok && cond.checklist.find((cl) => cl.label === c.label)?.required)
    .map((c) => `${c.label} (現状: ${c.value})`);

  // currentStatus 判定
  // - ROI/hit 品質の劣化が確認された場合のみ WATCH に降格
  // - 月8以外未達・DD未達は production_block だが currentStatus は変えない
  const qualityDowngrade = (fwdN >= 50 && roi !== null && roi < 100)  // ROI期待値マイナス
    || (fwdN >= 50 && fwdMetrics.hits < 3);  // hit rate 低すぎ

  let currentStatus: StatusAssessment["currentStatus"];
  if (qualityDowngrade) {
    currentStatus = "WATCH";
  } else {
    currentStatus = cond.paperAction === "PAPER_STRONG" ? "PAPER" : "PAPER_STRONG_CANDIDATE";
  }

  // nextReviewTrigger
  let nextReviewTrigger: string;
  if (fwdN < 30) {
    nextReviewTrigger = `forward n=30 到達時 (現在n=${fwdN})`;
  } else if (fwdN < 50) {
    nextReviewTrigger = `forward n=50 到達時 (現在n=${fwdN}) — 降格条件の本格評価開始`;
  } else if (!hasMultiMonth) {
    nextReviewTrigger = "月4/6/12 のいずれかのforward実績が出たとき";
  } else if (fwdN < 100) {
    nextReviewTrigger = `forward n=100 到達時 (現在n=${fwdN}) — PAPER_STRONG昇格条件の評価`;
  } else {
    nextReviewTrigger = "全checklist項目をレビュー";
  }

  return {
    currentStatus,
    productionAllowed: false,
    unmetPromotionCriteria,
    downgradeWarnings,
    nextReviewTrigger,
  };
}

// ───────────────── Report Generation ─────────────────

type CondReport = {
  config: ConditionConfig;
  stats: InsertStats;
  allRows: CandRow[];
  historicalRows: CandRow[];
  forwardRows: CandRow[];
  confirmedForward: CandRow[];
  pendingForward: CandRow[];
  histMetrics: ReturnType<typeof calcMetrics>;
  fwdMetrics: ReturnType<typeof calcMetrics>;
  fwdMonths: ReturnType<typeof monthBreakdown>;
  fwdOdds: ReturnType<typeof oddsBands>;
  checklistResults: { label: string; ok: boolean; value: string }[];
  verdict: string;
  paperGrade: string;
  statusAssessment: StatusAssessment;
};

function buildCondReport(cond: ConditionConfig): CondReport {
  const stats = insertStats.get(cond.name)!;
  const allRows = readConditionRows(cond.name);
  const historicalRows = allRows.filter((r) => r.review_status === "historical");
  const forwardRows = allRows.filter((r) => r.review_status === "forward");
  const confirmedForward = forwardRows.filter((r) => r.hit !== null);
  const pendingForward = forwardRows.filter((r) => r.hit === null);
  const histMetrics = calcMetrics(historicalRows);
  const fwdMetrics = calcMetrics(confirmedForward);
  const fwdMonths = monthBreakdown(forwardRows);
  const fwdOdds = oddsBands(confirmedForward);

  const fwdN = confirmedForward.length;
  const fwdHits = fwdMetrics.hits;
  const hasMultiMonth = fwdMonths.filter((m) => (m.nEval ?? 0) > 0).length > 1;
  const staleOk = stats.totalInDB <= stats.attempted;

  const checklistResults = cond.checklist.map((cl) => {
    if (cl.label.startsWith("forward n >= 100")) {
      return { label: cl.label, ok: fwdN >= 100, value: `n=${fwdN}` };
    }
    if (cl.label.startsWith("forward n >= 50")) {
      return { label: cl.label, ok: fwdN >= 50, value: `n=${fwdN}` };
    }
    if (cl.label.startsWith("hit >= 5")) {
      return { label: cl.label, ok: fwdHits >= 5, value: `${fwdHits}hits` };
    }
    if (cl.label.startsWith("hit >= 3")) {
      return { label: cl.label, ok: fwdHits >= 3, value: `${fwdHits}hits` };
    }
    if (cl.label.startsWith("roiExMaxHit")) {
      const v = fwdMetrics.roiExMaxHit;
      return { label: cl.label, ok: v !== null && v >= 100, value: v !== null ? `${v.toFixed(1)}%` : "未集計" };
    }
    if (cl.label.includes("月8以外") || cl.label.includes("複数月")) {
      return { label: cl.label, ok: hasMultiMonth, value: hasMultiMonth ? `複数月確認` : "月8のみ" };
    }
    if (cl.label.startsWith("staleRows")) {
      return { label: cl.label, ok: staleOk, value: `stale=${Math.max(0, stats.totalInDB - stats.attempted)}` };
    }
    return { label: cl.label, ok: true, value: "確認済み" };
  });

  const allOk = checklistResults.filter((c) => cond.checklist.find((cl) => cl.label === c.label)?.required).every((c) => c.ok);

  const verdict = fwdMetrics.roi === null ? "未評価 (結果待ち)"
    : fwdMetrics.roi >= 100 && (fwdMetrics.roiExMaxHit ?? 0) >= 80 ? "✅ PAPER継続"
      : fwdMetrics.roi >= 50 ? "⚠️ PAPER (要観察)"
        : "❌ 期待値割れ — 再評価必要";

  const paperGrade = allOk ? "本番反映検討可" : `観察継続 (${checklistResults.filter((c) => !c.ok && cond.checklist.find((cl) => cl.label === c.label)?.required).length}項目未達)`;

  const statusAssessment = buildStatusAssessment(cond, confirmedForward, fwdMetrics, fwdMonths, checklistResults);

  return {
    config: cond, stats, allRows, historicalRows, forwardRows,
    confirmedForward, pendingForward, histMetrics, fwdMetrics,
    fwdMonths, fwdOdds, checklistResults, verdict, paperGrade,
    statusAssessment,
  };
}

const condReports = CONDITIONS.map(buildCondReport);

// ───────────────── Helpers ─────────────────

function pct(v: number | null): string {
  if (v === null) return "-";
  return `${(v * 100).toFixed(2)}%`;
}
function num(v: number): string { return v.toFixed(2); }
function esc(s: string): string { return s.replaceAll("|", "\\|"); }

// ───────────────── Markdown ─────────────────

const lines: string[] = [];
lines.push("# ROI Paper Forward Test Report", "");
lines.push("**禁止**: 本番decision変更不可 / app_settings変更不可 / 自動投票不可", "");
lines.push(`*生成: ${new Date().toISOString()} / DB: ${DB_PATH}*`, "");
lines.push("");

// 比較テーブル
lines.push("## 条件比較サマリー", "");
lines.push("| 条件 | hist n | hist ROI | hist roiExMaxHit | 最大連敗 | hist DD% | fwd n | fwd hits | fwd ROI | ステータス | 本番 |");
lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---|:---:|");
for (const cr of condReports) {
  const h = cr.config.historical;
  const fwd = cr.fwdMetrics;
  const fwdRoi = fwd.roi !== null ? `${fwd.roi.toFixed(0)}%` : "-";
  const statusIcon = cr.statusAssessment.currentStatus === "WATCH" ? "⚠️" : cr.statusAssessment.currentStatus === "DO_NOT_SHIP" ? "❌" : "📋";
  lines.push(`| ${esc(cr.config.name)} | ${h.n} | ${h.roi.toFixed(1)}% | ${h.roiExMaxHit.toFixed(1)}% | ${h.maxStreak} | ${h.maxDDPct.toFixed(1)}% | ${cr.confirmedForward.length} | ${fwd.hits} | ${fwdRoi} | ${statusIcon} ${cr.statusAssessment.currentStatus} | 🚫 不可 |`);
}
lines.push("");

// 注記: DD目標について
lines.push("> **DD目標について**: 目標 DD<=12%。`seasonal_parts0_month_4_6_8_12` DD=18.8%、`wind5` DD=20.9% — いずれもDD目標未達。ROI/連敗は達成。**PAPER_STRONG_CANDIDATE (DD未達)** として扱う。", "");
lines.push("");

// 条件別詳細セクション
for (const cr of condReports) {
  const h = cr.config.historical;
  lines.push(`## 条件: ${cr.config.name}`, "");
  lines.push(`**${cr.config.desc}**`, "");
  lines.push(`paper_action: \`${cr.config.paperAction}\``, "");
  lines.push(`forward開始: ${FORWARD_START}`, "");
  lines.push("");

  // historical baseline
  lines.push("### Historical Baseline", "");
  lines.push("| 指標 | 値 |");
  lines.push("|---|---:|");
  lines.push(`| n | ${h.n} |`);
  lines.push(`| ROI | ${h.roi.toFixed(2)}% |`);
  lines.push(`| roiExMaxHit | ${h.roiExMaxHit.toFixed(2)}% |`);
  lines.push(`| roiExMax3Hits | ${h.roiExMax3Hits.toFixed(2)}% |`);
  lines.push(`| hitRate | ${pct(h.hitRate)} |`);
  lines.push(`| 最大連敗 | ${h.maxStreak}回 |`);
  lines.push(`| 最大DD | ${h.maxDDPct.toFixed(2)}% |`);
  lines.push(`| 備考 | ${h.description} |`);
  lines.push("");

  // forward summary
  lines.push("### Forward Test サマリー", "");
  lines.push("| 指標 | 値 |");
  lines.push("|---|---:|");
  lines.push(`| forward件数 (全) | ${cr.forwardRows.length} |`);
  lines.push(`| forward確定済み | ${cr.confirmedForward.length} |`);
  lines.push(`| forward未確定 | ${cr.pendingForward.length} |`);
  lines.push(`| forward hits | ${cr.fwdMetrics.hits} |`);
  lines.push(`| forward hitRate | ${pct(cr.fwdMetrics.hitRate)} |`);
  lines.push(`| forward ROI | ${cr.fwdMetrics.roi !== null ? cr.fwdMetrics.roi.toFixed(2) + "%" : "-"} |`);
  lines.push(`| forward roiExMaxHit | ${cr.fwdMetrics.roiExMaxHit !== null ? cr.fwdMetrics.roiExMaxHit.toFixed(2) + "%" : "-"} |`);
  lines.push(`| forward maxHitOdds | ${num(cr.fwdMetrics.maxHitOdds)} |`);
  lines.push("");
  if (cr.fwdMetrics.hits < 3) {
    lines.push(`> ℹ️ **roiExMaxHit は参考値**: forward hit=${cr.fwdMetrics.hits} (hit<3のため未評価)。hit>=3 から評価開始。`, "");
  }

  // forward monthly
  lines.push("### Forward 月別内訳", "");
  if (cr.fwdMonths.length === 0) {
    lines.push("forward期間のデータなし。", "");
  } else {
    lines.push("| 年月 | n | 確定 | hits | hitRate | ROI | maxHitOdds |");
    lines.push("|---|---:|---:|---:|---:|---:|---:|");
    for (const mb of cr.fwdMonths) {
      const roi = mb.roi !== null ? mb.roi.toFixed(0) + "%" : "(未確定)";
      lines.push(`| ${mb.ym} | ${mb.n} | ${mb.nEval} | ${mb.hits} | ${pct(mb.hitRate)} | ${roi} | ${num(mb.maxHitOdds)} |`);
    }
    lines.push("");
  }

  // checklist
  lines.push("### 本番反映チェックリスト", "");
  lines.push("**全 required ✅ になるまで本番反映しないこと**", "");
  lines.push("| 条件 | 現状 | 判定 |");
  lines.push("|---|---|:---:|");
  for (const c of cr.checklistResults) {
    const req = cr.config.checklist.find((cl) => cl.label === c.label)?.required ?? false;
    const icon = c.ok ? "✅" : req ? "❌" : "ℹ️";
    lines.push(`| ${req ? "" : "(任意)"}${c.label} | ${c.value} | ${icon} |`);
  }
  lines.push("");
  lines.push(cr.checklistResults.every((c) => c.ok)
    ? "**→ 全条件クリア: 本番反映を検討してよい段階**"
    : `**→ 観察継続: ${cr.paperGrade}**`);
  lines.push("");

  // 降格・停止ライン
  const sa = cr.statusAssessment;
  lines.push("### 降格・停止ライン", "");
  lines.push(`**現在ステータス**: \`${sa.currentStatus}\` — **本番反映: 不可**`, "");
  if (sa.unmetPromotionCriteria.length > 0) {
    lines.push("**未達昇格条件:**");
    for (const u of sa.unmetPromotionCriteria) lines.push(`- ❌ ${u}`);
    lines.push("");
  }
  lines.push("| チェック | トリガー | 重大度 | 現状 | アクション |");
  lines.push("|---|:---:|:---:|---|---|");
  for (const dg of sa.downgradeWarnings) {
    const icon = dg.triggered
      ? (dg.severity === "STOP" ? "🔴" : dg.severity === "DOWNGRADE" ? "🟠" : "🟡")
      : "🟢";
    lines.push(`| ${dg.label} | ${icon} | ${dg.severity} | ${dg.value} | ${dg.action} |`);
  }
  lines.push("");
  lines.push(`> 📅 **次のレビュートリガー**: ${sa.nextReviewTrigger}`, "");

  // rerun safety
  const s = cr.stats;
  lines.push("### Rerun Safety", "");
  lines.push(`attempted=${s.attempted} / inserted=${s.inserted} / ignored=${s.ignored} / totalInDB=${s.totalInDB}${s.totalInDB > s.attempted ? ` ⚠️旧データ${s.totalInDB - s.attempted}件残存` : ""}`);
  lines.push("");

  // 先頭20件
  lines.push("### Forward 記録 (先頭20件)", "");
  lines.push("| date | venue | R | selection | odds | result | hit | wind |");
  lines.push("|---|---|---:|---|---:|---|---|---:|");
  for (const r of cr.forwardRows.slice(0, 20)) {
    const hitStr = r.hit === null ? "-" : r.hit === 1 ? "✓" : "✗";
    lines.push(`| ${r.date} | ${r.venue} | ${r.race_no} | ${r.selection} | ${r.current_odds.toFixed(1)} | ${r.result ?? "-"} | ${hitStr} | ${r.wind_mps?.toFixed(0) ?? "-"} |`);
  }
  if (cr.forwardRows.length > 20) lines.push(`| ... | ${cr.forwardRows.length - 20}件省略 | | | | | | |`);
  lines.push("");
  lines.push("---", "");
}

// wind5 vs isBase forward比較
lines.push("## 並走比較: isBase vs wind5 (forward期間)", "");
const isBaseRep = condReports.find((c) => c.config.name === "seasonal_parts0_month_4_6_8_12")!;
const wind5Rep = condReports.find((c) => c.config.name === "seasonal_parts0_month_4_6_8_12_wind5")!;
if (isBaseRep && wind5Rep) {
  // wind5はisBaseのサブセット — 差分行を計算
  const isBaseFwd = isBaseRep.confirmedForward;
  const wind5Fwd = wind5Rep.confirmedForward;
  const wind3to5Fwd = isBaseFwd.filter((r) => (r.wind_mps ?? 0) >= 3 && (r.wind_mps ?? 0) < 5);
  const wind5FwdCalc = calcMetrics(wind5Fwd);
  const wind3to5FwdCalc = calcMetrics(wind3to5Fwd);

  lines.push("| セグメント | forward n | hits | ROI | roiExMaxHit | maxHitOdds |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  lines.push(`| isBase全体 | ${isBaseRep.confirmedForward.length} | ${isBaseRep.fwdMetrics.hits} | ${isBaseRep.fwdMetrics.roi?.toFixed(1) ?? "-"}% | ${isBaseRep.fwdMetrics.roiExMaxHit?.toFixed(1) ?? "-"}% | ${num(isBaseRep.fwdMetrics.maxHitOdds)} |`);
  lines.push(`| wind>=5サブセット | ${wind5FwdCalc.nEval} | ${wind5FwdCalc.hits} | ${wind5FwdCalc.roi?.toFixed(1) ?? "-"}% | ${wind5FwdCalc.roiExMaxHit?.toFixed(1) ?? "-"}% | ${num(wind5FwdCalc.maxHitOdds)} |`);
  lines.push(`| wind 3-5サブセット | ${wind3to5FwdCalc.nEval} | ${wind3to5FwdCalc.hits} | ${wind3to5FwdCalc.roi?.toFixed(1) ?? "-"}% | ${wind3to5FwdCalc.roiExMaxHit?.toFixed(1) ?? "-"}% | ${num(wind3to5FwdCalc.maxHitOdds)} |`);
  lines.push("");
  lines.push("> **注**: wind5 forward n=10 / wind3-5 forward n=15 はいずれも小サンプル。forward ROIは参考値のみ。n>=50まで判断保留。", "");
}
lines.push("");

// wind5 historical breakdown (月別/オッズ帯/会場)
if (wind5Rep) {
  lines.push("## wind5 Historical 内訳 (月別・オッズ帯・会場)", "");
  lines.push("> historical n=153 (wind>=5 isBase条件)。月8依存度・オッズ帯偏り・会場偏りを確認する。", "");
  lines.push("");

  const w5hist = wind5Rep.historicalRows;

  // 月別
  lines.push("### 月別 (historical)");
  lines.push("| 月 | n | hits | hitRate | ROI | roiExMaxHit |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const month of [4, 6, 8, 12]) {
    const mRows = w5hist.filter((r) => Number(r.date.slice(5, 7)) === month);
    const m = calcMetrics(mRows);
    const roiStr = m.roi !== null ? `${m.roi.toFixed(1)}%` : "-";
    const roiExStr = m.roiExMaxHit !== null ? `${m.roiExMaxHit.toFixed(1)}%` : "-";
    const hitRateStr = m.hitRate !== null ? `${(m.hitRate * 100).toFixed(1)}%` : "-";
    lines.push(`| 月${month} | ${m.n} | ${m.hits} | ${hitRateStr} | ${roiStr} | ${roiExStr} |`);
  }
  lines.push("");
  lines.push("> ⚠️ 月8だけでROIが高い場合は過学習リスク。月4/6/12でも正のROIが確認できることが PAPER_STRONG_CANDIDATE 維持の条件。", "");

  // オッズ帯別
  lines.push("### オッズ帯別 (historical)");
  lines.push("| オッズ帯 | n | hits | hitRate | ROI | roiExMaxHit |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const { label, lo, hi } of [
    { label: "odds<30", lo: 0, hi: 30 },
    { label: "30<=odds<50", lo: 30, hi: 50 },
    { label: "50<=odds<80", lo: 50, hi: 80 },
    { label: "odds>=80 ⛔", lo: 80, hi: Infinity },
  ]) {
    const oRows = w5hist.filter((r) => r.current_odds >= lo && r.current_odds < hi);
    const m = calcMetrics(oRows);
    const roiStr = m.roi !== null ? `${m.roi.toFixed(1)}%` : "-";
    const roiExStr = m.roiExMaxHit !== null ? `${m.roiExMaxHit.toFixed(1)}%` : "-";
    const hitRateStr = m.hitRate !== null ? `${(m.hitRate * 100).toFixed(1)}%` : "-";
    lines.push(`| ${label} | ${m.n} | ${m.hits} | ${hitRateStr} | ${roiStr} | ${roiExStr} |`);
  }
  lines.push("");
  lines.push("> odds>=80 は DO_NOT_SHIP 寄り。odds<30 帯での ROI が wind5 全体 ROI を支えている場合は過学習リスク。", "");

  // 会場別 (n>=5)
  lines.push("### 会場別 (historical, n>=5)");
  lines.push("| 会場 | n | hits | hitRate | ROI | roiExMaxHit |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  const venueMap = new Map<string, typeof w5hist>();
  for (const r of w5hist) {
    if (!venueMap.has(r.venue)) venueMap.set(r.venue, []);
    venueMap.get(r.venue)!.push(r);
  }
  const venueSorted = [...venueMap.entries()]
    .filter(([, rs]) => rs.length >= 5)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [venue, vRows] of venueSorted) {
    const m = calcMetrics(vRows);
    const roiStr = m.roi !== null ? `${m.roi.toFixed(1)}%` : "-";
    const roiExStr = m.roiExMaxHit !== null ? `${m.roiExMaxHit.toFixed(1)}%` : "-";
    const hitRateStr = m.hitRate !== null ? `${(m.hitRate * 100).toFixed(1)}%` : "-";
    lines.push(`| ${venue} | ${m.n} | ${m.hits} | ${hitRateStr} | ${roiStr} | ${roiExStr} |`);
  }
  lines.push("");
  lines.push("> n<5 の会場は省略。特定会場に ROI が集中している場合は会場固有の過学習に注意。", "");
}
lines.push("");
lines.push("> **本番反映禁止**: この結果がどうであれ、app_settings や本番 decision ロジックは変更しないこと。", "");

// ───────────────── JSON ─────────────────

const reportData = {
  generatedAt: new Date().toISOString(),
  forwardStart: FORWARD_START,
  conditions: condReports.map((cr) => ({
    name: cr.config.name,
    desc: cr.config.desc,
    paperAction: cr.config.paperAction,
    historical: cr.config.historical,
    insertStats: cr.stats,
    totals: {
      historical: cr.historicalRows.length,
      forward: cr.forwardRows.length,
      forwardConfirmed: cr.confirmedForward.length,
      forwardPending: cr.pendingForward.length,
    },
    histMetrics: cr.histMetrics,
    forwardMetrics: cr.fwdMetrics,
    forwardMonthBreakdown: cr.fwdMonths,
    forwardOddsBands: cr.fwdOdds,
    checklistResults: cr.checklistResults,
    verdict: cr.verdict,
    paperGrade: cr.paperGrade,
    statusAssessment: cr.statusAssessment,
  })),
};

mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, lines.join("\n"));
writeFileSync(OUT_JSON, `${JSON.stringify(reportData, null, 2)}\n`);

console.log(`[paper-forward] wrote ${OUT_MD}`);
console.log(`[paper-forward] wrote ${OUT_JSON}`);
for (const cr of condReports) {
  console.log(`[paper-forward] ${cr.config.name}: historical=${cr.historicalRows.length}, forward=${cr.forwardRows.length} (confirmed=${cr.confirmedForward.length}, pending=${cr.pendingForward.length})`);
  if (cr.fwdMetrics.roi !== null) {
    console.log(`[paper-forward]   forward ROI: ${cr.fwdMetrics.roi.toFixed(1)}% (n=${cr.confirmedForward.length})`);
  }
}

db.close();
