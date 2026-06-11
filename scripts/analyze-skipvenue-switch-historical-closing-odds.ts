/**
 * analyze-skipvenue-switch-historical-closing-odds.ts — 読み取り専用
 *
 * 禁止: 既存DBへのINSERT/UPDATE/DELETE/DROP, app_settings変更, 本番decision変更
 * 禁止: 自動投票・ログイン保存・投票サイト操作
 * BUY は検証候補、ROI は検証指標であり購入推奨ではない。
 *
 * 目的: H006 — skipVenue (浜名湖・住之江) において historical closing odds を使った
 *   skip / switch 予備検証を行う。
 *
 * ⚠️ 最重要チェック:
 *   skipVenue が弱いのは venue 自体の問題か、それとも skip6R (6R弱さ) との
 *   重複で弱く見えているだけか — を分離する。
 *   - C. 6R重複を除いた venue 単独効果
 *   - D. 6R重複分のみの効果
 *
 * ⚠️ 重要な注意:
 *   - これは historical closing odds backtest であり、live/T-5/T-10 forward ではない
 *   - historical closing odds で良い結果が出ても app_settings/本番decision への反映は禁止
 *   - 本採用には future-only odds_timeseries での再確認が必要
 *   - 事後最適化 (best-of / 結果を見て最良買い目選択) は禁止
 *   - ROI だけで結論を出さない: n / hit数 / 最大連敗 / 月別・会場別安定性 込みで判定
 *
 * 比較対象:
 *   baseline:        skipVenue対象 (浜名湖+住之江) で 1-2-3 を買う (現行)
 *   A. skip:         skipVenue を全て見送る (残存 = 対象venue以外の1-2-3)
 *   B. switch:       venue別に 1-3-2 / 1-2-4 / 1-4-2 / 1-3-4 へ switch
 *   C. venue単独:    skip6R重複を除いた venue 1-2-3 (venue自体の弱さ)
 *   D. 6R重複のみ:   skipVenue ∩ 6R の 1-2-3 (6R弱さの寄与)
 *   E. venue×raceNo: raceNo別分解
 *   F. venue×month:  月別安定性
 *   G. condB重複:    condB との重複件数・影響
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/skipvenue-switch-historical-closing-odds.md";
const OUT_JSON = "reports/skipvenue-switch-historical-closing-odds.json";

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

const FORWARD_START = "2025-01-01";
const EXCL_VENUES   = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES    = [10, 11, 12];
const SKIP_VENUES   = ["浜名湖", "住之江"];
const UNIT          = 100;
const TOP_EXCLUDE_N = 2;
const MIN_N_FOR_JUDGE = 30;
const MIN_HITS_FOR_JUDGE = 3;
const SWITCH_COMBOS = ["1-3-2", "1-2-4", "1-4-2", "1-3-4"] as const;

const excl_v = EXCL_VENUES.map(v => `'${v}'`).join(",");
const excl_r = EXCL_RACES.join(",");
const skip_v = SKIP_VENUES.map(v => `'${v}'`).join(",");

// ─── 対象レース（BUY forward baseline） ───────────────────────────────────────

type Race = { race_id: string; date: string; venue: string; race_no: number; current_odds: number };

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

const skipVenueRaces  = allForwardRaces.filter(r => SKIP_VENUES.includes(r.venue));
const nonVenueRaces   = allForwardRaces.filter(r => !SKIP_VENUES.includes(r.venue));
const venueNon6R      = skipVenueRaces.filter(r => r.race_no !== 6);
const venue6ROverlap  = skipVenueRaces.filter(r => r.race_no === 6);
const skipVenueIdSet  = new Set(skipVenueRaces.map(r => r.race_id));

console.log(`全 forward BUY race: ${allForwardRaces.length}件 / skipVenue: ${skipVenueRaces.length}件 (6R重複 ${venue6ROverlap.length}件 / 6R以外 ${venueNon6R.length}件)`);

// ─── condB との重複 ───────────────────────────────────────────────────────────

const WIND24 = `EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id
  AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)`;
const EXH1   = `EXISTS (SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=1
    AND ed.exhibition_time IS NOT NULL
    AND ed.exhibition_time = (SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2
      WHERE ed2.race_id=dh.race_id))`;

const condBVenueOverlap = (db.prepare(`
  SELECT COUNT(DISTINCT dh.race_id) n
  FROM decision_history dh
  WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
    AND dh.result IS NOT NULL AND dh.result != ''
    AND dh.current_odds IS NOT NULL
    AND dh.venue NOT IN (${excl_v})
    AND dh.race_no NOT IN (${excl_r})
    AND dh.selection='1-2-3'
    AND dh.date >= '${FORWARD_START}'
    AND dh.venue IN (${skip_v})
    AND ${WIND24} AND ${EXH1}
`).get() as { n: number }).n;

// ─── historical closing odds / 払戻 取得 ─────────────────────────────────────

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

// ─── 戦略計算 ─────────────────────────────────────────────────────────────────

const THREE_MONTHS_AGO = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString().slice(0, 10);
})();

function ym(date: string) { return date.slice(0, 7); }

type RaceResult = {
  race_id: string; date: string; venue: string; race_no: number;
  bet_combination: string; invest: number; payout: number; profit: number;
  closing_odds: number | null; hit: boolean; notes: string;
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
  name: string; combination: string;
  n: number; n_closing_odds: number; hits: number; hitRate: number;
  invest: number; payout: number; roi: number; profit: number;
  avgClosingOdds: number | null; medClosingOdds: number | null;
  maxPayout: number; maxLosingStreak: number;
  topNExcludeRoi: number; recent3mRoi: number; recent3mN: number;
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
  reasons.push(`ROI/top${TOP_EXCLUDE_N}除外とも良好だが historical closing odds のみ: future-only未確認のため watch 止まり`);
  return { verdict: "watch", reasons };
}

// ─── 戦略実行 ─────────────────────────────────────────────────────────────────

console.log("戦略計算中...");

// baseline と分離分析
const statBase      = aggregateStats("baseline skipVenue 1-2-3",         "1-2-3", calcStrategy(skipVenueRaces, "1-2-3", "skipVenue"));
const statVenueNon6R = aggregateStats("C. venue単独 (6R重複除外) 1-2-3",  "1-2-3", calcStrategy(venueNon6R, "1-2-3", "venue-non6R"));
const statVenue6R   = aggregateStats("D. 6R重複のみ 1-2-3",               "1-2-3", calcStrategy(venue6ROverlap, "1-2-3", "venue-6R"));
const statSkipRem   = aggregateStats("A. skip (venue除外後の残存)",       "1-2-3", calcStrategy(nonVenueRaces, "1-2-3", "non-venue"));
const statAllFwd    = aggregateStats("全forward baseline",                "1-2-3", calcStrategy(allForwardRaces, "1-2-3", "all-forward"));

// B. switch: 全skipVenue + venue別 (浜名湖のみ / 住之江のみ)
const hamanako = skipVenueRaces.filter(r => r.venue === "浜名湖");
const suminoe  = skipVenueRaces.filter(r => r.venue === "住之江");

type SwitchSet = { label: string; races: Race[]; baseline: StrategyStats };
const switchSets: SwitchSet[] = [
  { label: "skipVenue全体", races: skipVenueRaces, baseline: statBase },
  { label: "浜名湖のみ",    races: hamanako, baseline: aggregateStats("浜名湖 1-2-3", "1-2-3", calcStrategy(hamanako, "1-2-3", "hamanako")) },
  { label: "住之江のみ",    races: suminoe,  baseline: aggregateStats("住之江 1-2-3", "1-2-3", calcStrategy(suminoe, "1-2-3", "suminoe")) },
  { label: "venue単独(6R除外)", races: venueNon6R, baseline: statVenueNon6R },
];

const switchResults: Array<{ set: string; combo: string; stats: StrategyStats; judge: { verdict: Verdict; reasons: string[] } }> = [];
for (const set of switchSets) {
  for (const combo of SWITCH_COMBOS) {
    const stats = aggregateStats(`${set.label} switch ${combo}`, combo, calcStrategy(set.races, combo, set.label));
    switchResults.push({ set: set.label, combo, stats, judge: judgeStrategy(stats, set.baseline.roi) });
  }
}

// skip 判定
const skipJudge = (() => {
  const reasons: string[] = [];
  if (statSkipRem.roi > statAllFwd.roi) {
    reasons.push(`残存ROI ${statSkipRem.roi.toFixed(1)}% > 全体 ${statAllFwd.roi.toFixed(1)}%: 除外効果あり`);
    if (statSkipRem.topNExcludeRoi < 100) {
      reasons.push(`ただし top${TOP_EXCLUDE_N}除外ROI ${statSkipRem.topNExcludeRoi.toFixed(1)}% < 100%: 黒字化には未達`);
    }
    return { verdict: "watch" as Verdict, reasons };
  }
  reasons.push(`残存ROI ${statSkipRem.roi.toFixed(1)}% ≤ 全体 ${statAllFwd.roi.toFixed(1)}%: 除外効果なし`);
  return { verdict: "reject" as Verdict, reasons };
})();

// 分離判定: venue自体の弱さ vs 6R重複の見かけ
const separation = (() => {
  const venueOwn = statVenueNon6R.roi;
  const all = statAllFwd.roi;
  const lines: string[] = [];
  let conclusion = "";
  lines.push(`venue単独 (6R除外) ROI=${venueOwn.toFixed(1)}% / 6R重複のみ ROI=${statVenue6R.roi.toFixed(1)}% / 全体baseline=${all.toFixed(1)}%`);
  if (venueOwn >= all) {
    conclusion = "venue除外は不要かも: 6R重複を除くと venue は全体baseline以上。venueの弱さは主に6R由来";
  } else if (venueOwn >= all - 10) {
    conclusion = "venue単独の弱さは小さい: 6R重複除外後は全体baseline-10pt以内。venue除外の優先度は低い";
  } else {
    conclusion = "venue自体が弱い: 6R重複を除いても全体baselineを10pt以上下回る。venue除外候補として有力";
  }
  return { lines, conclusion, venueOwnRoi: venueOwn, venue6RRoi: statVenue6R.roi, allRoi: all };
})();

// ─── MD 出力 ──────────────────────────────────────────────────────────────────

function fmtRoi(v: number) { return v.toFixed(1) + "%"; }

const now = new Date().toISOString();
const lines: string[] = [];

lines.push(`# H006: skipVenue (浜名湖+住之江) switch historical closing odds 予備検証`);
lines.push(``);
lines.push(`生成日時: ${now}`);
lines.push(``);
lines.push(`> **⚠️ これは historical closing odds backtest です。live/T-5/T-10 forward ではありません。**`);
lines.push(`> **historical closing odds で良い結果が出ても app_settings / 本番 decision への反映は禁止。**`);
lines.push(`> **本採用には future-only odds_timeseries での再確認が必要です。**`);
lines.push(`> BUY は検証候補、ROI は検証指標。購入指示ではない。`);
lines.push(`> 事後最適化（best-of / 結果を見て最良買い目選択）は禁止。`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 検証概要`);
lines.push(``);
lines.push(`| 項目 | 値 |`);
lines.push(`|---|---|`);
lines.push(`| 全 forward BUY race | ${allForwardRaces.length}件 |`);
lines.push(`| skipVenue (浜名湖+住之江) | ${skipVenueRaces.length}件 |`);
lines.push(`| 浜名湖 | ${hamanako.length}件 |`);
lines.push(`| 住之江 | ${suminoe.length}件 |`);
lines.push(`| skipVenue ∩ 6R 重複 | ${venue6ROverlap.length}件 |`);
lines.push(`| skipVenue − 6R (venue単独) | ${venueNon6R.length}件 |`);
lines.push(`| skipVenue ∩ condB 重複 | ${condBVenueOverlap}件 |`);
lines.push(`| closing odds 保有率 | ${skipVenueRaces.length > 0 ? (skipVenueRaces.filter(r => closingOddsMap.has(r.race_id)).length / skipVenueRaces.length * 100).toFixed(1) : "—"}% |`);
lines.push(`| 検証期間 | ${FORWARD_START} ～ |`);
lines.push(`| 単位投資 | ${UNIT}円 / 点 |`);
lines.push(`| top除外 N | ${TOP_EXCLUDE_N}件 |`);
lines.push(`| 判定最低 n / hits | ${MIN_N_FOR_JUDGE} / ${MIN_HITS_FOR_JUDGE} |`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## ⚠️ 最重要: venue弱さ vs 6R重複の分離`);
lines.push(``);
lines.push(`| 区分 | n | hits | ROI | top2除外ROI | 最大連敗 |`);
lines.push(`|---|---:|---:|---:|---:|---:|`);
lines.push(`| baseline skipVenue 全体 | ${statBase.n} | ${statBase.hits} | ${fmtRoi(statBase.roi)} | ${fmtRoi(statBase.topNExcludeRoi)} | ${statBase.maxLosingStreak} |`);
lines.push(`| C. venue単独 (6R重複除外) | ${statVenueNon6R.n} | ${statVenueNon6R.hits} | ${fmtRoi(statVenueNon6R.roi)} | ${fmtRoi(statVenueNon6R.topNExcludeRoi)} | ${statVenueNon6R.maxLosingStreak} |`);
lines.push(`| D. 6R重複のみ | ${statVenue6R.n} | ${statVenue6R.hits} | ${fmtRoi(statVenue6R.roi)} | ${fmtRoi(statVenue6R.topNExcludeRoi)} | ${statVenue6R.maxLosingStreak} |`);
lines.push(`| 全forward baseline (参考) | ${statAllFwd.n} | ${statAllFwd.hits} | ${fmtRoi(statAllFwd.roi)} | ${fmtRoi(statAllFwd.topNExcludeRoi)} | ${statAllFwd.maxLosingStreak} |`);
lines.push(``);
lines.push(`**分離判定: ${separation.conclusion}**`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## skip (venue除外) 効果`);
lines.push(``);
lines.push(`| 区分 | n | hits | ROI | top2除外ROI |`);
lines.push(`|---|---:|---:|---:|---:|`);
lines.push(`| A. skip 残存 (venue除外後) | ${statSkipRem.n} | ${statSkipRem.hits} | ${fmtRoi(statSkipRem.roi)} | ${fmtRoi(statSkipRem.topNExcludeRoi)} |`);
lines.push(`| 全forward baseline | ${statAllFwd.n} | ${statAllFwd.hits} | ${fmtRoi(statAllFwd.roi)} | ${fmtRoi(statAllFwd.topNExcludeRoi)} |`);
lines.push(``);
lines.push(`**skip判定: ${skipJudge.verdict}** — ${skipJudge.reasons.join(" / ")}`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## switch 比較 (B)`);
lines.push(``);
lines.push(`| 対象 | 買い目 | n | hits | ROI | top2除外 | 最大連敗 | 判定 | 理由 |`);
lines.push(`|---|---|---:|---:|---:|---:|---:|---|---|`);
for (const sr of switchResults) {
  lines.push(`| ${sr.set} | ${sr.combo} | ${sr.stats.n} | ${sr.stats.hits} | ${fmtRoi(sr.stats.roi)} | ${fmtRoi(sr.stats.topNExcludeRoi)} | ${sr.stats.maxLosingStreak} | **${sr.judge.verdict}** | ${sr.judge.reasons[0]} |`);
}
lines.push(``);
lines.push(`> 各セットの baseline: skipVenue全体=${fmtRoi(statBase.roi)} / 浜名湖=${fmtRoi(switchSets[1].baseline.roi)} / 住之江=${fmtRoi(switchSets[2].baseline.roi)} / venue単独(6R除外)=${fmtRoi(statVenueNon6R.roi)}`);
lines.push(``);
lines.push(`---`);
lines.push(``);

// E. venue × raceNo
lines.push(`## E. venue × raceNo 分解 (baseline 1-2-3)`);
lines.push(``);
for (const [label, races] of [["浜名湖", hamanako], ["住之江", suminoe]] as const) {
  const st = aggregateStats(`${label} 1-2-3`, "1-2-3", calcStrategy(races, "1-2-3", label));
  lines.push(`### ${label} (n=${st.n}, ROI=${fmtRoi(st.roi)})`);
  lines.push(``);
  lines.push(`| R | n | hits | ROI |`);
  lines.push(`|---|---:|---:|---:|`);
  for (const k of Object.keys(st.raceNoRoi).sort((a, b) => Number(a) - Number(b))) {
    const rr = st.raceNoRoi[k];
    lines.push(`| ${k} | ${rr.n} | ${rr.hits} | ${fmtRoi(rr.roi)} |`);
  }
  lines.push(``);
}
lines.push(`---`);
lines.push(``);

// F. month 安定性
lines.push(`## F. 月別安定性 (baseline skipVenue 1-2-3)`);
lines.push(``);
lines.push(`| 月 | n | hits | ROI |`);
lines.push(`|---|---:|---:|---:|`);
for (const m of Object.keys(statBase.monthlyRoi).sort()) {
  const mo = statBase.monthlyRoi[m];
  lines.push(`| ${m} | ${mo.n} | ${mo.hits} | ${fmtRoi(mo.roi)} |`);
}
lines.push(``);
if (statBase.zeroHitMonths.length > 0) {
  lines.push(`⚠️ 0hit月 (n≥5): ${statBase.zeroHitMonths.join(", ")}`);
  lines.push(``);
}
lines.push(`---`);
lines.push(``);

// G. condB 重複
lines.push(`## G. condB との重複`);
lines.push(``);
lines.push(`- skipVenue ∩ condB 重複: **${condBVenueOverlap}件** (skipVenue ${skipVenueRaces.length}件中)`);
lines.push(`- H001 (condB switch) との独立性: 重複が小さければ独立性高い`);
lines.push(``);
lines.push(`---`);
lines.push(``);

// 詳細 (主要セットのみ)
lines.push(`## 主要セット詳細`);
lines.push(``);
for (const s of [statBase, statVenueNon6R, statVenue6R, statSkipRem]) {
  lines.push(`### ${s.name}`);
  lines.push(``);
  lines.push(`| 項目 | 値 |`);
  lines.push(`|---|---|`);
  lines.push(`| n / closing oddsあり | ${s.n} / ${s.n_closing_odds} |`);
  lines.push(`| hits / 的中率 | ${s.hits} / ${(s.hitRate*100).toFixed(2)}% |`);
  lines.push(`| 投資 / 払戻 / ROI | ${s.invest}円 / ${s.payout.toFixed(0)}円 / **${fmtRoi(s.roi)}** |`);
  lines.push(`| avg / median closing odds | ${s.avgClosingOdds !== null ? s.avgClosingOdds.toFixed(2) : "—"} / ${s.medClosingOdds !== null ? s.medClosingOdds.toFixed(2) : "—"} |`);
  lines.push(`| max payout / 最大連敗 | ${s.maxPayout.toFixed(0)}円 / ${s.maxLosingStreak} |`);
  lines.push(`| top${TOP_EXCLUDE_N}除外 ROI | **${fmtRoi(s.topNExcludeRoi)}** |`);
  const r3m = s.recent3mN === 0 ? `— (n=0)` : `${fmtRoi(s.recent3mRoi)} (n=${s.recent3mN})`;
  lines.push(`| 直近3ヶ月 ROI | ${r3m} |`);
  lines.push(``);
  if (s.overfittingWarnings.length > 0) {
    lines.push(`**⚠️ warnings:** ${s.overfittingWarnings.join(" / ")}`);
    lines.push(``);
  }
}
lines.push(`---`);
lines.push(``);

lines.push(`## 注記`);
lines.push(``);
lines.push(`- **これは historical closing odds backtest であり live/T-5 forward ではない**`);
lines.push(`- historical closing odds で良い結果が出ても **本採用は不可**`);
lines.push(`- skipVenue ∩ 6R = ${venue6ROverlap.length}件、∩ condB = ${condBVenueOverlap}件: H003/H004/H001 と独立な検証ではない`);
lines.push(`- 本採用には future-only odds_timeseries での再確認が必要`);
lines.push(`- ROI だけで結論を出さない: hit<${MIN_HITS_FOR_JUDGE} は参考値、n<${MIN_N_FOR_JUDGE} は insufficient`);
lines.push(`- 月別0hitが多い条件・高配当1発依存は reject 寄り`);
lines.push(`- payout_yen は検証結果として参照するが、運用条件には使わない`);
lines.push(`- 自動投票・購入推奨ではない`);
lines.push(``);
lines.push(`---`);
lines.push(`*生成: analyze-skipvenue-switch-historical-closing-odds.ts*`);

const md = lines.join("\n");
if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");

// ─── JSON 出力 ────────────────────────────────────────────────────────────────

function statsToJson(s: StrategyStats) {
  return {
    name: s.name, combination: s.combination,
    n: s.n, n_closing_odds: s.n_closing_odds, hits: s.hits,
    hitRate: Math.round(s.hitRate * 10000) / 100,
    invest: s.invest, payout: Math.round(s.payout),
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
    raceNoRoi: Object.fromEntries(
      Object.entries(s.raceNoRoi).map(([k, rr]) => [k, { n: rr.n, hits: rr.hits, roi: Math.round(rr.roi * 100) / 100 }])
    ),
  };
}

const jsonOutput = {
  generatedAt: now,
  meta: {
    description: "H006: skipVenue (浜名湖+住之江) historical closing odds switch/skip 予備検証",
    warningNotForward: "これはhistorical closing odds backtestです。live/T-5/T-10 forwardではありません",
    warningNoAdoption: "historical closing oddsで良くても本採用不可。future-only odds_timeseriesで再確認必要",
    forwardStart: FORWARD_START,
    skipVenues: SKIP_VENUES,
    unit: UNIT,
    topExcludeN: TOP_EXCLUDE_N,
    minNForJudge: MIN_N_FOR_JUDGE,
    minHitsForJudge: MIN_HITS_FOR_JUDGE,
  },
  overview: {
    allForwardRaces: allForwardRaces.length,
    skipVenueRaces: skipVenueRaces.length,
    hamanako: hamanako.length,
    suminoe: suminoe.length,
    venue6ROverlap: venue6ROverlap.length,
    venueNon6R: venueNon6R.length,
    condBVenueOverlap,
    closingOddsCoveragePct: skipVenueRaces.length > 0
      ? Math.round(skipVenueRaces.filter(r => closingOddsMap.has(r.race_id)).length / skipVenueRaces.length * 1000) / 10 : 0,
  },
  baseline: statsToJson(statBase),
  venueNon6R: statsToJson(statVenueNon6R),
  venue6ROnly: statsToJson(statVenue6R),
  skipRemaining: statsToJson(statSkipRem),
  allForwardBaseline: statsToJson(statAllFwd),
  switches: switchResults.map(sr => ({
    set: sr.set, combo: sr.combo,
    stats: statsToJson(sr.stats),
    verdict: sr.judge.verdict,
    reasons: sr.judge.reasons,
  })),
  verdicts: {
    skip: { verdict: skipJudge.verdict, reasons: skipJudge.reasons },
    separation: {
      conclusion: separation.conclusion,
      venueOwnRoi: Math.round(separation.venueOwnRoi * 100) / 100,
      venue6RRoi: Math.round(separation.venue6RRoi * 100) / 100,
      allForwardRoi: Math.round(separation.allRoi * 100) / 100,
    },
    historicalAdoptionAllowed: false,
    futureTimeseriesRequired: true,
  },
};
writeFileSync(OUT_JSON, JSON.stringify(jsonOutput, null, 2), "utf-8");

console.log("\n=== H006 結果サマリ ===");
console.log(`  skipVenue n=${skipVenueRaces.length} (浜名湖${hamanako.length} + 住之江${suminoe.length}) / 6R重複=${venue6ROverlap.length} / condB重複=${condBVenueOverlap}`);
console.log(`  baseline skipVenue 1-2-3: ROI=${fmtRoi(statBase.roi)} / top2除外=${fmtRoi(statBase.topNExcludeRoi)}`);
console.log(`  C. venue単独 (6R除外): ROI=${fmtRoi(statVenueNon6R.roi)} / top2除外=${fmtRoi(statVenueNon6R.topNExcludeRoi)}`);
console.log(`  D. 6R重複のみ: ROI=${fmtRoi(statVenue6R.roi)} (n=${statVenue6R.n})`);
console.log(`  A. skip残存: ROI=${fmtRoi(statSkipRem.roi)} vs 全体 ${fmtRoi(statAllFwd.roi)}`);
console.log(`\n=== 分離判定 ===`);
console.log(`  ${separation.conclusion}`);
console.log(`\n=== skip判定: ${skipJudge.verdict} ===`);
for (const r of skipJudge.reasons) console.log(`  ${r}`);
console.log(`\n=== switch判定 (上位のみ) ===`);
for (const sr of switchResults.filter(x => x.set === "skipVenue全体" || x.set === "venue単独(6R除外)")) {
  console.log(`  ${sr.set} ${sr.combo}: ROI=${fmtRoi(sr.stats.roi)} → ${sr.judge.verdict} (${sr.judge.reasons[0]})`);
}
console.log();
console.log(`出力: ${OUT_MD}`);
console.log(`出力: ${OUT_JSON}`);
