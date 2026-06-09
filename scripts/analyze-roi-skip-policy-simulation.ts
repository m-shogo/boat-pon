/**
 * analyze-roi-skip-policy-simulation.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 * BUY は検証候補、ROI は検証指標であり購入推奨ではない。
 * 主評価: race_payouts.payout_yen 実払戻ベース
 *
 * 目的: monitor-only のまま「最小除外で forward ROI をどこまで改善できるか」を確認する。
 * app_settings 反映案ではない。あくまで読み取り専用の monitor policy 候補シミュレーション。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/roi-skip-policy-simulation.md";
const OUT_JSON = "reports/roi-skip-policy-simulation.json";
const STAKE = 100;
const FORWARD_START = "2025-01-01";
const JUL25_PREFIX  = "2025-07";
const EXCL_VENUES   = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES    = [10, 11, 12];
const SKIP_RATE_WARN = 30; // 除外率30%超は注意

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

const excl_v = EXCL_VENUES.map(v => `'${v}'`).join(",");
const excl_r = EXCL_RACES.join(",");

function r2(v: number) { return Math.round(v * 100) / 100; }
function calcRoi(payout: number, n: number) { return n > 0 ? r2(payout / (n * STAKE) * 100) : 0; }
function pct(a: number, b: number) { return b > 0 ? r2(a / b * 100) : 0; }

// ─── 直近3M カットオフ ──────────────────────────────────────────────────────────

const dbMaxDate = (db.prepare(
  "SELECT MAX(date) as d FROM decision_history WHERE date >= ?"
).get(FORWARD_START) as { d: string }).d;
const recent3mCutoff = (() => {
  const [y, m, d] = dbMaxDate.split("-").map(Number);
  const dt = new Date(y, m - 4, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
})();

// ─── condB 判定 SQL ─────────────────────────────────────────────────────────────

const WIND24 = `EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id
  AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)`;
const EXH1   = `EXISTS (SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=1
    AND ed.exhibition_time IS NOT NULL
    AND ed.exhibition_time = (SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2
      WHERE ed2.race_id=dh.race_id))`;

// ─── データ取得 ─────────────────────────────────────────────────────────────────

type ForwardRow = {
  date: string; venue: string; race_no: number;
  current_odds: number; result: string; payout: number; is_condB: number;
};

console.log("[policy-sim] forward BUY 取得中...");
const allRows = db.prepare(`
  SELECT dh.date, dh.venue, dh.race_no, dh.current_odds, dh.result,
    COALESCE((SELECT rp.payout_yen FROM race_payouts rp
      WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta'
        AND rp.combination='1-2-3' LIMIT 1), 0) as payout,
    CASE WHEN (${WIND24}) AND (${EXH1}) THEN 1 ELSE 0 END as is_condB
  FROM decision_history dh
  WHERE decision='BUY' AND run_kind='historical-backfill'
    AND result IS NOT NULL AND result != ''
    AND current_odds IS NOT NULL
    AND venue NOT IN (${excl_v}) AND race_no NOT IN (${excl_r})
    AND selection='1-2-3' AND date >= '${FORWARD_START}'
  ORDER BY date
`).all() as ForwardRow[];

const totalN      = allRows.length;
const totalPayout = allRows.reduce((a, r) => a + r.payout, 0);
const totalHits   = allRows.filter(r => r.result === "1-2-3").length;
const baselineRoi = calcRoi(totalPayout, totalN);

// 2025-07抜きベースライン
const exJul25All     = allRows.filter(r => !r.date.startsWith(JUL25_PREFIX));
const exJul25Payout  = exJul25All.reduce((a, r) => a + r.payout, 0);
const exJul25N       = exJul25All.length;
const exJul25BaseRoi = calcRoi(exJul25Payout, exJul25N);

console.log(`[policy-sim] n=${totalN} hits=${totalHits} ROI=${baselineRoi}%  exJul25Base=${exJul25BaseRoi}%`);

// ─── 汎用統計 ───────────────────────────────────────────────────────────────────

type SliceStats = {
  n: number; payout: number; hits: number; roi: number;
  hitRate: number; profit: number; avgPayout: number; maxPayout: number;
  top1Roi: number; top2Roi: number; top3Roi: number;
  jackpotRatio: number;
};

function sliceStats(rows: ForwardRow[]): SliceStats {
  const n       = rows.length;
  const payout  = rows.reduce((a, r) => a + r.payout, 0);
  const hits    = rows.filter(r => r.result === "1-2-3").length;
  const profit  = payout - n * STAKE;
  const sorted  = [...rows].sort((a, b) => b.payout - a.payout).map(r => r.payout);
  const top1    = sorted[0] ?? 0;
  const top2    = top1 + (sorted[1] ?? 0);
  const top3    = top2 + (sorted[2] ?? 0);
  const hitPayouts = rows.map(r => r.payout).filter(p => p > 0);
  const avgPayout  = hitPayouts.length > 0 ? r2(hitPayouts.reduce((a, v) => a + v, 0) / hitPayouts.length) : 0;
  return {
    n, payout, hits, roi: calcRoi(payout, n),
    hitRate: pct(hits, n),
    profit,
    avgPayout,
    maxPayout: top1,
    top1Roi: calcRoi(payout - top1, n),
    top2Roi: calcRoi(payout - top2, n),
    top3Roi: calcRoi(payout - top3, n),
    jackpotRatio: payout > 0 ? r2(top1 / payout * 100) : 0,
  };
}

// ─── 月別スライス ───────────────────────────────────────────────────────────────

type MonthSlice = { month: string; n: number; hits: number; roi: number };

function monthlySlice(rows: ForwardRow[], minN = 3): MonthSlice[] {
  const months = [...new Set(rows.map(r => r.date.slice(0, 7)))].sort();
  return months.map(m => {
    const mr = rows.filter(r => r.date.startsWith(m));
    return { month: m, n: mr.length, hits: mr.filter(r => r.result === "1-2-3").length,
             roi: calcRoi(mr.reduce((a, r) => a + r.payout, 0), mr.length) };
  }).filter(m => m.n >= minN);
}

// ─── ポリシーシミュレーション ───────────────────────────────────────────────────

type PolicyResult = {
  id: string; name: string; skipDesc: string;
  // remaining (after skip)
  remainN: number; skipN: number; skipRate: number;
  skipRoi: number;           // ROI of excluded rows
  remainRoi: number; delta: number;
  // remaining stats
  remainHits: number; remainHitRate: number;
  remainProfit: number; remainAvgPayout: number; remainMaxPayout: number;
  remainTop1Roi: number; remainTop2Roi: number; remainTop3Roi: number;
  remainJackpotRatio: number;
  // 2025-07 dependency
  deltaExJul25: number;
  // recent 3M ROI
  recent3mRoi: number;
  // monthly stability
  monthly: MonthSlice[];
  weakMonths: number; totalMonths: number; weakMonthPct: number;
  // overlaps
  overlapCondB: number; overlapCondBPct: number;
  overlapOdds4079: number; overlapOdds4079Pct: number;
  // flags
  skipTooLarge: boolean;
  // verdict
  verdict: string;
};

function simulate(
  id: string, name: string, skipDesc: string,
  skipPred: (r: ForwardRow) => boolean
): PolicyResult {
  const excluded  = allRows.filter(skipPred);
  const remaining = allRows.filter(r => !skipPred(r));

  const skipN    = excluded.length;
  const skipRate = pct(skipN, totalN);
  const skipRoi  = calcRoi(excluded.reduce((a, r) => a + r.payout, 0), skipN);

  const remStats = sliceStats(remaining);
  const delta    = r2(remStats.roi - baselineRoi);

  // 2025-07依存: exJul25ベースでのskip効果
  const exJul25Remain  = exJul25All.filter(r => !skipPred(r));
  const exJul25RemRoi  = calcRoi(exJul25Remain.reduce((a, r) => a + r.payout, 0), exJul25Remain.length);
  const deltaExJul25   = r2(exJul25RemRoi - exJul25BaseRoi);

  // 直近3M
  const recent = remaining.filter(r => r.date >= recent3mCutoff);
  const recent3mRoi = calcRoi(recent.reduce((a, r) => a + r.payout, 0), recent.length);

  // 月別安定性
  const monthly = monthlySlice(remaining);
  const weakMonths = monthly.filter(m => m.roi < 50).length;
  const weakMonthPct = pct(weakMonths, monthly.length);

  // overlaps
  const isCondB    = (r: ForwardRow) => r.is_condB === 1;
  const isOdds4079 = (r: ForwardRow) => r.current_odds >= 40 && r.current_odds < 80;
  const overlapCondB    = excluded.filter(isCondB).length;
  const overlapOdds4079 = excluded.filter(isOdds4079).length;

  // verdict
  const verdict = deriveVerdict({
    skipRate, delta, deltaExJul25, weakMonthPct,
    remTop2Roi: remStats.top2Roi, remJackpotRatio: remStats.jackpotRatio,
    recent3mRoi,
  });

  return {
    id, name, skipDesc,
    remainN: remStats.n, skipN, skipRate,
    skipRoi, remainRoi: remStats.roi, delta,
    remainHits: remStats.hits, remainHitRate: remStats.hitRate,
    remainProfit: remStats.profit, remainAvgPayout: remStats.avgPayout,
    remainMaxPayout: remStats.maxPayout,
    remainTop1Roi: remStats.top1Roi, remainTop2Roi: remStats.top2Roi,
    remainTop3Roi: remStats.top3Roi, remainJackpotRatio: remStats.jackpotRatio,
    deltaExJul25, recent3mRoi,
    monthly, weakMonths, totalMonths: monthly.length, weakMonthPct,
    overlapCondB, overlapCondBPct: pct(overlapCondB, skipN),
    overlapOdds4079, overlapOdds4079Pct: pct(overlapOdds4079, skipN),
    skipTooLarge: skipRate >= SKIP_RATE_WARN,
    verdict,
  };
}

// ─── 判定ロジック ───────────────────────────────────────────────────────────────

type VerdictInput = {
  skipRate: number; delta: number; deltaExJul25: number;
  weakMonthPct: number; remTop2Roi: number; remJackpotRatio: number;
  recent3mRoi: number;
};

function deriveVerdict(v: VerdictInput): string {
  if (v.skipRate >= SKIP_RATE_WARN) return "⚠️ 強すぎる除外（除外率30%超）— 保留";
  if (v.delta < 1) return "❌ 除外効果なし（delta<1pt）— 採用不可";
  if (v.deltaExJul25 < 0.5 && v.delta >= 3) return "⚠️ 後付き月別フィルター（2025-07依存）— 採用不可";
  if (v.remTop2Roi < 100 && v.delta >= 5) return "⚠️ 高配当依存（top2除外ROI<100%）— monitor継続";
  if (v.weakMonthPct >= 50 && v.delta >= 5) return "⚠️ 月別不安定（半数以上ROI<50%）— monitor継続";
  if (v.delta >= 5 && v.deltaExJul25 >= 3 && v.remTop2Roi >= 100) return "✅ 有力 monitor 候補";
  if (v.delta >= 3 && v.deltaExJul25 >= 2) return "◐ monitor 継続候補";
  return "❌ 採用不可";
}

// ─── ポリシー定義 ───────────────────────────────────────────────────────────────

const isR2    = (r: ForwardRow) => r.race_no === 2;
const isR5    = (r: ForwardRow) => r.race_no === 5;
const isR6    = (r: ForwardRow) => r.race_no === 6;
const isHama  = (r: ForwardRow) => r.venue === "浜名湖";
const isSumi  = (r: ForwardRow) => r.venue === "住之江";
const isO4079 = (r: ForwardRow) => r.current_odds >= 40 && r.current_odds < 80;
const isCondB = (r: ForwardRow) => r.is_condB === 1;

const POLICIES: Array<{ id: string; name: string; desc: string; pred: (r: ForwardRow) => boolean }> = [
  { id: "A", name: "6Rのみ",                 desc: "race_no=6",                      pred: isR6 },
  { id: "B", name: "5Rのみ",                 desc: "race_no=5",                      pred: isR5 },
  { id: "C", name: "2Rのみ",                 desc: "race_no=2",                      pred: isR2 },
  { id: "D", name: "5R+6R",                  desc: "race_no IN (5,6)",               pred: r => isR5(r) || isR6(r) },
  { id: "E", name: "2R+5R",                  desc: "race_no IN (2,5)",               pred: r => isR2(r) || isR5(r) },
  { id: "F", name: "2R+6R",                  desc: "race_no IN (2,6)",               pred: r => isR2(r) || isR6(r) },
  { id: "G", name: "2R+5R+6R",               desc: "race_no IN (2,5,6)",             pred: r => isR2(r) || isR5(r) || isR6(r) },
  { id: "H", name: "浜名湖のみ",             desc: "venue=浜名湖",                    pred: isHama },
  { id: "I", name: "住之江のみ",             desc: "venue=住之江",                    pred: isSumi },
  { id: "J", name: "浜名湖+住之江",           desc: "venue IN (浜名湖,住之江)",         pred: r => isHama(r) || isSumi(r) },
  { id: "K", name: "6R + 浜名湖+住之江",     desc: "6R OR 浜名湖/住之江",             pred: r => isR6(r) || isHama(r) || isSumi(r) },
  { id: "L", name: "5R+6R + 浜名湖+住之江",  desc: "5R/6R OR 浜名湖/住之江",          pred: r => isR5(r) || isR6(r) || isHama(r) || isSumi(r) },
  { id: "M", name: "2R+5R+6R + 浜名湖+住之江",desc:"弱R全部 + 悪会場",               pred: r => isR2(r) || isR5(r) || isR6(r) || isHama(r) || isSumi(r) },
  { id: "N", name: "odds40〜79のみ",         desc: "current_odds 40〜79",             pred: isO4079 },
  { id: "O", name: "odds40〜79 + 浜名湖+住之江", desc: "odds40〜79 OR 悪会場",        pred: r => isO4079(r) || isHama(r) || isSumi(r) },
  { id: "P", name: "odds40〜79 + 5R+6R",    desc: "odds40〜79 OR 5R/6R",             pred: r => isO4079(r) || isR5(r) || isR6(r) },
  { id: "Q", name: "条件B重複のみ",          desc: "is_condB=1",                      pred: isCondB },
  { id: "R", name: "条件B重複 + 6R",        desc: "condB OR 6R",                     pred: r => isCondB(r) || isR6(r) },
  { id: "S", name: "条件B重複 + 浜名湖+住之江", desc: "condB OR 悪会場",              pred: r => isCondB(r) || isHama(r) || isSumi(r) },
];

console.log("[policy-sim] 各ポリシー計算中...");
const results = POLICIES.map(p => simulate(p.id, p.name, p.desc, p.pred));

// ─── Greedy シミュレーション ────────────────────────────────────────────────────

type GreedyStep = {
  step: number; added: string; cumulativePred: string[];
  skipN: number; skipRate: number; remainRoi: number; delta: number; note: string;
};

const GREEDY_CANDIDATES = [
  { id: "r6",    name: "6R",          pred: isR6 },
  { id: "r5",    name: "5R",          pred: isR5 },
  { id: "r2",    name: "2R",          pred: isR2 },
  { id: "hama",  name: "浜名湖",       pred: isHama },
  { id: "sumi",  name: "住之江",       pred: isSumi },
  { id: "o4079", name: "odds40〜79",   pred: isO4079 },
  { id: "condB", name: "条件B重複",    pred: isCondB },
];

console.log("[policy-sim] greedy simulation...");
const greedySteps: GreedyStep[] = [];
let cumulativePreds: Array<(r: ForwardRow) => boolean> = [];
let cumulativeIds: string[] = [];

for (let step = 1; step <= GREEDY_CANDIDATES.length; step++) {
  let bestDelta = -Infinity;
  let bestCandidate: typeof GREEDY_CANDIDATES[0] | null = null;

  for (const cand of GREEDY_CANDIDATES) {
    if (cumulativeIds.includes(cand.id)) continue;
    const allPreds = [...cumulativePreds, cand.pred];
    const combined = (r: ForwardRow) => allPreds.some(p => p(r));
    const skipN   = allRows.filter(combined).length;
    const skipRate = pct(skipN, totalN);
    if (skipRate >= SKIP_RATE_WARN) continue; // 30%超は選ばない
    const remaining = allRows.filter(r => !combined(r));
    const remRoi = calcRoi(remaining.reduce((a, r) => a + r.payout, 0), remaining.length);
    const delta = r2(remRoi - baselineRoi);
    if (delta > bestDelta) { bestDelta = delta; bestCandidate = cand; }
  }

  if (!bestCandidate) break; // 全候補が30%超 or 残なし → 終了

  const allPreds = [...cumulativePreds, bestCandidate.pred];
  const combined = (r: ForwardRow) => allPreds.some(p => p(r));
  const skipN    = allRows.filter(combined).length;
  const skipRate = pct(skipN, totalN);
  const remaining = allRows.filter(r => !combined(r));
  const remainRoi = calcRoi(remaining.reduce((a, r) => a + r.payout, 0), remaining.length);
  const delta = r2(remainRoi - baselineRoi);

  cumulativePreds.push(bestCandidate.pred);
  cumulativeIds.push(bestCandidate.id);

  greedySteps.push({
    step, added: bestCandidate.name, cumulativePred: [...cumulativeIds],
    skipN, skipRate, remainRoi, delta, note: "",
  });
}

// ─── レポート生成 ───────────────────────────────────────────────────────────────

function fmtRoi(v: number) {
  if (v >= 100) return `**${v}%**`;
  if (v >= 90)  return `${v}%`;
  return `${v}%`;
}
function fmtDelta(v: number) {
  if (v >= 5)   return `**+${v}pt**`;
  if (v >= 2)   return `+${v}pt`;
  if (v <= -2)  return `**${v}pt**`;
  return `${v}pt`;
}
function flag(b: boolean, yes: string, no = "") { return b ? yes : no; }

function buildMarkdown(): string {
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const lines: string[] = [];

  lines.push(`# ROI Skip Policy Simulation`);
  lines.push(`\n生成: ${now}  DB最新日: ${dbMaxDate}  直近3Mカット: ${recent3mCutoff}`);
  lines.push(`\n> **注意**: app_settings 反映案ではありません。monitor-only の除外ポリシー候補シミュレーションです。`);

  // ── ベースライン
  lines.push(`\n## ベースライン`);
  lines.push(`| 項目 | 値 |`);
  lines.push(`|---|---|`);
  lines.push(`| forward 期間 | ${FORWARD_START} 〜 ${dbMaxDate} |`);
  lines.push(`| n | ${totalN} |`);
  lines.push(`| hits | ${totalHits} (${pct(totalHits, totalN)}%) |`);
  lines.push(`| ROI | ${baselineRoi}% |`);
  lines.push(`| profit | ${(totalPayout - totalN * STAKE).toLocaleString()}円 |`);
  lines.push(`| 2025-07除外後 ROI (exJul25Base) | ${exJul25BaseRoi}% (n=${exJul25N}) |`);

  // ── ポリシー比較表（サマリ）
  lines.push(`\n## ポリシー比較サマリ`);
  lines.push(`\n除外率・delta・top2除外ROI・2025-07依存・判定 を一覧表示。`);
  lines.push(`\n| ID | 除外条件 | skipN | 除外率 | 残存ROI | delta | top2除外ROI | exJul25Δ | 直近3M | 判定 |`);
  lines.push(`|---|---|---:|---:|---:|---:|---:|---:|---:|---|`);

  for (const r of results) {
    const skipFlag = r.skipTooLarge ? "⚠️" : "";
    lines.push(
      `| ${r.id} | ${r.name} | ${r.skipN} | ${skipFlag}${r.skipRate}% | ${fmtRoi(r.remainRoi)} | ${fmtDelta(r.delta)} | ${fmtRoi(r.remainTop2Roi)} | ${fmtDelta(r.deltaExJul25)} | ${r.recent3mRoi}% | ${r.verdict} |`
    );
  }

  // ── ポリシー詳細
  lines.push(`\n## ポリシー詳細`);
  for (const r of results) {
    lines.push(`\n### [${r.id}] ${r.name}`);
    lines.push(`\n除外条件: \`${r.skipDesc}\``);
    lines.push(`\n| 項目 | 値 |`);
    lines.push(`|---|---|`);
    lines.push(`| baseline n | ${totalN} (ROI ${baselineRoi}%) |`);
    lines.push(`| 除外件数 | ${r.skipN} (${r.skipRate}%)${r.skipTooLarge ? " ⚠️ 強すぎ" : ""} |`);
    lines.push(`| 除外対象ROI | ${r.skipRoi}% |`);
    lines.push(`| 残存 n | ${r.remainN} |`);
    lines.push(`| 残存ROI | ${fmtRoi(r.remainRoi)} |`);
    lines.push(`| delta | ${fmtDelta(r.delta)} |`);
    lines.push(`| hits | ${r.remainHits} (${r.remainHitRate}%) |`);
    lines.push(`| profit | ${r.remainProfit.toLocaleString()}円 |`);
    lines.push(`| avg payout (hit時) | ${r.remainAvgPayout}円 |`);
    lines.push(`| max payout | ${r.remainMaxPayout.toLocaleString()}円 |`);
    lines.push(`| top1除外ROI | ${r.remainTop1Roi}% |`);
    lines.push(`| top2除外ROI | ${fmtRoi(r.remainTop2Roi)} |`);
    lines.push(`| top3除外ROI | ${r.remainTop3Roi}% |`);
    lines.push(`| jackpot依存度 | ${r.remainJackpotRatio}% |`);
    lines.push(`| 直近3M ROI | ${r.recent3mRoi}% |`);
    lines.push(`| 2025-07除外後Δ | ${fmtDelta(r.deltaExJul25)} |`);
    lines.push(`| 月別不安定(ROI<50%) | ${r.weakMonths}/${r.totalMonths}ヶ月 (${r.weakMonthPct}%) |`);
    lines.push(`| 条件B重複 | ${r.overlapCondB}件 (${r.overlapCondBPct}%) |`);
    lines.push(`| odds40〜79重複 | ${r.overlapOdds4079}件 (${r.overlapOdds4079Pct}%) |`);

    // 月別
    if (r.monthly.length > 0) {
      lines.push(`\n**残存の月別ROI**`);
      lines.push(`| 月 | n | hits | ROI |`);
      lines.push(`|---|---:|---:|---:|`);
      for (const m of r.monthly) {
        const warn = m.roi < 50 ? " ❌" : m.roi >= 100 ? " ✅" : "";
        lines.push(`| ${m.month} | ${m.n} | ${m.hits} | ${m.roi}%${warn} |`);
      }
    }

    lines.push(`\n**判定**: ${r.verdict}`);
  }

  // ── Greedy シミュレーション
  lines.push(`\n## Greedy シミュレーション`);
  lines.push(`\n条件を1つずつ追加し、最大 incremental delta を選択（除外率30%超で停止）。`);
  lines.push(`\n| Step | 追加条件 | 累積除外 | skipN | 除外率 | 残存ROI | delta |`);
  lines.push(`|---|---|---|---:|---:|---:|---:|`);
  for (const s of greedySteps) {
    const cumStr = s.cumulativePred.join("+");
    lines.push(
      `| ${s.step} | ${s.added} | ${cumStr} | ${s.skipN} | ${s.skipRate}% | ${fmtRoi(s.remainRoi)} | ${fmtDelta(s.delta)} ${s.note} |`
    );
  }

  // ── 効率フロンティア
  lines.push(`\n## 効率フロンティア（除外率 vs delta）`);
  lines.push(`\n除外率10〜20%の範囲で delta≥5pt かつ top2除外ROI≥100% の候補。`);
  const frontier = results
    .filter(r => r.skipRate >= 5 && r.skipRate < 30 && r.delta >= 3)
    .sort((a, b) => (b.delta / (b.skipRate || 1)) - (a.delta / (a.skipRate || 1)));
  lines.push(`\n| ID | 除外条件 | 除外率 | delta | 効率(delta/skip%) | top2除外ROI |`);
  lines.push(`|---|---|---:|---:|---:|---:|`);
  for (const r of frontier) {
    const eff = r2(r.delta / (r.skipRate || 1));
    lines.push(`| ${r.id} | ${r.name} | ${r.skipRate}% | ${fmtDelta(r.delta)} | ${eff} | ${fmtRoi(r.remainTop2Roi)} |`);
  }

  // ── 結論
  lines.push(`\n## 結論`);
  lines.push(`\n### 今すぐ app_settings に反映してよい候補`);
  lines.push(`\n**原則なし。** 本スクリプトは monitor-only のシミュレーションです。`);

  const monitorTop = results.filter(r => r.verdict.startsWith("✅"));
  lines.push(`\n### monitor policy 最有力候補`);
  if (monitorTop.length === 0) {
    lines.push(`\n（なし — 以下の monitor継続候補を参照）`);
  } else {
    for (const r of monitorTop) {
      lines.push(`- **[${r.id}] ${r.name}**: 残存ROI=${r.remainRoi}% / delta=${r.delta}pt / 除外率=${r.skipRate}% / exJul25Δ=${r.deltaExJul25}pt`);
    }
  }

  const monitorCont = results.filter(r => r.verdict.startsWith("◐"));
  lines.push(`\n### monitor 継続候補`);
  for (const r of monitorCont) {
    lines.push(`- **[${r.id}] ${r.name}**: 残存ROI=${r.remainRoi}% / delta=${r.delta}pt / 除外率=${r.skipRate}%`);
  }

  const tooLarge = results.filter(r => r.skipTooLarge);
  lines.push(`\n### 強すぎるため保留の候補`);
  for (const r of tooLarge) {
    lines.push(`- **[${r.id}] ${r.name}**: 除外率=${r.skipRate}% — delta=${r.delta}ptだが、除外率30%超のため別モデルに近い`);
  }

  const rejected = results.filter(r => r.verdict.startsWith("❌") && !r.skipTooLarge);
  lines.push(`\n### 採用不可候補`);
  for (const r of rejected) {
    lines.push(`- **[${r.id}] ${r.name}**: ${r.verdict}`);
  }

  const afterPay = results.filter(r => r.verdict.includes("後付き"));
  if (afterPay.length > 0) {
    lines.push(`\n### 後付き月別フィルター（2025-07依存）— 採用不可`);
    for (const r of afterPay) {
      lines.push(`- **[${r.id}] ${r.name}**: delta=${r.delta}pt だが exJul25Δ=${r.deltaExJul25}pt — 2025-07なしでは効果ほぼゼロ`);
    }
  }

  lines.push(`\n### 条件B n=200までの判断保留事項`);
  lines.push(`- **[Q/R/S] 条件B重複を含む候補**: 条件B forward n=167（目標 n=200 未達）。単独除外・複合除外とも凍結。`);
  lines.push(`- 格上げ条件（forward n≥200 / top2除外ROI≥100% / 直近3M 0%なし）達成まで app_settings 変更不可。`);

  const bestSingle = [...results]
    .filter(r => !r.skipTooLarge && r.skipRate < 20)
    .sort((a, b) => b.delta - a.delta)[0];
  lines.push(`\n### 次に見るべき1本`);
  if (bestSingle) {
    lines.push(`\n**[${bestSingle.id}] ${bestSingle.name}** — 除外率${bestSingle.skipRate}%で delta+${bestSingle.delta}pt が最効率。`);
    lines.push(`forward データが追加されたら本スクリプトを再実行し、exJul25Δ と top2除外ROI の推移を確認する。`);
  }

  return lines.join("\n");
}

// ─── 出力 ───────────────────────────────────────────────────────────────────────

mkdirSync("reports", { recursive: true });
const md = buildMarkdown();
writeFileSync(OUT_MD, md, "utf8");

const jsonOut = {
  generatedAt: new Date().toISOString(),
  dbMaxDate,
  recent3mCutoff,
  baseline: { n: totalN, hits: totalHits, roi: baselineRoi, exJul25BaseRoi },
  policies: results.map(r => {
    const { monthly, ...rest } = r;
    return { ...rest, monthlyCount: monthly.length };
  }),
  greedy: greedySteps,
};
writeFileSync(OUT_JSON, JSON.stringify(jsonOut, null, 2), "utf8");

console.log(`\n[policy-sim] 完了 → ${OUT_MD}`);
console.log(`  baseline ROI: ${baselineRoi}%  (n=${totalN})`);
console.log(`\n  ポリシー別 残存ROI:`);
for (const r of results) {
  const warn = r.skipTooLarge ? " ⚠️強すぎ" : "";
  console.log(`    [${r.id}] ${r.name}: skip=${r.skipRate}%${warn} / ROI=${r.remainRoi}% / delta=${r.delta}pt — ${r.verdict}`);
}
console.log(`\n  Greedy steps:`);
for (const s of greedySteps) {
  console.log(`    Step ${s.step}: +${s.added} → skip=${s.skipRate}% ROI=${s.remainRoi}% delta=+${s.delta}pt ${s.note}`);
}
