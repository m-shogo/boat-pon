/**
 * analyze-all-bet-types-roi.ts — 読み取り専用
 *
 * 禁止: DBへのINSERT/UPDATE/DELETE/DROP, app_settings変更, 本番decision変更
 * 禁止: 自動投票・ログイン保存・投票サイト操作・購入推奨
 * BUY は検証候補、ROI は検証指標であり購入推奨ではない。
 *
 * 目的: 全券種ROIシミュレーター。
 *   「3連単以外を探す」ではなく、1レース100円で券種ごとの
 *   期待値・的中率・最大連敗・運用しやすさを比較する。
 *
 * ⚠️ データ制約 (2026-06-11 実測):
 *   - race_payouts の bet_type は exacta / quinella / trifecta / trio / wide の5種のみ
 *   - 単勝・複勝の払戻データは DB に存在しない
 *     → 的中率のみ trifecta 当選組番から導出して実測、ROI は data-unavailable
 *   - combination 形式: 連複系(quinella/trio/wide)は昇順 "1-2" / "1-2-3"、
 *     連単系(exacta/trifecta)は着順 "1-2" / "1-2-3"
 *   - payout_yen は 100円券に対する払戻額
 *
 * 比較設計 (selection 1-2-3 から自然に派生する候補):
 *   - 3連単 trifecta: 1-2-3 (baseline) / 1-3-2 / 1-2-4 / 1-4-2 / 1-3-4
 *   - 3連複 trio:     1=2=3 / 1=2=4 / 1=3=4
 *   - 2連単 exacta:   1-2 / 1-3 / 1-4
 *   - 2連複 quinella: 1=2 / 1=3 / 1=4
 *   - 単勝: 1号艇 (的中率のみ)
 *   - 複勝: 1号艇 2着以内 (的中率のみ)
 *   ※ 拡連複(wide)は 2025-06 検証で全条件最下位・不採用確定のため対象外
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/all-bet-types-roi.md";
const OUT_JSON = "reports/all-bet-types-roi.json";

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

const FORWARD_START = "2025-01-01";
const EXCL_VENUES   = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES    = [10, 11, 12];
const SKIP_VENUES   = ["浜名湖", "住之江"];
const UNIT          = 100;
const MIN_N_FOR_JUDGE = 30;
const MIN_HITS_FOR_JUDGE = 3;
const LONG_STREAK_WARN = 60;

const excl_v = EXCL_VENUES.map(v => `'${v}'`).join(",");
const excl_r = EXCL_RACES.join(",");

// ─── bet_type / combination 形式の事前確認 (決め打ち禁止) ─────────────────────

const betTypesInDb = db.prepare(
  `SELECT bet_type, COUNT(*) n FROM race_payouts GROUP BY bet_type ORDER BY bet_type`
).all() as { bet_type: string; n: number }[];
console.log("=== race_payouts bet_type 一覧 (実測) ===");
for (const b of betTypesInDb) console.log(`  ${b.bet_type}: ${b.n}`);

const REQUIRED_BET_TYPES = ["trifecta", "trio", "exacta", "quinella"];
for (const bt of REQUIRED_BET_TYPES) {
  if (!betTypesInDb.some(b => b.bet_type === bt)) {
    console.error(`bet_type '${bt}' が race_payouts に存在しません。名称を確認してください。`);
    process.exit(1);
  }
}
const HAS_WIN_PLACE = betTypesInDb.some(b => /win|place|単勝|複勝|tansho|fukusho/i.test(b.bet_type));
console.log(`単勝/複勝 payout データ: ${HAS_WIN_PLACE ? "あり" : "なし → 的中率のみ実測 (ROI data-unavailable)"}`);

// ─── 対象レース（BUY forward baseline、governor と同条件） ───────────────────

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

console.log(`対象 forward BUY race: ${allForwardRaces.length}件`);

// 重複セット (skip6R / skipVenue / condB)
const skip6RIds   = new Set(allForwardRaces.filter(r => r.race_no === 6).map(r => r.race_id));
const skipVenueIds = new Set(allForwardRaces.filter(r => SKIP_VENUES.includes(r.venue)).map(r => r.race_id));

const WIND24 = `EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id
  AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)`;
const EXH1   = `EXISTS (SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=1
    AND ed.exhibition_time IS NOT NULL
    AND ed.exhibition_time = (SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2
      WHERE ed2.race_id=dh.race_id))`;
const condBIds = new Set((db.prepare(`
  SELECT DISTINCT dh.race_id
  FROM decision_history dh
  WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
    AND dh.result IS NOT NULL AND dh.result != ''
    AND dh.current_odds IS NOT NULL
    AND dh.venue NOT IN (${excl_v})
    AND dh.race_no NOT IN (${excl_r})
    AND dh.selection='1-2-3'
    AND dh.date >= '${FORWARD_START}'
    AND ${WIND24} AND ${EXH1}
`).all() as { race_id: string }[]).map(r => r.race_id));

// ─── 払戻データ取得 (4券種一括) ───────────────────────────────────────────────

type PayoutRow = { race_id: string; bet_type: string; combination: string; payout_yen: number };
const allForwardIds = allForwardRaces.map(r => `'${r.race_id}'`).join(",");
const allPayouts = db.prepare(`
  SELECT race_id, bet_type, combination, payout_yen
  FROM race_payouts
  WHERE race_id IN (${allForwardIds})
    AND bet_type IN ('trifecta','trio','exacta','quinella')
`).all() as PayoutRow[];

// race_id → bet_type → combination → payout_yen
const payoutMap = new Map<string, Map<string, Record<string, number>>>();
for (const p of allPayouts) {
  if (!payoutMap.has(p.race_id)) payoutMap.set(p.race_id, new Map());
  const btMap = payoutMap.get(p.race_id)!;
  if (!btMap.has(p.bet_type)) btMap.set(p.bet_type, {});
  btMap.get(p.bet_type)![p.combination] = p.payout_yen;
}

// 勝者導出用: trifecta 当選組番 (単勝/複勝の的中判定に使う)
const winnerMap = new Map<string, { first: string; second: string }>();
for (const [raceId, btMap] of payoutMap) {
  const tri = btMap.get("trifecta");
  if (!tri) continue;
  const combos = Object.keys(tri);
  if (combos.length === 0) continue;
  const parts = combos[0].split("-");
  if (parts.length === 3) winnerMap.set(raceId, { first: parts[0], second: parts[1] });
}

// historical closing odds (3連単5買い目のみ参考表示)
type OddsRow = { race_id: string; combination: string; odds: number };
const closingOddsMap = new Map<string, Record<string, number>>();
for (const row of db.prepare(`
  SELECT race_id, combination, odds FROM historical_alternative_odds
  WHERE source_quality='historical_closing_odds'
`).all() as OddsRow[]) {
  if (!closingOddsMap.has(row.race_id)) closingOddsMap.set(row.race_id, {});
  closingOddsMap.get(row.race_id)![row.combination] = row.odds;
}

// ─── 候補定義 ─────────────────────────────────────────────────────────────────

type Candidate = {
  id: string;
  label: string;
  betType: string;            // race_payouts の bet_type または "win"/"place"
  combination: string | null; // null = 単勝/複勝 (派生判定)
  roiAvailable: boolean;
};

const CANDIDATES: Candidate[] = [
  { id: "trifecta_123", label: "3連単 1-2-3 (baseline)", betType: "trifecta", combination: "1-2-3", roiAvailable: true },
  { id: "trifecta_132", label: "3連単 1-3-2", betType: "trifecta", combination: "1-3-2", roiAvailable: true },
  { id: "trifecta_124", label: "3連単 1-2-4", betType: "trifecta", combination: "1-2-4", roiAvailable: true },
  { id: "trifecta_142", label: "3連単 1-4-2", betType: "trifecta", combination: "1-4-2", roiAvailable: true },
  { id: "trifecta_134", label: "3連単 1-3-4", betType: "trifecta", combination: "1-3-4", roiAvailable: true },
  { id: "trio_123", label: "3連複 1=2=3", betType: "trio", combination: "1-2-3", roiAvailable: true },
  { id: "trio_124", label: "3連複 1=2=4", betType: "trio", combination: "1-2-4", roiAvailable: true },
  { id: "trio_134", label: "3連複 1=3=4", betType: "trio", combination: "1-3-4", roiAvailable: true },
  { id: "exacta_12", label: "2連単 1-2", betType: "exacta", combination: "1-2", roiAvailable: true },
  { id: "exacta_13", label: "2連単 1-3", betType: "exacta", combination: "1-3", roiAvailable: true },
  { id: "exacta_14", label: "2連単 1-4", betType: "exacta", combination: "1-4", roiAvailable: true },
  { id: "quinella_12", label: "2連複 1=2", betType: "quinella", combination: "1-2", roiAvailable: true },
  { id: "quinella_13", label: "2連複 1=3", betType: "quinella", combination: "1-3", roiAvailable: true },
  { id: "quinella_14", label: "2連複 1=4", betType: "quinella", combination: "1-4", roiAvailable: true },
  { id: "win_1", label: "単勝 1号艇 (的中率のみ)", betType: "win", combination: null, roiAvailable: false },
  { id: "place_1", label: "複勝 1号艇 (的中率のみ)", betType: "place", combination: null, roiAvailable: false },
];

// ─── 計算 ─────────────────────────────────────────────────────────────────────

const THREE_MONTHS_AGO = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString().slice(0, 10);
})();
function ym(date: string) { return date.slice(0, 7); }

type RaceResult = {
  race_id: string; date: string; venue: string; race_no: number;
  hit: boolean; payout: number;
};

function calcCandidate(c: Candidate): RaceResult[] {
  const results: RaceResult[] = [];
  for (const r of allForwardRaces) {
    let hit = false;
    let payout = 0;
    if (c.combination !== null) {
      const pMap = payoutMap.get(r.race_id)?.get(c.betType) ?? {};
      const payout_yen = pMap[c.combination] ?? 0;
      hit = payout_yen > 0;
      payout = hit ? payout_yen / 100 * UNIT : 0;
    } else {
      const w = winnerMap.get(r.race_id);
      if (w) {
        if (c.betType === "win")   hit = w.first === "1";
        if (c.betType === "place") hit = w.first === "1" || w.second === "1";
      }
      payout = 0; // 払戻データなし
    }
    results.push({ race_id: r.race_id, date: r.date, venue: r.venue, race_no: r.race_no, hit, payout });
  }
  return results;
}

function maxLosingStreak(results: RaceResult[]): number {
  let max = 0, cur = 0;
  for (const r of results) {
    if (r.hit) { cur = 0; } else { cur++; if (cur > max) max = cur; }
  }
  return max;
}

function roiOf(results: RaceResult[]): number {
  const invest = results.length * UNIT;
  return invest > 0 ? results.reduce((s, r) => s + r.payout, 0) / invest * 100 : 0;
}

type Verdict = "promote" | "watch" | "reject" | "insufficient" | "data-unavailable";

type CandidateStats = {
  id: string; label: string; betType: string; combination: string | null;
  roiAvailable: boolean;
  n: number; hits: number; hitRate: number;
  stake: number; payout: number; profit: number; roi: number;
  avgPayout: number | null; medPayout: number | null; maxPayout: number;
  maxLosingStreak: number;
  top1ExcludeRoi: number; top2ExcludeRoi: number;
  recent3mRoi: number; recent3mN: number;
  monthlyRoi: Record<string, { n: number; hits: number; roi: number }>;
  zeroHitMonths: string[];
  venueTop: Array<{ venue: string; n: number; hits: number; roi: number }>;
  raceNoRoi: Record<string, { n: number; hits: number; roi: number }>;
  overlapImpact: {
    exclSkip6R: { n: number; roi: number };
    exclSkipVenue: { n: number; roi: number };
    exclCondB: { n: number; roi: number };
  };
  avgClosingOdds: number | null;
  warnings: string[];
  verdict: Verdict;
  verdictReasons: string[];
};

function analyze(c: Candidate): CandidateStats {
  const results = calcCandidate(c);
  const n = results.length;
  const hits = results.filter(r => r.hit).length;
  const hitRate = n > 0 ? hits / n : 0;
  const stake = n * UNIT;
  const payout = results.reduce((s, r) => s + r.payout, 0);
  const roi = c.roiAvailable && stake > 0 ? payout / stake * 100 : 0;
  const profit = payout - stake;

  const hitPayouts = results.filter(r => r.hit && r.payout > 0).map(r => r.payout).sort((a, b) => a - b);
  const avgPayout = hitPayouts.length > 0 ? hitPayouts.reduce((s, v) => s + v, 0) / hitPayouts.length : null;
  const medPayout = hitPayouts.length > 0 ? hitPayouts[Math.floor(hitPayouts.length / 2)] : null;
  const maxPayout = Math.max(0, ...results.map(r => r.payout));

  function exclTopN(k: number): number {
    const sorted = [...results].sort((a, b) => b.payout - a.payout);
    const excluded = new Set(sorted.slice(0, k).map(r => r.race_id));
    const rest = results.filter(r => !excluded.has(r.race_id));
    return roiOf(rest);
  }
  const top1ExcludeRoi = exclTopN(1);
  const top2ExcludeRoi = exclTopN(2);

  const recent = results.filter(r => r.date >= THREE_MONTHS_AGO);
  const recent3mN = recent.length;
  const recent3mRoi = roiOf(recent);

  const monthlyRoi: CandidateStats["monthlyRoi"] = {};
  for (const r of results) {
    const m = ym(r.date);
    if (!monthlyRoi[m]) monthlyRoi[m] = { n: 0, hits: 0, roi: 0 };
    monthlyRoi[m].n++;
    if (r.hit) monthlyRoi[m].hits++;
  }
  for (const m of Object.keys(monthlyRoi)) {
    monthlyRoi[m].roi = roiOf(results.filter(x => ym(x.date) === m));
  }
  const zeroHitMonths = Object.entries(monthlyRoi)
    .filter(([, mo]) => mo.n >= 5 && mo.hits === 0)
    .map(([m]) => m).sort();

  const venueAgg: Record<string, RaceResult[]> = {};
  for (const r of results) {
    (venueAgg[r.venue] ??= []).push(r);
  }
  const venueTop = Object.entries(venueAgg)
    .filter(([, rs]) => rs.length >= 10)
    .map(([venue, rs]) => ({ venue, n: rs.length, hits: rs.filter(r => r.hit).length, roi: roiOf(rs) }))
    .sort((a, b) => b.roi - a.roi)
    .slice(0, 5);

  const raceNoRoi: CandidateStats["raceNoRoi"] = {};
  for (const r of results) {
    const k = String(r.race_no);
    if (!raceNoRoi[k]) raceNoRoi[k] = { n: 0, hits: 0, roi: 0 };
    raceNoRoi[k].n++;
    if (r.hit) raceNoRoi[k].hits++;
  }
  for (const k of Object.keys(raceNoRoi)) {
    raceNoRoi[k].roi = roiOf(results.filter(x => String(x.race_no) === k));
  }

  const exclSkip6RResults    = results.filter(r => !skip6RIds.has(r.race_id));
  const exclSkipVenueResults = results.filter(r => !skipVenueIds.has(r.race_id));
  const exclCondBResults     = results.filter(r => !condBIds.has(r.race_id));
  const overlapImpact = {
    exclSkip6R:    { n: exclSkip6RResults.length,    roi: roiOf(exclSkip6RResults) },
    exclSkipVenue: { n: exclSkipVenueResults.length, roi: roiOf(exclSkipVenueResults) },
    exclCondB:     { n: exclCondBResults.length,     roi: roiOf(exclCondBResults) },
  };

  // 3連単5買い目のみ closing odds 参考表示
  let avgClosingOdds: number | null = null;
  if (c.betType === "trifecta" && c.combination !== null) {
    const arr: number[] = [];
    for (const r of allForwardRaces) {
      const o = closingOddsMap.get(r.race_id)?.[c.combination];
      if (o != null) arr.push(o);
    }
    avgClosingOdds = arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
  }

  // 警告
  const warnings: string[] = [];
  if (!c.roiAvailable) warnings.push("払戻データなし: ROI算出不可 (的中率のみ実測)");
  if (n < MIN_N_FOR_JUDGE) warnings.push(`n=${n} < ${MIN_N_FOR_JUDGE}`);
  if (c.roiAvailable && hits < MIN_HITS_FOR_JUDGE) warnings.push(`hits=${hits} < ${MIN_HITS_FOR_JUDGE}: 参考値`);
  if (c.roiAvailable && roi >= 100 && top2ExcludeRoi < 100) {
    warnings.push(`ROI ${roi.toFixed(1)}% は top2除外で ${top2ExcludeRoi.toFixed(1)}% に低下: 高配当依存`);
  }
  if (c.roiAvailable && maxPayout > 0 && payout > 0 && maxPayout / payout > 0.5) {
    warnings.push(`単一raceが払戻の${(maxPayout / payout * 100).toFixed(0)}%: 単発依存`);
  }
  if (maxLosingStreak(results) >= LONG_STREAK_WARN) {
    warnings.push(`最大連敗${maxLosingStreak(results)} ≥ ${LONG_STREAK_WARN}: 運用難`);
  }
  if (zeroHitMonths.length > 0) warnings.push(`0hit月 (n≥5): ${zeroHitMonths.join(", ")}`);
  if (c.roiAvailable && hitRate >= 0.3 && roi < 100) {
    warnings.push(`的中率${(hitRate*100).toFixed(1)}%と高いがROI<100%: 安定するが期待値なし`);
  }

  // 判定
  const verdictReasons: string[] = [];
  let verdict: Verdict;
  if (!c.roiAvailable) {
    verdict = "data-unavailable";
    verdictReasons.push("単勝/複勝の払戻データがDBにないためROI評価不可。的中率のみ実測");
  } else if (n < MIN_N_FOR_JUDGE || hits < MIN_HITS_FOR_JUDGE) {
    verdict = "insufficient";
    verdictReasons.push(`n=${n} / hits=${hits}: 判定基準未達`);
  } else if (zeroHitMonths.length >= 2 && roi < 100) {
    verdict = "reject";
    verdictReasons.push(`0hit月${zeroHitMonths.length}つ かつ ROI ${roi.toFixed(1)}% < 100%: 期間依存+赤字`);
  } else if (roi >= 100 && top2ExcludeRoi < 100) {
    verdict = zeroHitMonths.length >= 2 ? "reject" : "watch";
    verdictReasons.push(`ROI ${roi.toFixed(1)}% だが top2除外 ${top2ExcludeRoi.toFixed(1)}% < 100%: 高配当依存${zeroHitMonths.length >= 2 ? " + 期間依存 → reject" : " → watch"}`);
  } else if (roi >= 100 && top2ExcludeRoi >= 100) {
    verdict = "watch";
    verdictReasons.push(`ROI/top2除外とも≥100%だが historical backtest のみ: forward未確認のため watch 止まり`);
  } else {
    verdict = "reject";
    verdictReasons.push(`ROI ${roi.toFixed(1)}% < 100%: 期待値なし`);
  }

  return {
    id: c.id, label: c.label, betType: c.betType, combination: c.combination,
    roiAvailable: c.roiAvailable,
    n, hits, hitRate, stake, payout, profit, roi,
    avgPayout, medPayout, maxPayout,
    maxLosingStreak: maxLosingStreak(results),
    top1ExcludeRoi, top2ExcludeRoi,
    recent3mRoi, recent3mN,
    monthlyRoi, zeroHitMonths, venueTop, raceNoRoi,
    overlapImpact, avgClosingOdds,
    warnings, verdict, verdictReasons,
  };
}

console.log("候補計算中...");
const stats = CANDIDATES.map(analyze);

// ─── ランキング ───────────────────────────────────────────────────────────────

const roiCands = stats.filter(s => s.roiAvailable);
const roiRanking      = [...roiCands].sort((a, b) => b.roi - a.roi);
const hitRateRanking  = [...stats].sort((a, b) => b.hitRate - a.hitRate);
const streakRanking   = [...stats].sort((a, b) => a.maxLosingStreak - b.maxLosingStreak);

// 運用しやすさ: 的中率rank + 最大連敗rank + ROI rank の平均 (ROI評価可能な候補のみ)
function rankMap<T>(arr: T[], key: (x: T) => number, desc: boolean): Map<T, number> {
  const sorted = [...arr].sort((a, b) => desc ? key(b) - key(a) : key(a) - key(b));
  const m = new Map<T, number>();
  sorted.forEach((x, i) => m.set(x, i + 1));
  return m;
}
const rHit    = rankMap(roiCands, s => s.hitRate, true);
const rStreak = rankMap(roiCands, s => s.maxLosingStreak, false);
const rRoi    = rankMap(roiCands, s => s.roi, true);
const operability = [...roiCands]
  .map(s => ({ s, score: (rHit.get(s)! + rStreak.get(s)! + rRoi.get(s)!) / 3 }))
  .sort((a, b) => a.score - b.score);

// ─── MD 出力 ──────────────────────────────────────────────────────────────────

function fmtRoi(v: number) { return v.toFixed(1) + "%"; }
function fmtPct(v: number) { return (v * 100).toFixed(1) + "%"; }

const now = new Date().toISOString();
const lines: string[] = [];

lines.push(`# 全券種ROIシミュレーター (1レース100円・実払戻ベース)`);
lines.push(``);
lines.push(`生成日時: ${now}`);
lines.push(``);
lines.push(`> **読み取り専用。BUY は検証候補、ROI は検証指標。購入推奨ではない。**`);
lines.push(`> **これは race_payouts 実払戻ベースの backtest であり live/T-5 forward ではない。**`);
lines.push(`> **app_settings / 本番 decision への反映は禁止。**`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## データ制約 (実測確認済み)`);
lines.push(``);
lines.push(`| 項目 | 内容 |`);
lines.push(`|---|---|`);
lines.push(`| race_payouts bet_type | ${betTypesInDb.map(b => b.bet_type).join(" / ")} |`);
lines.push(`| 単勝・複勝 払戻データ | **DBに存在しない** → 的中率のみ trifecta 当選組番から実測、ROI は data-unavailable |`);
lines.push(`| combination 形式 | 連複系=昇順 dash (例 1-2-3)、連単系=着順 dash |`);
lines.push(`| payout_yen | 100円券に対する払戻額 |`);
lines.push(`| 拡連複 (wide) | 2025-06 検証で全条件最下位・不採用確定のため対象外 |`);
lines.push(``);
lines.push(`## 検証概要`);
lines.push(``);
lines.push(`| 項目 | 値 |`);
lines.push(`|---|---|`);
lines.push(`| 対象 forward BUY race | ${allForwardRaces.length}件 |`);
lines.push(`| 検証期間 | ${FORWARD_START} ～ |`);
lines.push(`| 単位投資 | ${UNIT}円 / レース / 候補 |`);
lines.push(`| skip6R 重複 | ${skip6RIds.size}件 |`);
lines.push(`| skipVenue 重複 | ${skipVenueIds.size}件 |`);
lines.push(`| condB 重複 | ${condBIds.size}件 |`);
lines.push(`| 判定最低 n / hits | ${MIN_N_FOR_JUDGE} / ${MIN_HITS_FOR_JUDGE} |`);
lines.push(`| 連敗警告ライン | ${LONG_STREAK_WARN} |`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 全候補サマリ`);
lines.push(``);
lines.push(`| 候補 | n | hits | 的中率 | ROI | top1除外 | top2除外 | 最大連敗 | avg払戻 | med払戻 | 判定 |`);
lines.push(`|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|`);
for (const s of stats) {
  const roi  = s.roiAvailable ? fmtRoi(s.roi) : "—";
  const t1   = s.roiAvailable ? fmtRoi(s.top1ExcludeRoi) : "—";
  const t2   = s.roiAvailable ? fmtRoi(s.top2ExcludeRoi) : "—";
  const avgP = s.avgPayout !== null ? s.avgPayout.toFixed(0) : "—";
  const medP = s.medPayout !== null ? s.medPayout.toFixed(0) : "—";
  lines.push(`| ${s.label} | ${s.n} | ${s.hits} | ${fmtPct(s.hitRate)} | ${roi} | ${t1} | ${t2} | ${s.maxLosingStreak} | ${avgP} | ${medP} | **${s.verdict}** |`);
}
lines.push(``);
lines.push(`---`);
lines.push(``);

// ランキング
lines.push(`## ランキング`);
lines.push(``);
lines.push(`### 1. ROI (払戻データあり候補のみ)`);
lines.push(``);
lines.push(`| 順位 | 候補 | ROI | top2除外 | 判定 |`);
lines.push(`|---:|---|---:|---:|---|`);
roiRanking.forEach((s, i) => {
  lines.push(`| ${i+1} | ${s.label} | ${fmtRoi(s.roi)} | ${fmtRoi(s.top2ExcludeRoi)} | ${s.verdict} |`);
});
lines.push(``);
lines.push(`### 2. 的中率`);
lines.push(``);
lines.push(`| 順位 | 候補 | 的中率 | ROI | 判定 |`);
lines.push(`|---:|---|---:|---:|---|`);
hitRateRanking.forEach((s, i) => {
  lines.push(`| ${i+1} | ${s.label} | ${fmtPct(s.hitRate)} | ${s.roiAvailable ? fmtRoi(s.roi) : "—"} | ${s.verdict} |`);
});
lines.push(``);
lines.push(`### 3. 最大連敗の短さ`);
lines.push(``);
lines.push(`| 順位 | 候補 | 最大連敗 | 的中率 | ROI |`);
lines.push(`|---:|---|---:|---:|---:|`);
streakRanking.forEach((s, i) => {
  lines.push(`| ${i+1} | ${s.label} | ${s.maxLosingStreak} | ${fmtPct(s.hitRate)} | ${s.roiAvailable ? fmtRoi(s.roi) : "—"} |`);
});
lines.push(``);
lines.push(`### 4. 実運用しやすさ (的中率rank + 最大連敗rank + ROI rank の平均)`);
lines.push(``);
lines.push(`| 順位 | 候補 | 複合score | 的中率 | 最大連敗 | ROI |`);
lines.push(`|---:|---|---:|---:|---:|---:|`);
operability.forEach((o, i) => {
  lines.push(`| ${i+1} | ${o.s.label} | ${o.score.toFixed(1)} | ${fmtPct(o.s.hitRate)} | ${o.s.maxLosingStreak} | ${fmtRoi(o.s.roi)} |`);
});
lines.push(``);
lines.push(`---`);
lines.push(``);

// 重複影響
lines.push(`## skip6R / skipVenue / condB 重複影響 (除外時ROI)`);
lines.push(``);
lines.push(`| 候補 | 全体ROI | skip6R除外 | skipVenue除外 | condB除外 |`);
lines.push(`|---|---:|---:|---:|---:|`);
for (const s of roiCands) {
  lines.push(`| ${s.label} | ${fmtRoi(s.roi)} | ${fmtRoi(s.overlapImpact.exclSkip6R.roi)} (n=${s.overlapImpact.exclSkip6R.n}) | ${fmtRoi(s.overlapImpact.exclSkipVenue.roi)} (n=${s.overlapImpact.exclSkipVenue.n}) | ${fmtRoi(s.overlapImpact.exclCondB.roi)} (n=${s.overlapImpact.exclCondB.n}) |`);
}
lines.push(``);
lines.push(`---`);
lines.push(``);

// 各候補詳細
lines.push(`## 各候補詳細`);
lines.push(``);
for (const s of stats) {
  lines.push(`### ${s.label}`);
  lines.push(``);
  lines.push(`| 項目 | 値 |`);
  lines.push(`|---|---|`);
  lines.push(`| n / hits / 的中率 | ${s.n} / ${s.hits} / ${fmtPct(s.hitRate)} |`);
  if (s.roiAvailable) {
    lines.push(`| stake / payout / profit | ${s.stake}円 / ${s.payout.toFixed(0)}円 / ${s.profit.toFixed(0)}円 |`);
    lines.push(`| ROI | **${fmtRoi(s.roi)}** |`);
    lines.push(`| top1除外 / top2除外 ROI | ${fmtRoi(s.top1ExcludeRoi)} / ${fmtRoi(s.top2ExcludeRoi)} |`);
    lines.push(`| avg / med / max 払戻 | ${s.avgPayout?.toFixed(0) ?? "—"}円 / ${s.medPayout?.toFixed(0) ?? "—"}円 / ${s.maxPayout.toFixed(0)}円 |`);
  } else {
    lines.push(`| ROI | — (払戻データなし) |`);
  }
  lines.push(`| 最大連敗 | ${s.maxLosingStreak} |`);
  if (s.avgClosingOdds !== null) lines.push(`| avg closing odds (参考) | ${s.avgClosingOdds.toFixed(2)} |`);
  const r3m = s.recent3mN === 0 ? "— (n=0)" : `${fmtRoi(s.recent3mRoi)} (n=${s.recent3mN})`;
  if (s.roiAvailable) lines.push(`| 直近3ヶ月 ROI | ${r3m} |`);
  lines.push(`| 判定 | **${s.verdict}** — ${s.verdictReasons.join(" / ")} |`);
  lines.push(``);
  if (s.warnings.length > 0) {
    lines.push(`**⚠️ warnings:** ${s.warnings.join(" / ")}`);
    lines.push(``);
  }
  if (s.roiAvailable) {
    lines.push(`**月別 ROI**`);
    lines.push(``);
    lines.push(`| 月 | n | hits | ROI |`);
    lines.push(`|---|---:|---:|---:|`);
    for (const m of Object.keys(s.monthlyRoi).sort()) {
      const mo = s.monthlyRoi[m];
      lines.push(`| ${m} | ${mo.n} | ${mo.hits} | ${fmtRoi(mo.roi)} |`);
    }
    lines.push(``);
    if (s.venueTop.length > 0) {
      lines.push(`**会場別 ROI 上位 (n≥10)**: ${s.venueTop.map(v => `${v.venue} ${fmtRoi(v.roi)} (n=${v.n})`).join(" / ")}`);
      lines.push(``);
    }
  }
  lines.push(`---`);
  lines.push(``);
}

lines.push(`## 注記`);
lines.push(``);
lines.push(`- これは race_payouts 実払戻ベースの backtest。live/T-5 forward ではない`);
lines.push(`- 結果が良くても app_settings / 本番 decision への反映は禁止`);
lines.push(`- 単勝・複勝は払戻データがDBにないため的中率のみ実測 (trifecta当選組番から導出)`);
lines.push(`- 「的中率が高くてもROI<100%」は安定するが期待値なしとして扱う`);
lines.push(`- ROI>100%でも top2除外<100% は高配当依存として watch/reject`);
lines.push(`- 自動投票・購入推奨ではない`);
lines.push(``);
lines.push(`---`);
lines.push(`*生成: analyze-all-bet-types-roi.ts*`);

const md = lines.join("\n");
if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");

// ─── JSON 出力 ────────────────────────────────────────────────────────────────

const jsonOutput = {
  generatedAt: now,
  meta: {
    description: "全券種ROIシミュレーター (1レース100円・実払戻ベース)",
    warningNotForward: "race_payouts実払戻ベースのbacktest。live/T-5 forwardではない",
    warningNoAdoption: "結果が良くてもapp_settings/本番decision反映禁止。購入推奨ではない",
    forwardStart: FORWARD_START,
    unit: UNIT,
    betTypesInDb: betTypesInDb.map(b => b.bet_type),
    winPlacePayoutAvailable: HAS_WIN_PLACE,
    minNForJudge: MIN_N_FOR_JUDGE,
    minHitsForJudge: MIN_HITS_FOR_JUDGE,
    longStreakWarn: LONG_STREAK_WARN,
  },
  overview: {
    forwardRaces: allForwardRaces.length,
    skip6ROverlap: skip6RIds.size,
    skipVenueOverlap: skipVenueIds.size,
    condBOverlap: condBIds.size,
  },
  candidates: stats.map(s => ({
    id: s.id, label: s.label, betType: s.betType, combination: s.combination,
    roiAvailable: s.roiAvailable,
    n: s.n, hits: s.hits,
    hitRate: Math.round(s.hitRate * 10000) / 100,
    stake: s.stake,
    payout: Math.round(s.payout),
    profit: Math.round(s.profit),
    roi: s.roiAvailable ? Math.round(s.roi * 100) / 100 : null,
    avgPayout: s.avgPayout !== null ? Math.round(s.avgPayout) : null,
    medPayout: s.medPayout !== null ? Math.round(s.medPayout) : null,
    maxPayout: Math.round(s.maxPayout),
    maxLosingStreak: s.maxLosingStreak,
    top1ExcludeRoi: s.roiAvailable ? Math.round(s.top1ExcludeRoi * 100) / 100 : null,
    top2ExcludeRoi: s.roiAvailable ? Math.round(s.top2ExcludeRoi * 100) / 100 : null,
    recent3mRoi: s.roiAvailable ? Math.round(s.recent3mRoi * 100) / 100 : null,
    recent3mN: s.recent3mN,
    zeroHitMonths: s.zeroHitMonths,
    avgClosingOdds: s.avgClosingOdds !== null ? Math.round(s.avgClosingOdds * 100) / 100 : null,
    overlapImpact: {
      exclSkip6R:    { n: s.overlapImpact.exclSkip6R.n,    roi: Math.round(s.overlapImpact.exclSkip6R.roi * 100) / 100 },
      exclSkipVenue: { n: s.overlapImpact.exclSkipVenue.n, roi: Math.round(s.overlapImpact.exclSkipVenue.roi * 100) / 100 },
      exclCondB:     { n: s.overlapImpact.exclCondB.n,     roi: Math.round(s.overlapImpact.exclCondB.roi * 100) / 100 },
    },
    monthlyRoi: Object.fromEntries(
      Object.entries(s.monthlyRoi).sort().map(([m, mo]) => [m, { n: mo.n, hits: mo.hits, roi: Math.round(mo.roi * 100) / 100 }])
    ),
    venueTop: s.venueTop.map(v => ({ ...v, roi: Math.round(v.roi * 100) / 100 })),
    warnings: s.warnings,
    verdict: s.verdict,
    verdictReasons: s.verdictReasons,
  })),
  rankings: {
    roi: roiRanking.map(s => s.id),
    hitRate: hitRateRanking.map(s => s.id),
    shortestStreak: streakRanking.map(s => s.id),
    operability: operability.map(o => ({ id: o.s.id, score: Math.round(o.score * 10) / 10 })),
  },
};
writeFileSync(OUT_JSON, JSON.stringify(jsonOutput, null, 2), "utf-8");

// ─── コンソール出力 ───────────────────────────────────────────────────────────

console.log("\n=== 全候補サマリ ===");
for (const s of stats) {
  const roi = s.roiAvailable ? `ROI=${fmtRoi(s.roi)} / top2除外=${fmtRoi(s.top2ExcludeRoi)}` : "ROI=—(データなし)";
  console.log(`  ${s.label}: hit率=${fmtPct(s.hitRate)} / ${roi} / 最大連敗=${s.maxLosingStreak} → ${s.verdict}`);
}
console.log("\n=== 運用しやすさ上位3 ===");
operability.slice(0, 3).forEach((o, i) => {
  console.log(`  ${i+1}. ${o.s.label} (score=${o.score.toFixed(1)})`);
});
console.log();
console.log(`出力: ${OUT_MD}`);
console.log(`出力: ${OUT_JSON}`);
