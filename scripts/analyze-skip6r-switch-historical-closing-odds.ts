/**
 * analyze-skip6r-switch-historical-closing-odds.ts — 読み取り専用
 *
 * 禁止: 既存DBへのINSERT/UPDATE/DELETE/DROP, app_settings変更, 本番decision変更
 * 禁止: 自動投票・ログイン保存・投票サイト操作
 * BUY は検証候補、ROI は検証指標であり購入推奨ではない。
 *
 * 目的: H004 — 6R (skip6R) において historical closing odds を使った
 *   skip / switch 予備検証を行う。
 *   - 6R を除外すべきか (H003 skip との比較)
 *   - 6R だけ別買い目に switch する価値があるか
 *   - venue × 6R / 月別 で偏り・期間依存がないか
 *
 * ⚠️ 重要な注意:
 *   - これは historical closing odds backtest であり、live/T-5/T-10 forward ではない
 *   - historical closing odds で良い結果が出ても app_settings/本番decision への反映は禁止
 *   - 本採用には future-only odds_timeseries での再確認が必要
 *   - 事後最適化 (best-of / 結果を見て最良買い目選択) は禁止
 *   - ROI だけで結論を出さない: n / hit数 / 最大連敗 / 月別・会場別安定性 込みで判定
 *
 * 比較戦略:
 *   A. baseline:      6R で 1-2-3 を買う (現行)
 *   B. skip:          6R を全て見送る (残存 = 6R以外の1-2-3)
 *   C. switch 1-3-2
 *   D. switch 1-2-4
 *   E. switch 1-4-2
 *   F. switch 1-3-4
 *   H. hybrid skip:   6R以外は1-2-3, 6Rはskip
 *   I. hybrid 1-3-2:  6R以外は1-2-3, 6Rは1-3-2にswitch
 *   J. hybrid 1-3-4:  6R以外は1-2-3, 6Rは1-3-4にswitch
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/skip6r-switch-historical-closing-odds.md";
const OUT_JSON = "reports/skip6r-switch-historical-closing-odds.json";

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

const FORWARD_START = "2025-01-01";
const EXCL_VENUES   = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES    = [10, 11, 12];
const UNIT          = 100; // 1点 100円
const TOP_EXCLUDE_N = 2;
const MIN_N_FOR_JUDGE = 30;
const MIN_HITS_FOR_JUDGE = 3;

const excl_v = EXCL_VENUES.map(v => `'${v}'`).join(",");
const excl_r = EXCL_RACES.join(",");

// ─── 対象レース（BUY forward baseline） ───────────────────────────────────────

type Race = {
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  current_odds: number;
};

const allForwardRaces = db.prepare(`
  SELECT DISTINCT dh.race_id, dh.date, dh.venue, dh.race_no, dh.current_odds
  FROM decision_history dh
  WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
    AND dh.result IS NOT NULL AND dh.result != ''
    AND dh.current_odds IS NOT NULL
    AND dh.venue NOT IN (${excl_v})
    AND dh.race_no NOT IN (${excl_r})
    AND dh.selection='1-2-3'
    AND dh.date >= '${FORWARD_START}'
  ORDER BY dh.date
`).all() as Race[];

const skip6RRaces = allForwardRaces.filter(r => r.race_no === 6);
const non6RRaces  = allForwardRaces.filter(r => r.race_no !== 6);
const skip6RIdSet = new Set(skip6RRaces.map(r => r.race_id));

console.log(`全 forward BUY race: ${allForwardRaces.length}件 / 6R: ${skip6RRaces.length}件 / 6R以外: ${non6RRaces.length}件`);

// ─── condB との重複 (注意喚起用) ──────────────────────────────────────────────

const WIND24 = `EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id
  AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)`;
const EXH1   = `EXISTS (SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=1
    AND ed.exhibition_time IS NOT NULL
    AND ed.exhibition_time = (SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2
      WHERE ed2.race_id=dh.race_id))`;

const condB6ROverlap = (db.prepare(`
  SELECT COUNT(DISTINCT dh.race_id) n
  FROM decision_history dh
  WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
    AND dh.result IS NOT NULL AND dh.result != ''
    AND dh.current_odds IS NOT NULL
    AND dh.venue NOT IN (${excl_v})
    AND dh.race_no NOT IN (${excl_r})
    AND dh.selection='1-2-3'
    AND dh.date >= '${FORWARD_START}'
    AND dh.race_no=6
    AND ${WIND24} AND ${EXH1}
`).get() as { n: number }).n;

// ─── historical closing odds 取得 ─────────────────────────────────────────────

type OddsMap = Record<string, number | null>;
const closingOddsMap = new Map<string, OddsMap>();

type OddsRow = { race_id: string; combination: string; odds: number };
const allOdds = db.prepare(`
  SELECT race_id, combination, odds
  FROM historical_alternative_odds
  WHERE source_quality = 'historical_closing_odds'
`).all() as OddsRow[];

for (const row of allOdds) {
  if (!closingOddsMap.has(row.race_id)) closingOddsMap.set(row.race_id, {});
  closingOddsMap.get(row.race_id)![row.combination] = row.odds;
}

// ─── 払戻データ取得 (全forward分を一括) ──────────────────────────────────────

type PayoutRow = { race_id: string; combination: string; payout_yen: number };
const allForwardIds = allForwardRaces.map(r => `'${r.race_id}'`).join(",");
const allPayouts = allForwardIds.length > 0
  ? db.prepare(`
      SELECT race_id, combination, payout_yen
      FROM race_payouts
      WHERE race_id IN (${allForwardIds}) AND bet_type = 'trifecta'
    `).all() as PayoutRow[]
  : [];
const payoutMap = new Map<string, Record<string, number>>();
for (const p of allPayouts) {
  if (!payoutMap.has(p.race_id)) payoutMap.set(p.race_id, {});
  payoutMap.get(p.race_id)![p.combination] = p.payout_yen;
}

// ─── 戦略計算ロジック ─────────────────────────────────────────────────────────

const THREE_MONTHS_AGO = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString().slice(0, 10);
})();

function ym(date: string) { return date.slice(0, 7); }

type RaceResult = {
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  bet_combination: string;
  invest: number;
  payout: number;
  profit: number;
  closing_odds: number | null;
  hit: boolean;
  notes: string;
};

function calcStrategy(races: Race[], combination: string, notes: string): RaceResult[] {
  const results: RaceResult[] = [];
  for (const r of races) {
    const oddsMap = closingOddsMap.get(r.race_id) ?? {};
    const closing_odds = oddsMap[combination] ?? null;
    const pMap = payoutMap.get(r.race_id) ?? {};
    const payout_yen = pMap[combination] ?? 0;
    const hit = payout_yen > 0;
    results.push({
      race_id: r.race_id, date: r.date, venue: r.venue, race_no: r.race_no,
      bet_combination: combination,
      invest: UNIT,
      payout: hit ? payout_yen / 100 * UNIT : 0,
      profit: hit ? payout_yen / 100 * UNIT - UNIT : -UNIT,
      closing_odds, hit,
      notes: closing_odds === null ? `${notes};no_closing_odds` : notes,
    });
  }
  return results;
}

function maxLosingStreak(results: RaceResult[]): number {
  const sorted = [...results].sort((a, b) => a.date.localeCompare(b.date) || a.race_id.localeCompare(b.race_id));
  let max = 0, cur = 0;
  for (const r of sorted) {
    if (r.hit) { cur = 0; } else { cur++; if (cur > max) max = cur; }
  }
  return max;
}

type Verdict = "promote" | "watch" | "reject" | "insufficient";

type StrategyStats = {
  name: string;
  combination: string;
  n: number;
  n_closing_odds: number;
  hits: number;
  hitRate: number;
  invest: number;
  payout: number;
  roi: number;
  profit: number;
  avgClosingOdds: number | null;
  medClosingOdds: number | null;
  maxPayout: number;
  maxLosingStreak: number;
  topNExcludeRoi: number;
  recent3mRoi: number;
  recent3mN: number;
  monthlyRoi: Record<string, { n: number; hits: number; roi: number }>;
  venueRoi: Record<string, { n: number; hits: number; roi: number }>;
  raceNoRoi: Record<string, { n: number; hits: number; roi: number }>;
  zeroHitMonths: string[];
  dataInsufficient: boolean;
  overfittingWarnings: string[];
  results: RaceResult[];
};

function aggregateStats(name: string, combination: string, results: RaceResult[]): StrategyStats {
  const n = results.length;
  const withOdds = results.filter(r => r.closing_odds !== null);
  const hits = results.filter(r => r.hit).length;
  const hitRate = n > 0 ? hits / n : 0;
  const invest = n * UNIT;
  const payout = results.reduce((s, r) => s + r.payout, 0);
  const roi = invest > 0 ? payout / invest * 100 : 0;

  const oddsArr = withOdds.map(r => r.closing_odds!).sort((a, b) => a - b);
  const avgClosingOdds = oddsArr.length > 0 ? oddsArr.reduce((s, v) => s + v, 0) / oddsArr.length : null;
  const medClosingOdds = oddsArr.length > 0 ? oddsArr[Math.floor(oddsArr.length / 2)] : null;

  const maxPayout = Math.max(0, ...results.map(r => r.payout));

  const sortedPayouts = [...results].sort((a, b) => b.payout - a.payout);
  const excludedTopN = new Set(sortedPayouts.slice(0, TOP_EXCLUDE_N).map(r => r.race_id));
  const excResults = results.filter(r => !excludedTopN.has(r.race_id));
  const excInvest = excResults.length * UNIT;
  const excPayout = excResults.reduce((s, r) => s + r.payout, 0);
  const topNExcludeRoi = excInvest > 0 ? excPayout / excInvest * 100 : 0;

  const recent = results.filter(r => r.date >= THREE_MONTHS_AGO);
  const recent3mN = recent.length;
  const recentInvest = recent.length * UNIT;
  const recentPayout = recent.reduce((s, r) => s + r.payout, 0);
  const recent3mRoi = recentInvest > 0 ? recentPayout / recentInvest * 100 : 0;

  const monthlyRoi: StrategyStats["monthlyRoi"] = {};
  for (const r of results) {
    const m = ym(r.date);
    if (!monthlyRoi[m]) monthlyRoi[m] = { n: 0, hits: 0, roi: 0 };
    monthlyRoi[m].n++;
    if (r.hit) monthlyRoi[m].hits++;
  }
  for (const m of Object.keys(monthlyRoi)) {
    const mr = results.filter(x => ym(x.date) === m);
    const mInvest = mr.length * UNIT;
    const mPayout = mr.reduce((s, r) => s + r.payout, 0);
    monthlyRoi[m].roi = mInvest > 0 ? mPayout / mInvest * 100 : 0;
  }
  const zeroHitMonths = Object.entries(monthlyRoi)
    .filter(([, mo]) => mo.n >= 5 && mo.hits === 0)
    .map(([m]) => m).sort();

  const venueRoi: StrategyStats["venueRoi"] = {};
  for (const r of results) {
    if (!venueRoi[r.venue]) venueRoi[r.venue] = { n: 0, hits: 0, roi: 0 };
    venueRoi[r.venue].n++;
    if (r.hit) venueRoi[r.venue].hits++;
  }
  for (const v of Object.keys(venueRoi)) {
    const vr = results.filter(x => x.venue === v);
    const vInvest = vr.length * UNIT;
    const vPayout = vr.reduce((s, r) => s + r.payout, 0);
    venueRoi[v].roi = vInvest > 0 ? vPayout / vInvest * 100 : 0;
  }

  const raceNoRoi: StrategyStats["raceNoRoi"] = {};
  for (const r of results) {
    const k = String(r.race_no);
    if (!raceNoRoi[k]) raceNoRoi[k] = { n: 0, hits: 0, roi: 0 };
    raceNoRoi[k].n++;
    if (r.hit) raceNoRoi[k].hits++;
  }
  for (const k of Object.keys(raceNoRoi)) {
    const rr = results.filter(x => String(x.race_no) === k);
    const rInvest = rr.length * UNIT;
    const rPayout = rr.reduce((s, r) => s + r.payout, 0);
    raceNoRoi[k].roi = rInvest > 0 ? rPayout / rInvest * 100 : 0;
  }

  // 過学習警告
  const overfittingWarnings: string[] = [];
  if (n < MIN_N_FOR_JUDGE) overfittingWarnings.push(`n=${n} < ${MIN_N_FOR_JUDGE}: 判定保留`);
  if (hits < MIN_HITS_FOR_JUDGE) overfittingWarnings.push(`hits=${hits} < ${MIN_HITS_FOR_JUDGE}: 参考値扱い`);
  if (roi >= 100 && topNExcludeRoi < 100) {
    overfittingWarnings.push(`ROI ${roi.toFixed(1)}% は top${TOP_EXCLUDE_N}除外で ${topNExcludeRoi.toFixed(1)}% に低下: 高配当依存`);
  }
  if (maxPayout > 0 && payout > 0 && maxPayout / payout > 0.5) {
    overfittingWarnings.push(`単一raceが払戻の${(maxPayout / payout * 100).toFixed(0)}%を占める: 単発依存`);
  }
  if (zeroHitMonths.length > 0) {
    overfittingWarnings.push(`0hit月 (n≥5): ${zeroHitMonths.join(", ")}`);
  }

  return {
    name, combination, n, n_closing_odds: withOdds.length,
    hits, hitRate, invest, payout, roi, profit: payout - invest,
    avgClosingOdds, medClosingOdds, maxPayout,
    maxLosingStreak: maxLosingStreak(results),
    topNExcludeRoi, recent3mRoi, recent3mN,
    monthlyRoi, venueRoi, raceNoRoi, zeroHitMonths,
    dataInsufficient: n < MIN_N_FOR_JUDGE,
    overfittingWarnings,
    results,
  };
}

// switch候補の推奨判定 (baseline比較込み)
function judgeStrategy(s: StrategyStats, baselineRoi: number): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = [];
  if (s.n < MIN_N_FOR_JUDGE) {
    reasons.push(`n=${s.n} < ${MIN_N_FOR_JUDGE}`);
    return { verdict: "insufficient", reasons };
  }
  if (s.hits < MIN_HITS_FOR_JUDGE) {
    reasons.push(`hits=${s.hits} < ${MIN_HITS_FOR_JUDGE}: 参考値`);
    return { verdict: "insufficient", reasons };
  }
  if (s.roi <= baselineRoi) {
    reasons.push(`ROI ${s.roi.toFixed(1)}% ≤ baseline ${baselineRoi.toFixed(1)}%`);
    return { verdict: "reject", reasons };
  }
  if (s.zeroHitMonths.length >= 2) {
    reasons.push(`0hit月が${s.zeroHitMonths.length}つ (${s.zeroHitMonths.join(", ")}): 期間依存疑い`);
    return { verdict: "reject", reasons };
  }
  if (s.topNExcludeRoi < 100) {
    reasons.push(`baseline超えだが top${TOP_EXCLUDE_N}除外ROI ${s.topNExcludeRoi.toFixed(1)}% < 100%: 高配当依存`);
    return { verdict: "watch", reasons };
  }
  // promote 相当でも historical のみでは watch 止まり (future-only未確認)
  reasons.push(`ROI/top${TOP_EXCLUDE_N}除外とも良好だが historical closing odds のみ: future-only未確認のため watch 止まり`);
  return { verdict: "watch", reasons };
}

// ─── 戦略実行 ─────────────────────────────────────────────────────────────────

console.log("戦略計算中...");

const stratA = aggregateStats("A. baseline 6R 1-2-3", "1-2-3", calcStrategy(skip6RRaces, "1-2-3", "6R"));
const stratC = aggregateStats("C. 6R switch 1-3-2",   "1-3-2", calcStrategy(skip6RRaces, "1-3-2", "6R"));
const stratD = aggregateStats("D. 6R switch 1-2-4",   "1-2-4", calcStrategy(skip6RRaces, "1-2-4", "6R"));
const stratE = aggregateStats("E. 6R switch 1-4-2",   "1-4-2", calcStrategy(skip6RRaces, "1-4-2", "6R"));
const stratF = aggregateStats("F. 6R switch 1-3-4",   "1-3-4", calcStrategy(skip6RRaces, "1-3-4", "6R"));

// B. skip: 6R除外後の残存 (= 6R以外で1-2-3)
const stratB = aggregateStats("B. skip (6R除外後の残存)", "1-2-3", calcStrategy(non6RRaces, "1-2-3", "non-6R"));

// hybrid: 6R以外は1-2-3、6Rはswitch/skip
function calcHybrid(switchComb: string | null): StrategyStats {
  const name = switchComb ? `I/J. hybrid 1-2-3 + 6R ${switchComb}` : "H. hybrid 1-2-3 + 6R skip";
  const results: RaceResult[] = [];
  for (const r of allForwardRaces) {
    if (skip6RIdSet.has(r.race_id)) {
      if (switchComb === null) continue;
      results.push(...calcStrategy([r], switchComb, `6R_${switchComb}`));
    } else {
      results.push(...calcStrategy([r], "1-2-3", "non-6R"));
    }
  }
  return aggregateStats(name, switchComb ?? "skip", results);
}

const stratH = calcHybrid(null);
const stratI = calcHybrid("1-3-2");
const stratJ = calcHybrid("1-3-4");

const statAllFwd = aggregateStats("全forward baseline", "1-2-3", calcStrategy(allForwardRaces, "1-2-3", "all-forward"));

const switchStrategies = [stratC, stratD, stratE, stratF];
const strategies = [stratA, stratC, stratD, stratE, stratF, stratB, stratH, stratI, stratJ];

// 判定
const judged = switchStrategies.map(s => ({ s, j: judgeStrategy(s, stratA.roi) }));
const skipJudge = (() => {
  // skip判定: 残存ROI が全体baselineを上回るか
  const reasons: string[] = [];
  if (stratB.roi > statAllFwd.roi) {
    reasons.push(`残存ROI ${stratB.roi.toFixed(1)}% > 全体 ${statAllFwd.roi.toFixed(1)}%: 除外効果あり`);
    if (stratB.topNExcludeRoi < 100) {
      reasons.push(`ただし top${TOP_EXCLUDE_N}除外ROI ${stratB.topNExcludeRoi.toFixed(1)}% < 100%: 黒字化には未達`);
      return { verdict: "watch" as Verdict, reasons };
    }
    return { verdict: "watch" as Verdict, reasons };
  }
  reasons.push(`残存ROI ${stratB.roi.toFixed(1)}% ≤ 全体 ${statAllFwd.roi.toFixed(1)}%: 除外効果なし`);
  return { verdict: "reject" as Verdict, reasons };
})();

// ─── MD 出力 ──────────────────────────────────────────────────────────────────

function fmtRoi(v: number) { return v.toFixed(1) + "%"; }

const now = new Date().toISOString();
const lines: string[] = [];

lines.push(`# H004: skip6R switch historical closing odds 予備検証`);
lines.push(``);
lines.push(`生成日時: ${now}`);
lines.push(``);
lines.push(`> **⚠️ これは historical closing odds backtest です。live/T-5/T-10 forward ではありません。**`);
lines.push(`> **historical closing odds で良い結果が出ても app_settings / 本番 decision への反映は禁止。**`);
lines.push(`> **本採用には future-only odds_timeseries での再確認が必要です。**`);
lines.push(`> BUY は検証候補、ROI は検証指標。購入指示ではない。`);
lines.push(`> 事後最適化（best-of / 結果を見て最良買い目選択）は禁止。`);
lines.push(`> ROI だけで結論を出さない: n / hit数 / 最大連敗 / 月別・会場別安定性 込みで判定。`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 検証概要`);
lines.push(``);
lines.push(`| 項目 | 値 |`);
lines.push(`|---|---|`);
lines.push(`| 全 forward BUY race | ${allForwardRaces.length}件 |`);
lines.push(`| 6R (skip6R対象) | ${skip6RRaces.length}件 |`);
lines.push(`| 6R 以外 | ${non6RRaces.length}件 |`);
lines.push(`| 6R × condB 重複 | ${condB6ROverlap}件 (H001と独立でない点に注意) |`);
lines.push(`| 6R closing odds 保有率 | ${skip6RRaces.length > 0 ? (skip6RRaces.filter(r => closingOddsMap.has(r.race_id)).length / skip6RRaces.length * 100).toFixed(1) : "—"}% |`);
lines.push(`| 検証期間 | ${FORWARD_START} ～ |`);
lines.push(`| 単位投資 | ${UNIT}円 / 点 |`);
lines.push(`| top除外 N | ${TOP_EXCLUDE_N}件 |`);
lines.push(`| 直近3ヶ月基準 | ${THREE_MONTHS_AGO} 以降 |`);
lines.push(`| 判定最低 n | ${MIN_N_FOR_JUDGE} |`);
lines.push(`| 判定最低 hits | ${MIN_HITS_FOR_JUDGE} |`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 戦略比較サマリ`);
lines.push(``);
lines.push(`| 戦略 | n | hits | 的中率 | ROI | top2除外ROI | 最大連敗 | 直近3M ROI (n) | warnings |`);
lines.push(`|---|---:|---:|---:|---:|---:|---:|---:|---|`);
for (const s of strategies) {
  const r3m = s.recent3mN === 0 ? `— (n=0)` : `${fmtRoi(s.recent3mRoi)} (n=${s.recent3mN})`;
  const warn = s.overfittingWarnings.length > 0 ? `⚠️ ${s.overfittingWarnings.length}件` : "—";
  lines.push(`| ${s.name} | ${s.n} | ${s.hits} | ${(s.hitRate*100).toFixed(1)}% | ${fmtRoi(s.roi)} | ${fmtRoi(s.topNExcludeRoi)} | ${s.maxLosingStreak} | ${r3m} | ${warn} |`);
}
const allR3m = statAllFwd.recent3mN === 0 ? `— (n=0)` : `${fmtRoi(statAllFwd.recent3mRoi)} (n=${statAllFwd.recent3mN})`;
lines.push(`| **全forward baseline** | ${statAllFwd.n} | ${statAllFwd.hits} | ${(statAllFwd.hitRate*100).toFixed(1)}% | ${fmtRoi(statAllFwd.roi)} | ${fmtRoi(statAllFwd.topNExcludeRoi)} | ${statAllFwd.maxLosingStreak} | ${allR3m} | — |`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 推奨判定`);
lines.push(``);
lines.push(`| 候補 | 判定 | 理由 |`);
lines.push(`|---|---|---|`);
lines.push(`| B. 6R skip (除外) | **${skipJudge.verdict}** | ${skipJudge.reasons.join(" / ")} |`);
for (const { s, j } of judged) {
  lines.push(`| ${s.name} | **${j.verdict}** | ${j.reasons.join(" / ")} |`);
}
lines.push(``);
lines.push(`> 判定基準: promote=forward実証済みで強い / watch=有望だがn不足またはfuture-only未確認 / reject=baseline以下か期間依存 / insufficient=n<${MIN_N_FOR_JUDGE} or hits<${MIN_HITS_FOR_JUDGE}`);
lines.push(`> historical closing odds backtest のみでは **promote には到達しない** (future-only確認が必須)。`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 各戦略 詳細`);
lines.push(``);

for (const s of strategies) {
  lines.push(`### ${s.name}`);
  lines.push(``);
  lines.push(`| 項目 | 値 |`);
  lines.push(`|---|---|`);
  lines.push(`| n | ${s.n} |`);
  lines.push(`| closing odds あり | ${s.n_closing_odds} |`);
  lines.push(`| hits | ${s.hits} |`);
  lines.push(`| 的中率 | ${(s.hitRate*100).toFixed(2)}% |`);
  lines.push(`| 投資額 | ${s.invest}円 |`);
  lines.push(`| 払戻額 | ${s.payout.toFixed(0)}円 |`);
  lines.push(`| ROI | **${fmtRoi(s.roi)}** |`);
  lines.push(`| profit | ${s.profit.toFixed(0)}円 |`);
  lines.push(`| avg closing odds | ${s.avgClosingOdds !== null ? s.avgClosingOdds.toFixed(2) : "—"} |`);
  lines.push(`| median closing odds | ${s.medClosingOdds !== null ? s.medClosingOdds.toFixed(2) : "—"} |`);
  lines.push(`| max payout | ${s.maxPayout.toFixed(0)}円 |`);
  lines.push(`| 最大連敗 | ${s.maxLosingStreak} |`);
  lines.push(`| top${TOP_EXCLUDE_N}除外 ROI | **${fmtRoi(s.topNExcludeRoi)}** |`);
  const r3m = s.recent3mN === 0 ? `— (n=0: ${THREE_MONTHS_AGO}以降に対象なし)` : `${fmtRoi(s.recent3mRoi)} (n=${s.recent3mN})`;
  lines.push(`| 直近3ヶ月 ROI | ${r3m} |`);
  lines.push(`| data-insufficient | ${s.dataInsufficient ? `⚠️ n<${MIN_N_FOR_JUDGE}` : "—"} |`);
  lines.push(``);
  if (s.overfittingWarnings.length > 0) {
    lines.push(`**⚠️ overfitting warnings:**`);
    lines.push(``);
    for (const w of s.overfittingWarnings) lines.push(`- ${w}`);
    lines.push(``);
  }

  // 月別 ROI
  lines.push(`**月別 ROI**`);
  lines.push(``);
  lines.push(`| 月 | n | hits | ROI |`);
  lines.push(`|---|---:|---:|---:|`);
  for (const m of Object.keys(s.monthlyRoi).sort()) {
    const mo = s.monthlyRoi[m];
    lines.push(`| ${m} | ${mo.n} | ${mo.hits} | ${fmtRoi(mo.roi)} |`);
  }
  lines.push(``);

  // 会場別 ROI（n>=3のみ）
  const venues = Object.entries(s.venueRoi)
    .filter(([, v]) => v.n >= 3)
    .sort((a, b) => b[1].roi - a[1].roi);
  if (venues.length > 0) {
    lines.push(`**会場別 ROI（n≥3）**`);
    lines.push(``);
    lines.push(`| 会場 | n | hits | ROI |`);
    lines.push(`|---|---:|---:|---:|`);
    for (const [v, vr] of venues) {
      lines.push(`| ${v} | ${vr.n} | ${vr.hits} | ${fmtRoi(vr.roi)} |`);
    }
    lines.push(``);
  }

  // raceNo別 (hybrid系のみ意味がある)
  const raceNos = Object.keys(s.raceNoRoi);
  if (raceNos.length > 1) {
    lines.push(`**raceNo別 ROI**`);
    lines.push(``);
    lines.push(`| R | n | hits | ROI |`);
    lines.push(`|---|---:|---:|---:|`);
    for (const k of raceNos.sort((a, b) => Number(a) - Number(b))) {
      const rr = s.raceNoRoi[k];
      lines.push(`| ${k} | ${rr.n} | ${rr.hits} | ${fmtRoi(rr.roi)} |`);
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(``);
}

// ─── 注記 ─────────────────────────────────────────────────────────────────────

lines.push(`## 注記`);
lines.push(``);
lines.push(`- **これは historical closing odds backtest であり live/T-5 forward ではない**`);
lines.push(`- historical closing odds で良い結果が出ても **本採用は不可**`);
lines.push(`- 6R × condB 重複が ${condB6ROverlap}件 ある: H001 (condB switch) と独立な検証ではない`);
lines.push(`- 本採用には future-only odds_timeseries での再確認が必要`);
lines.push(`- ROI だけで結論を出さない: hit<${MIN_HITS_FOR_JUDGE} は参考値、n<${MIN_N_FOR_JUDGE} は insufficient`);
lines.push(`- 月別・会場別で崩れる条件は reject 寄りに判定`);
lines.push(`- payout_yen は検証結果として参照するが、運用条件には使わない`);
lines.push(`- 自動投票・購入推奨ではない`);
lines.push(``);
lines.push(`---`);
lines.push(`*生成: analyze-skip6r-switch-historical-closing-odds.ts*`);

const md = lines.join("\n");
if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");

// ─── JSON 出力 ────────────────────────────────────────────────────────────────

function statsToJson(s: StrategyStats) {
  return {
    name: s.name,
    combination: s.combination,
    n: s.n,
    n_closing_odds: s.n_closing_odds,
    hits: s.hits,
    hitRate: Math.round(s.hitRate * 10000) / 100,
    invest: s.invest,
    payout: Math.round(s.payout),
    roi: Math.round(s.roi * 100) / 100,
    profit: Math.round(s.profit),
    avgClosingOdds: s.avgClosingOdds !== null ? Math.round(s.avgClosingOdds * 100) / 100 : null,
    medClosingOdds: s.medClosingOdds,
    maxPayout: Math.round(s.maxPayout),
    maxLosingStreak: s.maxLosingStreak,
    topNExcludeRoi: Math.round(s.topNExcludeRoi * 100) / 100,
    recent3mRoi: Math.round(s.recent3mRoi * 100) / 100,
    recent3mN: s.recent3mN,
    zeroHitMonths: s.zeroHitMonths,
    dataInsufficient: s.dataInsufficient,
    overfittingWarnings: s.overfittingWarnings,
    monthlyRoi: Object.fromEntries(
      Object.entries(s.monthlyRoi).sort().map(([m, mo]) => [m, { n: mo.n, hits: mo.hits, roi: Math.round(mo.roi * 100) / 100 }])
    ),
    venueRoi: Object.fromEntries(
      Object.entries(s.venueRoi).map(([v, vr]) => [v, { n: vr.n, hits: vr.hits, roi: Math.round(vr.roi * 100) / 100 }])
    ),
  };
}

const jsonOutput = {
  generatedAt: now,
  meta: {
    description: "H004: skip6R historical closing odds switch/skip 予備検証",
    warningNotForward: "これはhistorical closing odds backtestです。live/T-5/T-10 forwardではありません",
    warningNoAdoption: "historical closing oddsで良くても本採用不可。future-only odds_timeseriesで再確認必要",
    forwardStart: FORWARD_START,
    unit: UNIT,
    topExcludeN: TOP_EXCLUDE_N,
    minNForJudge: MIN_N_FOR_JUDGE,
    minHitsForJudge: MIN_HITS_FOR_JUDGE,
  },
  overview: {
    allForwardRaces: allForwardRaces.length,
    skip6RRaces: skip6RRaces.length,
    non6RRaces: non6RRaces.length,
    condB6ROverlap,
    closingOddsCoveragePct: skip6RRaces.length > 0
      ? Math.round(skip6RRaces.filter(r => closingOddsMap.has(r.race_id)).length / skip6RRaces.length * 1000) / 10 : 0,
  },
  strategies: strategies.map(statsToJson),
  allForwardBaseline: statsToJson(statAllFwd),
  verdicts: {
    skip: { verdict: skipJudge.verdict, reasons: skipJudge.reasons },
    switches: judged.map(({ s, j }) => ({ name: s.name, combination: s.combination, verdict: j.verdict, reasons: j.reasons })),
    historicalAdoptionAllowed: false,
    futureTimeseriesRequired: true,
  },
};
writeFileSync(OUT_JSON, JSON.stringify(jsonOutput, null, 2), "utf-8");

console.log("\n=== H004 結果サマリ ===");
console.log(`  6R n=${skip6RRaces.length} / condB重複=${condB6ROverlap}`);
for (const s of strategies) {
  console.log(`  ${s.name}: ROI=${fmtRoi(s.roi)} / top2除外=${fmtRoi(s.topNExcludeRoi)} / 最大連敗=${s.maxLosingStreak} / hits=${s.hits}`);
}
console.log(`  全forward baseline: ROI=${fmtRoi(statAllFwd.roi)} / top2除外=${fmtRoi(statAllFwd.topNExcludeRoi)}`);
console.log(`\n=== 推奨判定 ===`);
console.log(`  6R skip: ${skipJudge.verdict} (${skipJudge.reasons[0]})`);
for (const { s, j } of judged) {
  console.log(`  ${s.combination}: ${j.verdict} (${j.reasons[0]})`);
}
console.log();
console.log(`出力: ${OUT_MD}`);
console.log(`出力: ${OUT_JSON}`);
