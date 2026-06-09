/**
 * analyze-condb-switch-historical-closing-odds.ts
 *
 * 禁止: 既存DBへのINSERT/UPDATE/DELETE/DROP, app_settings変更, 本番decision変更
 * 禁止: 自動投票・ログイン保存・投票サイト操作
 * BUY は検証候補、ROI は検証指標であり購入推奨ではない。
 *
 * 目的: condB (風速2〜4 × 1号艇展示1位) において、
 *   historical closing odds を使った switch 予備検証を行う。
 *
 * ⚠️ 重要な注意:
 *   - これは historical closing odds backtest であり、live/T-5/T-10 forward ではない
 *   - historical closing odds で良い結果が出ても app_settings/本番decision への反映は禁止
 *   - 本採用には future-only odds_timeseries での再確認が必要
 *   - 事後最適化 (best-of / 結果を見て最良買い目選択) は禁止
 *
 * 比較戦略:
 *   A. baseline:   condB で 1-2-3 を買う (現行)
 *   B. skip:       condB を全て見送る
 *   C. switch 1-3-2
 *   D. switch 1-2-4
 *   E. switch 1-4-2
 *   F. switch 1-3-4
 *   H. hybrid skip:    condB以外は1-2-3, condBはskip
 *   I. hybrid 1-3-2:   condB以外は1-2-3, condBは1-3-2にswitch
 *   J. hybrid 1-3-4:   condB以外は1-2-3, condBは1-3-4にswitch
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/condb-switch-historical-closing-odds.md";
const OUT_JSON = "reports/condb-switch-historical-closing-odds.json";

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

const FORWARD_START = "2025-01-01";
const EXCL_VENUES   = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES    = [10, 11, 12];
const UNIT          = 100; // 1点 100円
const TOP_EXCLUDE_N = 2;

// ─── condB 対象レース（BUY forward baseline） ─────────────────────────────────

type CondBRace = {
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  current_odds: number;
};

const excl_v = EXCL_VENUES.map(v => `'${v}'`).join(",");
const excl_r = EXCL_RACES.join(",");

const WIND24 = `EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id
  AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)`;
const EXH1   = `EXISTS (SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=1
    AND ed.exhibition_time IS NOT NULL
    AND ed.exhibition_time = (SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2
      WHERE ed2.race_id=dh.race_id))`;

const condBRaces = db.prepare(`
  SELECT DISTINCT dh.race_id, dh.date, dh.venue, dh.race_no, dh.current_odds
  FROM decision_history dh
  WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
    AND dh.result IS NOT NULL AND dh.result != ''
    AND dh.current_odds IS NOT NULL
    AND dh.venue NOT IN (${excl_v})
    AND dh.race_no NOT IN (${excl_r})
    AND dh.selection='1-2-3'
    AND dh.date >= '${FORWARD_START}'
    AND ${WIND24} AND ${EXH1}
  ORDER BY dh.date DESC
`).all() as CondBRace[];

console.log(`condB 対象レース: ${condBRaces.length}件`);

// ─── historical closing odds 取得 ─────────────────────────────────────────────

type OddsMap = Record<string, number | null>;
const closingOddsMap = new Map<string, OddsMap>(); // race_id → combination → odds

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

// ─── 払戻データ取得 ───────────────────────────────────────────────────────────

type PayoutRow = { race_id: string; combination: string; payout_yen: number };
const condBRaceIds = condBRaces.map(r => `'${r.race_id}'`).join(",");

const payouts = condBRaceIds.length > 0
  ? db.prepare(`
      SELECT race_id, combination, payout_yen
      FROM race_payouts
      WHERE race_id IN (${condBRaceIds})
        AND bet_type = 'trifecta'
    `).all() as PayoutRow[]
  : [];

const payoutMap = new Map<string, Record<string, number>>();
for (const p of payouts) {
  if (!payoutMap.has(p.race_id)) payoutMap.set(p.race_id, {});
  payoutMap.get(p.race_id)![p.combination] = p.payout_yen;
}

// ─── 全 forward BUY レース (hybrid 計算用) ────────────────────────────────────

type ForwardRace = {
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
`).all() as ForwardRace[];

const condBRaceIdSet = new Set(condBRaces.map(r => r.race_id));

// 全forward 払戻
const allForwardIds = allForwardRaces.map(r => `'${r.race_id}'`).join(",");
type ForwardPayoutRow = PayoutRow;
const allForwardPayouts = allForwardIds.length > 0
  ? db.prepare(`
      SELECT race_id, combination, payout_yen
      FROM race_payouts
      WHERE race_id IN (${allForwardIds}) AND bet_type = 'trifecta'
    `).all() as ForwardPayoutRow[]
  : [];
const fwdPayoutMap = new Map<string, Record<string, number>>();
for (const p of allForwardPayouts) {
  if (!fwdPayoutMap.has(p.race_id)) fwdPayoutMap.set(p.race_id, {});
  fwdPayoutMap.get(p.race_id)![p.combination] = p.payout_yen;
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

function calcStrategy(
  races: CondBRace[],
  combination: string,
): RaceResult[] {
  const results: RaceResult[] = [];
  for (const r of races) {
    const oddsMap = closingOddsMap.get(r.race_id) ?? {};
    const closing_odds = oddsMap[combination] ?? null;
    const pMap = payoutMap.get(r.race_id) ?? {};
    const payout_yen = pMap[combination] ?? 0;
    const hit = payout_yen > 0;
    const notes: string[] = [];
    if (closing_odds === null) notes.push("no_closing_odds");
    results.push({
      race_id: r.race_id,
      date: r.date,
      venue: r.venue,
      race_no: r.race_no,
      bet_combination: combination,
      invest: UNIT,
      payout: hit ? payout_yen / 100 * UNIT : 0,
      profit: hit ? payout_yen / 100 * UNIT - UNIT : -UNIT,
      closing_odds,
      hit,
      notes: notes.join(";"),
    });
  }
  return results;
}

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
  impliedProbAvg: number | null;
  hitRateMinusImplied: number | null;
  maxPayout: number;
  topNExcludeRoi: number;
  recent3mRoi: number;
  recent3mN: number;
  excl2507Roi: number;
  excl2507N: number;
  monthlyRoi: Record<string, { n: number; hits: number; invest: number; payout: number; roi: number }>;
  venueRoi: Record<string, { n: number; hits: number; roi: number }>;
  raceNoRoi: Record<string, { n: number; hits: number; roi: number }>;
  oddsRatioVs123Avg: number | null;
  dataInsufficient: boolean;
  results: RaceResult[];
};

function aggregateStats(name: string, combination: string, results: RaceResult[]): StrategyStats {
  const n = results.length;
  const withOdds = results.filter(r => r.closing_odds !== null);
  const n_closing_odds = withOdds.length;
  const hits = results.filter(r => r.hit).length;
  const hitRate = n > 0 ? hits / n : 0;
  const invest = n * UNIT;
  const payout = results.reduce((s, r) => s + r.payout, 0);
  const roi = invest > 0 ? payout / invest * 100 : 0;
  const profit = payout - invest;

  const closingOddsArr = withOdds.map(r => r.closing_odds!).sort((a, b) => a - b);
  const avgClosingOdds = closingOddsArr.length > 0
    ? closingOddsArr.reduce((s, v) => s + v, 0) / closingOddsArr.length : null;
  const medClosingOdds = closingOddsArr.length > 0
    ? closingOddsArr[Math.floor(closingOddsArr.length / 2)] : null;

  const impliedProbs = closingOddsArr.map(o => 1 / o);
  const impliedProbAvg = impliedProbs.length > 0
    ? impliedProbs.reduce((s, v) => s + v, 0) / impliedProbs.length : null;
  const hitRateMinusImplied = impliedProbAvg !== null ? hitRate - impliedProbAvg : null;

  const maxPayout = Math.max(0, ...results.map(r => r.payout));

  // top N 除外 ROI
  const sortedPayouts = [...results].sort((a, b) => b.payout - a.payout);
  const excludedTopN = new Set(sortedPayouts.slice(0, TOP_EXCLUDE_N).map(r => r.race_id));
  const excResults = results.filter(r => !excludedTopN.has(r.race_id));
  const excInvest = excResults.length * UNIT;
  const excPayout = excResults.reduce((s, r) => s + r.payout, 0);
  const topNExcludeRoi = excInvest > 0 ? excPayout / excInvest * 100 : 0;

  // 直近3ヶ月 ROI
  const recent = results.filter(r => r.date >= THREE_MONTHS_AGO);
  const recentInvest = recent.length * UNIT;
  const recentPayout = recent.reduce((s, r) => s + r.payout, 0);
  const recent3mRoi = recentInvest > 0 ? recentPayout / recentInvest * 100 : 0;
  const recent3mN = recent.length;

  // 2025-07 除外 ROI
  const excl2507 = results.filter(r => !r.date.startsWith("2025-07"));
  const excl2507Invest = excl2507.length * UNIT;
  const excl2507Payout = excl2507.reduce((s, r) => s + r.payout, 0);
  const excl2507Roi = excl2507Invest > 0 ? excl2507Payout / excl2507Invest * 100 : 0;
  const excl2507N = excl2507.length;

  // 月別 ROI
  const monthlyRoi: StrategyStats["monthlyRoi"] = {};
  for (const r of results) {
    const m = ym(r.date);
    if (!monthlyRoi[m]) monthlyRoi[m] = { n: 0, hits: 0, invest: 0, payout: 0, roi: 0 };
    monthlyRoi[m].n++;
    if (r.hit) monthlyRoi[m].hits++;
    monthlyRoi[m].invest += UNIT;
    monthlyRoi[m].payout += r.payout;
  }
  for (const m of Object.keys(monthlyRoi)) {
    const mo = monthlyRoi[m];
    mo.roi = mo.invest > 0 ? mo.payout / mo.invest * 100 : 0;
  }

  // 会場別 ROI
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

  // レース番号別 ROI
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

  // odds ratio vs 1-2-3
  let oddsRatioVs123Avg: number | null = null;
  if (combination !== "1-2-3") {
    const ratios: number[] = [];
    for (const r of results) {
      const oddsMap = closingOddsMap.get(r.race_id) ?? {};
      const o132 = oddsMap[combination];
      const o123 = oddsMap["1-2-3"];
      if (o132 != null && o123 != null && o123 > 0) ratios.push(o132 / o123);
    }
    oddsRatioVs123Avg = ratios.length > 0
      ? ratios.reduce((s, v) => s + v, 0) / ratios.length : null;
  }

  return {
    name, combination, n, n_closing_odds, hits, hitRate, invest, payout, roi, profit,
    avgClosingOdds, medClosingOdds, impliedProbAvg, hitRateMinusImplied,
    maxPayout, topNExcludeRoi, recent3mRoi, recent3mN, excl2507Roi, excl2507N,
    monthlyRoi, venueRoi, raceNoRoi, oddsRatioVs123Avg,
    dataInsufficient: n < 30,
    results,
  };
}

// ─── 戦略実行 ─────────────────────────────────────────────────────────────────

console.log("戦略計算中...");

const stratA = aggregateStats("A. baseline 1-2-3",  "1-2-3",  calcStrategy(condBRaces, "1-2-3"));
const stratC = aggregateStats("C. switch 1-3-2",    "1-3-2",  calcStrategy(condBRaces, "1-3-2"));
const stratD = aggregateStats("D. switch 1-2-4",    "1-2-4",  calcStrategy(condBRaces, "1-2-4"));
const stratE = aggregateStats("E. switch 1-4-2",    "1-4-2",  calcStrategy(condBRaces, "1-4-2"));
const stratF = aggregateStats("F. switch 1-3-4",    "1-3-4",  calcStrategy(condBRaces, "1-3-4"));

// B. skip: condBを除外した残存ROI
const nonCondBRaces = allForwardRaces.filter(r => !condBRaceIdSet.has(r.race_id));
const nonCondBResults: RaceResult[] = nonCondBRaces.map(r => {
  const pMap = fwdPayoutMap.get(r.race_id) ?? {};
  const payout_yen = pMap["1-2-3"] ?? 0;
  const hit = payout_yen > 0;
  return {
    race_id: r.race_id, date: r.date, venue: r.venue, race_no: r.race_no,
    bet_combination: "1-2-3",
    invest: UNIT, payout: hit ? payout_yen / 100 * UNIT : 0,
    profit: hit ? payout_yen / 100 * UNIT - UNIT : -UNIT,
    closing_odds: null, hit, notes: "non-condB",
  };
});
const stratB_skip_remaining = aggregateStats("B. skip (condB除外後の残存)", "1-2-3", nonCondBResults);

// H / I / J hybrid: condB以外は1-2-3, condBはswitch/skip
function calcHybrid(switchComb: string | null): StrategyStats {
  const label = switchComb ? `hybrid condB→${switchComb}` : "H. hybrid skip";
  const name  = switchComb ? `I/J. hybrid 1-2-3 + condB ${switchComb}` : "H. hybrid 1-2-3 + condB skip";
  const results: RaceResult[] = [];
  for (const r of allForwardRaces) {
    if (condBRaceIdSet.has(r.race_id)) {
      if (switchComb === null) continue; // skip: condBは含めない
      // switch
      const oddsMap = closingOddsMap.get(r.race_id) ?? {};
      const closing_odds = oddsMap[switchComb] ?? null;
      const pMap = payoutMap.get(r.race_id) ?? {};
      const payout_yen = pMap[switchComb] ?? 0;
      const hit = payout_yen > 0;
      results.push({
        race_id: r.race_id, date: r.date, venue: r.venue, race_no: r.race_no,
        bet_combination: switchComb,
        invest: UNIT, payout: hit ? payout_yen / 100 * UNIT : 0,
        profit: hit ? payout_yen / 100 * UNIT - UNIT : -UNIT,
        closing_odds, hit, notes: `condB_${switchComb}`,
      });
    } else {
      const pMap = fwdPayoutMap.get(r.race_id) ?? {};
      const payout_yen = pMap["1-2-3"] ?? 0;
      const hit = payout_yen > 0;
      results.push({
        race_id: r.race_id, date: r.date, venue: r.venue, race_no: r.race_no,
        bet_combination: "1-2-3",
        invest: UNIT, payout: hit ? payout_yen / 100 * UNIT : 0,
        profit: hit ? payout_yen / 100 * UNIT - UNIT : -UNIT,
        closing_odds: null, hit, notes: "non-condB",
      });
    }
  }
  return aggregateStats(name, switchComb ?? "skip", results);
}

const stratH = calcHybrid(null);
const stratI = calcHybrid("1-3-2");
const stratJ = calcHybrid("1-3-4");

const strategies = [stratA, stratC, stratD, stratE, stratF, stratB_skip_remaining, stratH, stratI, stratJ];

// 全体 forward baseline (参考)
const allForwardResults: RaceResult[] = allForwardRaces.map(r => {
  const pMap = fwdPayoutMap.get(r.race_id) ?? {};
  const payout_yen = pMap["1-2-3"] ?? 0;
  const hit = payout_yen > 0;
  return {
    race_id: r.race_id, date: r.date, venue: r.venue, race_no: r.race_no,
    bet_combination: "1-2-3",
    invest: UNIT, payout: hit ? payout_yen / 100 * UNIT : 0,
    profit: hit ? payout_yen / 100 * UNIT - UNIT : -UNIT,
    closing_odds: null, hit, notes: "all-forward",
  };
});
const statAllFwd = aggregateStats("全forward baseline", "1-2-3", allForwardResults);

// ─── 月別ROI出力用 helpers ───────────────────────────────────────────────────

function fmtRoi(v: number) { return v.toFixed(1) + "%"; }
function fmtN(v: number)   { return v.toFixed(0); }

// ─── MD 出力 ──────────────────────────────────────────────────────────────────

const now = new Date().toISOString();
const lines: string[] = [];

lines.push(`# condB switch historical closing odds 予備検証`);
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
lines.push(`| condB 対象レース | ${condBRaces.length}件 |`);
lines.push(`| historical closing odds 保存 race | ${closingOddsMap.size}件 |`);
lines.push(`| closing odds 保有率 | ${condBRaces.length > 0 ? (condBRaces.filter(r => closingOddsMap.has(r.race_id)).length / condBRaces.length * 100).toFixed(1) : "—"}% |`);
lines.push(`| 全 forward BUY race | ${allForwardRaces.length}件 |`);
lines.push(`| condB以外 forward race | ${nonCondBRaces.length}件 |`);
lines.push(`| 検証期間 | ${FORWARD_START} ～ |`);
lines.push(`| 単位投資 | ${UNIT}円 / 点 |`);
lines.push(`| top除外 N | ${TOP_EXCLUDE_N}件 |`);
lines.push(`| 直近3ヶ月基準 | ${THREE_MONTHS_AGO} 以降 |`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 戦略比較サマリ`);
lines.push(``);
lines.push(`| 戦略 | n | hits | 的中率 | ROI | top2除外ROI | 直近3M ROI (n) | 2025-07除外ROI (n) | data-insufficient |`);
lines.push(`|---|---:|---:|---:|---:|---:|---:|---:|:---:|`);

for (const s of strategies) {
  const di = s.dataInsufficient ? "⚠️ n<30" : "—";
  const r3m = s.recent3mN === 0
    ? `— (n=0 データなし)`
    : `${fmtRoi(s.recent3mRoi)} (n=${s.recent3mN})`;
  lines.push(`| ${s.name} | ${s.n} | ${s.hits} | ${(s.hitRate*100).toFixed(1)}% | ${fmtRoi(s.roi)} | ${fmtRoi(s.topNExcludeRoi)} | ${r3m} | ${fmtRoi(s.excl2507Roi)} (n=${s.excl2507N}) | ${di} |`);
}
const allR3m = statAllFwd.recent3mN === 0
  ? `— (n=0 データなし)`
  : `${fmtRoi(statAllFwd.recent3mRoi)} (n=${statAllFwd.recent3mN})`;
lines.push(`| **全forward baseline** | ${statAllFwd.n} | ${statAllFwd.hits} | ${(statAllFwd.hitRate*100).toFixed(1)}% | ${fmtRoi(statAllFwd.roi)} | ${fmtRoi(statAllFwd.topNExcludeRoi)} | ${allR3m} | ${fmtRoi(statAllFwd.excl2507Roi)} (n=${statAllFwd.excl2507N}) | — |`);
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
  lines.push(`| implied prob avg | ${s.impliedProbAvg !== null ? (s.impliedProbAvg*100).toFixed(2)+"%" : "—"} |`);
  lines.push(`| 実績的中率 - implied prob | ${s.hitRateMinusImplied !== null ? (s.hitRateMinusImplied*100).toFixed(2)+"%" : "—"} |`);
  lines.push(`| max payout | ${s.maxPayout.toFixed(0)}円 |`);
  lines.push(`| top${TOP_EXCLUDE_N}除外 ROI | **${fmtRoi(s.topNExcludeRoi)}** |`);
  const r3m = s.recent3mN === 0
    ? `— (n=0: ${THREE_MONTHS_AGO}以降にcondB対象なし)`
    : `${fmtRoi(s.recent3mRoi)} (n=${s.recent3mN})`;
  lines.push(`| 直近3ヶ月 ROI | ${r3m} |`);
  lines.push(`| 2025-07除外 ROI | ${fmtRoi(s.excl2507Roi)} (n=${s.excl2507N}) |`);
  if (s.oddsRatioVs123Avg !== null) lines.push(`| odds ratio vs 1-2-3 avg | ${s.oddsRatioVs123Avg.toFixed(3)} |`);
  lines.push(`| data-insufficient | ${s.dataInsufficient ? "⚠️ n<30" : "—"} |`);
  lines.push(``);

  // 月別 ROI
  lines.push(`**月別 ROI**`);
  lines.push(``);
  lines.push(`| 月 | n | hits | ROI |`);
  lines.push(`|---|---:|---:|---:|`);
  const months = Object.keys(s.monthlyRoi).sort();
  for (const m of months) {
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

  lines.push(`---`);
  lines.push(``);
}

// ─── 判定まとめ ───────────────────────────────────────────────────────────────

const top2ok = stratC.topNExcludeRoi >= 100;
const recent3mOk = stratC.recent3mN > 0 && stratC.recent3mRoi > 0;
const recent3mNoData = stratC.recent3mN === 0;
const months3m = Object.entries(stratC.monthlyRoi)
  .filter(([m]) => m >= THREE_MONTHS_AGO.slice(0, 7))
  .sort(([a], [b]) => a.localeCompare(b));
const has3mZeroHit = months3m.some(([, mo]) => mo.hits === 0);
const excl2507ok = stratC.excl2507Roi >= 100;

lines.push(`## 判定まとめ`);
lines.push(``);
lines.push(`| 判定項目 | 条件 | 結果 |`);
lines.push(`|---|---|---|`);
lines.push(`| n ≥ 100 (monitor候補) | n≥100 | ${condBRaces.length >= 100 ? "✅" : "⚠️"} n=${condBRaces.length} |`);
lines.push(`| condB 1-3-2 ROI > baseline | C > A | ${stratC.roi > stratA.roi ? "✅" : "❌"} (${fmtRoi(stratC.roi)} vs ${fmtRoi(stratA.roi)}) |`);
lines.push(`| skip の方が baseline より良い | B残存 > 全体 | ${stratB_skip_remaining.roi > statAllFwd.roi ? "✅" : "❌"} (${fmtRoi(stratB_skip_remaining.roi)} vs ${fmtRoi(statAllFwd.roi)}) |`);
lines.push(`| top2除外 ROI ≥ 100% | ≥100% | ${top2ok ? "✅" : "❌"} (${fmtRoi(stratC.topNExcludeRoi)}) |`);
lines.push(`| 2025-07除外 ROI ≥ 100% | ≥100% | ${excl2507ok ? "✅" : "❌"} (${fmtRoi(stratC.excl2507Roi)} n=${stratC.excl2507N}) |`);
lines.push(`| 直近3ヶ月 ROI > 0% | >0% | ${recent3mNoData ? "⚠️ n=0 (データなし)" : recent3mOk ? "✅" : "❌"} (${recent3mNoData ? `condBは${THREE_MONTHS_AGO}以降0件` : fmtRoi(stratC.recent3mRoi)}) |`);
lines.push(`| 直近3ヶ月 0hit月なし | 0hit月なし | ${recent3mNoData ? "⚠️ 判定不可 (n=0)" : !has3mZeroHit ? "✅" : "❌"} |`);
lines.push(`| historical closing odds のみ → 本採用可 | 不可 | ❌ live/T-5未検証 |`);
lines.push(`| future-only timeseries 再確認要 | 要 | ⚠️ 必須 |`);
lines.push(``);
lines.push(`**condB 1-3-2 switch は historical closing odds 上で** ${stratC.roi > stratA.roi ? "**baseline を上回る**" : "**baseline を下回る**"}。`);
lines.push(`- baseline (A) ROI: ${fmtRoi(stratA.roi)}`);
lines.push(`- switch 1-3-2 (C) ROI: ${fmtRoi(stratC.roi)}`);
lines.push(`- skip 残存 (B) ROI: ${fmtRoi(stratB_skip_remaining.roi)}`);
lines.push(`- hybrid skip (H) ROI: ${fmtRoi(stratH.roi)}`);
lines.push(`- hybrid 1-3-2 (I) ROI: ${fmtRoi(stratI.roi)}`);
lines.push(``);
lines.push(`**top${TOP_EXCLUDE_N}除外 ROI**: ${fmtRoi(stratC.topNExcludeRoi)} ${top2ok ? "→ ✅ 格上げ条件を満たす" : "→ ❌ 100%未達"}`);
lines.push(`**直近3ヶ月**: ${fmtRoi(stratC.recent3mRoi)} ${has3mZeroHit ? "⚠️ 0hit月あり" : "（0hit月なし）"}`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 注記`);
lines.push(``);
lines.push(`- 条件Bの 1-3-2 ROI は historical closing odds 取得前は **事後計算**（race_payouts.payout_yen ベース）だった`);
lines.push(`- **今回の switch 検証は historical closing odds backtest であり live/T-5 forward ではない**`);
lines.push(`- historical closing odds で良い結果が出ても **本採用は不可**`);
lines.push(`- 現時点で本採用可能な戦略は **なし**`);
lines.push(`- skip monitor は継続`);
lines.push(`- 条件B は **future-only odds_timeseries** での再確認が必要`);
lines.push(`- 本採用には live/T-5 odds での forward 検証が前提`);
lines.push(`- 2025年の指定月のみ成立する候補は採用不可`);
lines.push(`- payout_yen は検証結果として参照するが、運用条件には使わない`);
lines.push(``);
lines.push(`---`);
lines.push(`*生成: analyze-condb-switch-historical-closing-odds.ts*`);

const md = lines.join("\n");
if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");

// ─── JSON 出力 ────────────────────────────────────────────────────────────────

const jsonOutput = {
  generatedAt: now,
  meta: {
    description: "condB historical closing odds switch予備検証",
    warningNotForward: "これはhistorical closing odds backtestです。live/T-5/T-10 forwardではありません",
    warningNoAdoption: "historical closing oddsで良くても本採用不可。future-only odds_timeseriesで再確認必要",
    forwardStart: FORWARD_START,
    unit: UNIT,
    topExcludeN: TOP_EXCLUDE_N,
  },
  overview: {
    condBRaces: condBRaces.length,
    closingOddsRaces: closingOddsMap.size,
    allForwardRaces: allForwardRaces.length,
    nonCondBRaces: nonCondBRaces.length,
  },
  strategies: strategies.map(s => ({
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
    impliedProbAvg: s.impliedProbAvg !== null ? Math.round(s.impliedProbAvg * 10000) / 100 : null,
    hitRateMinusImplied: s.hitRateMinusImplied !== null ? Math.round(s.hitRateMinusImplied * 10000) / 100 : null,
    maxPayout: Math.round(s.maxPayout),
    topNExcludeRoi: Math.round(s.topNExcludeRoi * 100) / 100,
    recent3mRoi: Math.round(s.recent3mRoi * 100) / 100,
    oddsRatioVs123Avg: s.oddsRatioVs123Avg !== null ? Math.round(s.oddsRatioVs123Avg * 1000) / 1000 : null,
    dataInsufficient: s.dataInsufficient,
    monthlyRoi: Object.fromEntries(
      Object.entries(s.monthlyRoi).sort().map(([m, mo]) => [m, {
        n: mo.n, hits: mo.hits,
        roi: Math.round(mo.roi * 100) / 100,
      }])
    ),
  })),
  allForwardBaseline: {
    n: statAllFwd.n, hits: statAllFwd.hits,
    roi: Math.round(statAllFwd.roi * 100) / 100,
    topNExcludeRoi: Math.round(statAllFwd.topNExcludeRoi * 100) / 100,
    recent3mRoi: Math.round(statAllFwd.recent3mRoi * 100) / 100,
  },
  verdict: {
    n: condBRaces.length,
    stratC_roi: Math.round(stratC.roi * 100) / 100,
    stratA_roi: Math.round(stratA.roi * 100) / 100,
    switch132_beats_baseline: stratC.roi > stratA.roi,
    top2ExcludeRoi: Math.round(stratC.topNExcludeRoi * 100) / 100,
    top2ExcludeRoiOk: top2ok,
    excl2507Roi: Math.round(stratC.excl2507Roi * 100) / 100,
    excl2507N: stratC.excl2507N,
    excl2507Ok: excl2507ok,
    recent3mRoi: Math.round(stratC.recent3mRoi * 100) / 100,
    recent3mN: stratC.recent3mN,
    recent3mNoData,
    has3mZeroHit,
    hybridI_roi: Math.round(stratI.roi * 100) / 100,
    historicalAdoptionAllowed: false,
    futureTimeseriesRequired: true,
  },
};
writeFileSync(OUT_JSON, JSON.stringify(jsonOutput, null, 2), "utf-8");

console.log("\n=== 結果サマリ ===");
console.log(`  condB n=${condBRaces.length} (直近3M n=${stratC.recent3mN})`);
for (const s of strategies.slice(0, 6)) {
  const r3m = s.recent3mN === 0 ? "データなし" : fmtRoi(s.recent3mRoi);
  console.log(`  ${s.name}: ROI=${fmtRoi(s.roi)} / top2除外=${fmtRoi(s.topNExcludeRoi)} / 直近3M=${r3m} / 2025-07除外=${fmtRoi(s.excl2507Roi)}`);
}
console.log(`  全forward baseline: ROI=${fmtRoi(statAllFwd.roi)}`);
console.log(`  hybrid H (skip): ROI=${fmtRoi(stratH.roi)}`);
console.log(`  hybrid I (1-3-2): ROI=${fmtRoi(stratI.roi)}`);
console.log(`  hybrid J (1-3-4): ROI=${fmtRoi(stratJ.roi)}`);
console.log();
console.log(`出力: ${OUT_MD}`);
console.log(`出力: ${OUT_JSON}`);
