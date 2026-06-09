/**
 * analyze-ticket-selector-strategies.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 * BUY は検証候補、ROI は検証指標であり購入推奨ではない。
 * 判断基準: race_payouts.payout_yen 実払戻ベース
 *
 * 目的: 条件別券種/買い目セレクター検証
 *   1. 条件別単体買い比較（全券種）
 *   2. 複数点セット合算 ROI 比較
 *   3. train 期間で決めたルールを forward 期間で固定評価
 *   4. 高配当依存・直近失速・重複買い目チェック
 *   5. 1点セレクター / 複数点セレクター / 見送りありセレクター 比較
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/ticket-selector-strategies.md";
const OUT_JSON = "reports/ticket-selector-strategies.json";
const STAKE = 100;
const TRAIN_END = "2025-01-01";   // train: < TRAIN_END, forward: >= TRAIN_END

const EXCLUDED_VENUES   = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACE_NOS = [10, 11, 12];
const EXCL_V = EXCLUDED_VENUES.map(v => `'${v}'`).join(",");
const EXCL_R = EXCLUDED_RACE_NOS.join(",");

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

// 直近3ヶ月: 固定日付ではなく DB最大date - 3ヶ月で算出（データ更新に追従）
const { dbMaxDate } = db.prepare(
  "SELECT MAX(date) as dbMaxDate FROM decision_history WHERE run_kind='historical-backfill' AND result IS NOT NULL"
).get() as { dbMaxDate: string };
const _recent3mDate = new Date(dbMaxDate);
_recent3mDate.setMonth(_recent3mDate.getMonth() - 3);
const RECENT_3M = _recent3mDate.toISOString().slice(0, 10);
console.log(`[ticket-selector] DB最大date: ${dbMaxDate} / 直近3ヶ月基準: ${RECENT_3M}`);

// ─── 型 ──────────────────────────────────────────────────────────────────────

type RaceRow = {
  race_id: string; date: string; venue: string; race_no: number;
  current_odds: number; result: string;
  t123: number; t132: number; trio: number;
  e12: number; e13: number;
  q12: number; q13: number;
  w12: number; w13: number;
  cov_trifecta: number; cov_trio: number; cov_exacta: number;
  cov_quinella: number; cov_wide: number;
};

type BetKey = "t123" | "t132" | "trio" | "e12" | "e13" | "q12" | "q13" | "w12" | "w13";
type CovKey = "cov_trifecta" | "cov_trio" | "cov_exacta" | "cov_quinella" | "cov_wide";

type BetStat = {
  label: string; n: number; hits: number; hitRate: number;
  totalStake: number; totalReturn: number; roi: number; coverage: number;
  maxPayout: number; maxPayoutDate: string; maxPayoutVenue: string; maxPayoutRaceNo: number;
  top1ExclRoi: number; top2ExclRoi: number; top3ExclRoi: number;
};

type SetBetDef = { key: BetKey; label: string };

type SetStat = {
  label: string; bets: string[]; betCount: number;
  n: number; totalBets: number; avgBetsPerRace: number;
  totalStake: number; totalReturn: number; roi: number;
  top1ExclRoi: number; top2ExclRoi: number; top3ExclRoi: number;
  vsBase123Roi: number; improved: boolean;
};

type PeriodStats = {
  train: BetStat; forward: BetStat; recent3m: BetStat; overall: BetStat;
};

type ConditionResult = {
  id: string; label: string;
  singleBets: Record<string, PeriodStats>;
  sets: Record<string, SetStat>;
  setsForward: Record<string, SetStat>;
  n: number; nTrain: number; nForward: number;
  bestTrainBet: string; bestTrainRoi: number;
  bestForwardBet: string; bestForwardRoi: number;
  bestTrainSet: string; bestTrainSetRoi: number;
  verdict: string; trend: string;
};

type SelectorRace = {
  race_id: string; date: string; venue: string; race_no: number;
  matchedCondId: string | null; selectedBetKey: BetKey | null;
  skipped: boolean; skipReason: string;
  returnAmount: number; betCount: number;
};

// ─── WHERE スニペット ──────────────────────────────────────────────────────────

const BASE_WHERE = `
  decision='BUY' AND run_kind='historical-backfill'
  AND result IS NOT NULL AND result != ''
  AND current_odds IS NOT NULL
  AND venue NOT IN (${EXCL_V})
  AND race_no NOT IN (${EXCL_R})
  AND selection='1-2-3'
`;

const EXH1_FASTEST = `EXISTS (
  SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=1
    AND ed.exhibition_time IS NOT NULL
    AND ed.exhibition_time = (SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2 WHERE ed2.race_id=dh.race_id)
)`;

const BOAT3_FASTER = `EXISTS (
  SELECT 1 FROM race_entries re2
  JOIN exhibition_data ed2 ON ed2.race_id=re2.race_id AND ed2.course=re2.entry_course
  JOIN race_entries re3 ON re3.race_id=re2.race_id AND re3.boat=3
  JOIN exhibition_data ed3 ON ed3.race_id=re3.race_id AND ed3.course=re3.entry_course
  WHERE re2.race_id=dh.race_id AND re2.boat=2
    AND ed2.exhibition_time IS NOT NULL AND ed3.exhibition_time IS NOT NULL
    AND ed3.exhibition_time < ed2.exhibition_time
)`;

const BOAT2_FASTER = `EXISTS (
  SELECT 1 FROM race_entries re2
  JOIN exhibition_data ed2 ON ed2.race_id=re2.race_id AND ed2.course=re2.entry_course
  JOIN race_entries re3 ON re3.race_id=re2.race_id AND re3.boat=3
  JOIN exhibition_data ed3 ON ed3.race_id=re3.race_id AND ed3.course=re3.entry_course
  WHERE re2.race_id=dh.race_id AND re2.boat=2
    AND ed2.exhibition_time IS NOT NULL AND ed3.exhibition_time IS NOT NULL
    AND ed2.exhibition_time < ed3.exhibition_time
)`;

const WIND24 = `EXISTS (
  SELECT 1 FROM race_weather rw
  WHERE rw.race_id=dh.race_id AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4
)`;

// ─── 条件定義 ──────────────────────────────────────────────────────────────────

type Condition = { id: string; label: string; where: string };

const CONDITIONS: Condition[] = [
  { id: "A_all",           label: "A. 全体",                       where: "" },
  { id: "B_wind24_exh1",   label: "B. 風速2〜4 × 1号艇展示1位",    where: `(${WIND24}) AND (${EXH1_FASTEST})` },
  { id: "C_suminoe_o4049", label: "C. 住之江 × odds40〜49",         where: "venue='住之江' AND current_odds >= 40 AND current_odds < 50" },
  { id: "D_suminoe_exh1",  label: "D. 住之江 × 1号艇展示1位",       where: `venue='住之江' AND (${EXH1_FASTEST})` },
  { id: "E_suminoe_r5",    label: "E. 住之江 × 5R",                where: "venue='住之江' AND race_no=5" },
  { id: "F_suminoe_o2539", label: "F. 住之江 × odds25〜39",         where: "venue='住之江' AND current_odds >= 25 AND current_odds < 40" },
  { id: "G_race5",         label: "G. 5R",                         where: "race_no=5" },
  { id: "H_odds80",        label: "H. odds80以上",                  where: "current_odds >= 80" },
  { id: "I_exh1",          label: "I. 1号艇展示タイム1位",           where: EXH1_FASTEST },
  { id: "J_boat3faster",   label: "J. 3号艇が2号艇より展示速い",     where: BOAT3_FASTER },
  { id: "K_boat2faster",   label: "K. 2号艇が3号艇より展示速い",     where: BOAT2_FASTER },
  { id: "L_wind24",        label: "L. 風速2〜4m/s 全体",            where: WIND24 },
];

// ─── 買い目定義 ───────────────────────────────────────────────────────────────

const BET_DEFS: { label: string; key: BetKey; covKey: CovKey }[] = [
  { label: "3連単1-2-3", key: "t123", covKey: "cov_trifecta" },
  { label: "3連単1-3-2", key: "t132", covKey: "cov_trifecta" },
  { label: "3連複1-2-3", key: "trio", covKey: "cov_trio" },
  { label: "2連単1-2",   key: "e12",  covKey: "cov_exacta" },
  { label: "2連単1-3",   key: "e13",  covKey: "cov_exacta" },
  { label: "2連複1-2",   key: "q12",  covKey: "cov_quinella" },
  { label: "2連複1-3",   key: "q13",  covKey: "cov_quinella" },
  { label: "拡連複1-2",  key: "w12",  covKey: "cov_wide" },
  { label: "拡連複1-3",  key: "w13",  covKey: "cov_wide" },
];

const BET_LABEL_BY_KEY: Record<BetKey, string> = Object.fromEntries(
  BET_DEFS.map(b => [b.key, b.label])
) as Record<BetKey, string>;

// 複数点セット定義
const SET_DEFS: { label: string; bets: SetBetDef[] }[] = [
  // conservative
  { label: "2連単1-3単体",              bets: [{ key: "e13", label: "2連単1-3" }] },
  { label: "2連複1-3単体",              bets: [{ key: "q13", label: "2連複1-3" }] },
  { label: "2連単1-3+2連複1-3",         bets: [{ key: "e13", label: "2連単1-3" }, { key: "q13", label: "2連複1-3" }] },
  // balanced
  { label: "3連単1-3-2単体",            bets: [{ key: "t132", label: "3連単1-3-2" }] },
  { label: "3連単1-3-2+2連単1-3",       bets: [{ key: "t132", label: "3連単1-3-2" }, { key: "e13", label: "2連単1-3" }] },
  { label: "3連単1-3-2+2連複1-3",       bets: [{ key: "t132", label: "3連単1-3-2" }, { key: "q13", label: "2連複1-3" }] },
  { label: "3連単1-3-2+2連単1-3+2連複1-3", bets: [{ key: "t132", label: "3連単1-3-2" }, { key: "e13", label: "2連単1-3" }, { key: "q13", label: "2連複1-3" }] },
  // hedge
  { label: "3連単1-3-2+3連複1-2-3",     bets: [{ key: "t132", label: "3連単1-3-2" }, { key: "trio", label: "3連複1-2-3" }] },
  { label: "3連単1-3-2+2連単1-3+3連複", bets: [{ key: "t132", label: "3連単1-3-2" }, { key: "e13", label: "2連単1-3" }, { key: "trio", label: "3連複1-2-3" }] },
  { label: "3連単1-3-2+2連複1-3+3連複", bets: [{ key: "t132", label: "3連単1-3-2" }, { key: "q13", label: "2連複1-3" }, { key: "trio", label: "3連複1-2-3" }] },
  // 現行比較
  { label: "3連単1-2-3単体(現行)",       bets: [{ key: "t123", label: "3連単1-2-3" }] },
  { label: "3連単1-2-3+3連単1-3-2",     bets: [{ key: "t123", label: "3連単1-2-3" }, { key: "t132", label: "3連単1-3-2" }] },
  { label: "3連単1-2-3+3連複1-2-3",     bets: [{ key: "t123", label: "3連単1-2-3" }, { key: "trio", label: "3連複1-2-3" }] },
];

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

function r2(v: number): number { return Math.round(v * 100) / 100; }

function computeBetStat(races: RaceRow[], betDef: { label: string; key: BetKey; covKey: CovKey }): BetStat {
  const n = races.length;
  const empty: BetStat = {
    label: betDef.label, n: 0, hits: 0, hitRate: 0,
    totalStake: 0, totalReturn: 0, roi: 0, coverage: 0,
    maxPayout: 0, maxPayoutDate: "", maxPayoutVenue: "", maxPayoutRaceNo: 0,
    top1ExclRoi: 0, top2ExclRoi: 0, top3ExclRoi: 0,
  };
  if (n === 0) return empty;

  const payouts = races.map(r => r[betDef.key] as number);
  const coverage = races.filter(r => r[betDef.covKey] === 1).length;
  const hits = payouts.filter(p => p > 0).length;
  const totalReturn = payouts.reduce((a, b) => a + b, 0);
  const totalStake = n * STAKE;
  const roi = r2(totalReturn / totalStake * 100);
  const maxPayout = Math.max(...payouts, 0);
  const maxIdx = payouts.indexOf(maxPayout);
  const maxRace = maxIdx >= 0 ? races[maxIdx] : null;

  const sorted = [...payouts].sort((a, b) => b - a);
  const top1ExclRoi = r2((totalReturn - (sorted[0] ?? 0)) / totalStake * 100);
  const top2ExclRoi = r2((totalReturn - (sorted[0] ?? 0) - (sorted[1] ?? 0)) / totalStake * 100);
  const top3ExclRoi = r2((totalReturn - (sorted[0] ?? 0) - (sorted[1] ?? 0) - (sorted[2] ?? 0)) / totalStake * 100);

  return {
    label: betDef.label, n, hits,
    hitRate: r2(hits / n * 100),
    totalStake, totalReturn, roi,
    coverage: r2(coverage / n * 100),
    maxPayout, top1ExclRoi, top2ExclRoi, top3ExclRoi,
    maxPayoutDate: maxRace?.date ?? "",
    maxPayoutVenue: maxRace?.venue ?? "",
    maxPayoutRaceNo: maxRace?.race_no ?? 0,
  };
}

function computeSetStat(races: RaceRow[], setLabel: string, bets: SetBetDef[], base123Roi: number): SetStat {
  const n = races.length;
  const betCount = bets.length;
  const totalStake = n * betCount * STAKE;

  if (n === 0) {
    return { label: setLabel, bets: bets.map(b => b.label), betCount, n, totalBets: 0, avgBetsPerRace: betCount, totalStake: 0, totalReturn: 0, roi: 0, top1ExclRoi: 0, top2ExclRoi: 0, top3ExclRoi: 0, vsBase123Roi: 0, improved: false };
  }

  const raceReturns = races.map(r => bets.reduce((sum, b) => sum + (r[b.key] as number), 0));
  const totalReturn = raceReturns.reduce((a, b) => a + b, 0);
  const roi = r2(totalReturn / totalStake * 100);

  const sorted = [...raceReturns].sort((a, b) => b - a);
  const top1ExclRoi = r2((totalReturn - (sorted[0] ?? 0)) / totalStake * 100);
  const top2ExclRoi = r2((totalReturn - (sorted[0] ?? 0) - (sorted[1] ?? 0)) / totalStake * 100);
  const top3ExclRoi = r2((totalReturn - (sorted[0] ?? 0) - (sorted[1] ?? 0) - (sorted[2] ?? 0)) / totalStake * 100);

  return {
    label: setLabel, bets: bets.map(b => b.label), betCount, n,
    totalBets: n * betCount, avgBetsPerRace: betCount,
    totalStake, totalReturn, roi,
    top1ExclRoi, top2ExclRoi, top3ExclRoi,
    vsBase123Roi: r2(roi - base123Roi),
    improved: roi > base123Roi,
  };
}

function computeMonthlyRoi(races: RaceRow[], key: BetKey): { month: string; n: number; hits: number; roi: number }[] {
  const byMonth: Record<string, { n: number; hits: number; totalReturn: number }> = {};
  for (const r of races) {
    const m = r.date.slice(0, 7);
    if (!byMonth[m]) byMonth[m] = { n: 0, hits: 0, totalReturn: 0 };
    byMonth[m].n++;
    const p = r[key] as number;
    if (p > 0) byMonth[m].hits++;
    byMonth[m].totalReturn += p;
  }
  return Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month, n: v.n, hits: v.hits,
      roi: v.n > 0 ? r2(v.totalReturn / (v.n * STAKE) * 100) : 0,
    }));
}

function decideTrend(trainRoi: number, fwdRoi: number): string {
  if (trainRoi >= 100 && fwdRoi >= 100) return "再現";
  if (trainRoi < 100 && fwdRoi >= 100) return "forward急伸";
  if (trainRoi >= 100 && fwdRoi < 95) return "過学習疑い";
  if (trainRoi >= 95 && fwdRoi >= 95) return "方向一致";
  return "reject";
}

function decideVerdict(n: number, roi: number, top2Excl: number): string {
  if (n < 30) return "data-insufficient";
  if (roi >= 105 && n >= 100) return "strong";
  if (roi >= 100 && n >= 100) return "watch";
  if (roi >= 95 && roi < 100) return "weak-watch";
  if (roi < 95) return "reject";
  return "weak-watch";
}

// ─── DBからレース行取得 ───────────────────────────────────────────────────────

function fetchRaces(condWhere: string): RaceRow[] {
  const extra = condWhere ? `AND (${condWhere})` : "";
  return db.prepare(`
    SELECT
      dh.race_id, dh.date, dh.venue, dh.race_no, dh.current_odds, dh.result,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-2-3' LIMIT 1), 0) as t123,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-3-2' LIMIT 1), 0) as t132,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trio' AND rp.combination='1-2-3' LIMIT 1), 0) as trio,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='exacta' AND rp.combination='1-2' LIMIT 1), 0) as e12,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='exacta' AND rp.combination='1-3' LIMIT 1), 0) as e13,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='quinella' AND rp.combination='1-2' LIMIT 1), 0) as q12,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='quinella' AND rp.combination='1-3' LIMIT 1), 0) as q13,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='wide' AND rp.combination='1-2' LIMIT 1), 0) as w12,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='wide' AND rp.combination='1-3' LIMIT 1), 0) as w13,
      CASE WHEN EXISTS (SELECT 1 FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta') THEN 1 ELSE 0 END as cov_trifecta,
      CASE WHEN EXISTS (SELECT 1 FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trio') THEN 1 ELSE 0 END as cov_trio,
      CASE WHEN EXISTS (SELECT 1 FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='exacta') THEN 1 ELSE 0 END as cov_exacta,
      CASE WHEN EXISTS (SELECT 1 FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='quinella') THEN 1 ELSE 0 END as cov_quinella,
      CASE WHEN EXISTS (SELECT 1 FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='wide') THEN 1 ELSE 0 END as cov_wide
    FROM decision_history dh
    WHERE ${BASE_WHERE} ${extra}
    ORDER BY dh.date
  `).all() as RaceRow[];
}

// ─── 条件別フル分析 ───────────────────────────────────────────────────────────

function analyzeCondition(cond: Condition): ConditionResult {
  const allRaces  = fetchRaces(cond.where);
  const trainRaces  = allRaces.filter(r => r.date < TRAIN_END);
  const fwdRaces    = allRaces.filter(r => r.date >= TRAIN_END);
  const recent3mRaces = allRaces.filter(r => r.date >= RECENT_3M);

  const singleBets: Record<string, PeriodStats> = {};
  for (const bd of BET_DEFS) {
    singleBets[bd.label] = {
      overall:  computeBetStat(allRaces,    bd),
      train:    computeBetStat(trainRaces,  bd),
      forward:  computeBetStat(fwdRaces,    bd),
      recent3m: computeBetStat(recent3mRaces, bd),
    };
  }

  const base123TrainRoi = singleBets["3連単1-2-3"].train.roi;
  const base123FwdRoi   = singleBets["3連単1-2-3"].forward.roi;

  const sets: Record<string, SetStat> = {};
  const setsForward: Record<string, SetStat> = {};
  for (const sd of SET_DEFS) {
    sets[sd.label]       = computeSetStat(trainRaces, sd.label, sd.bets, base123TrainRoi);
    setsForward[sd.label] = computeSetStat(fwdRaces,  sd.label, sd.bets, base123FwdRoi);
  }

  // train 期間での best single bet（最大 ROI）
  const trainBetEntries = BET_DEFS.map(bd => ({
    label: bd.label,
    roi: singleBets[bd.label].train.roi,
  }));
  const bestTrain = trainBetEntries.reduce((a, b) => a.roi >= b.roi ? a : b);
  const bestFwd   = BET_DEFS.map(bd => ({ label: bd.label, roi: singleBets[bd.label].forward.roi }))
    .reduce((a, b) => a.roi >= b.roi ? a : b);

  // train 期間での best set
  const trainSetEntries = Object.entries(sets).map(([label, s]) => ({ label, roi: s.roi }));
  const bestTrainSet = trainSetEntries.reduce((a, b) => a.roi >= b.roi ? a : b);

  const fwdStat = singleBets[bestTrain.label].forward;
  const verdict = decideVerdict(fwdStat.n, fwdStat.roi, fwdStat.top2ExclRoi);
  const trend   = decideTrend(singleBets[bestTrain.label].train.roi, fwdStat.roi);

  return {
    id: cond.id, label: cond.label,
    singleBets, sets, setsForward,
    n: allRaces.length,
    nTrain: trainRaces.length,
    nForward: fwdRaces.length,
    bestTrainBet: bestTrain.label, bestTrainRoi: bestTrain.roi,
    bestForwardBet: bestFwd.label, bestForwardRoi: bestFwd.roi,
    bestTrainSet: bestTrainSet.label, bestTrainSetRoi: bestTrainSet.roi,
    verdict, trend,
  };
}

// ─── セレクター分析 ────────────────────────────────────────────────────────────

// 優先順位: skip > B > D > C > E > F > J > K > skip(それ以外)
// H(odds80以上) は常に skip
// G(5R) は skip 候補だが、best bet が 100%以上なら比較対象

type SelectorEntry = {
  condId: string;
  priority: number;
  skip: boolean;
  trainBestBetKey: BetKey;
  trainBestBetRoi: number;
};

function buildSelectorEntries(results: Map<string, ConditionResult>): SelectorEntry[] {
  const entries: SelectorEntry[] = [];

  // 優先順位順（低い数字が先）
  const PRIORITY: { condId: string; priority: number; skip?: boolean }[] = [
    { condId: "H_odds80",       priority: 1, skip: true },
    { condId: "G_race5",        priority: 2, skip: true },
    { condId: "B_wind24_exh1",  priority: 3 },
    { condId: "D_suminoe_exh1", priority: 4 },
    { condId: "C_suminoe_o4049",priority: 5 },
    { condId: "E_suminoe_r5",   priority: 6 },
    { condId: "F_suminoe_o2539",priority: 7 },
    { condId: "J_boat3faster",  priority: 8 },
    { condId: "K_boat2faster",  priority: 9 },
  ];

  for (const p of PRIORITY) {
    const res = results.get(p.condId);
    if (!res) continue;
    const betDef = BET_DEFS.find(b => b.label === res.bestTrainBet);
    const key: BetKey = betDef?.key ?? "t132";
    entries.push({
      condId: p.condId,
      priority: p.priority,
      skip: p.skip ?? false,
      trainBestBetKey: key,
      trainBestBetRoi: res.bestTrainRoi,
    });
  }
  return entries.sort((a, b) => a.priority - b.priority);
}

// 各条件のマッチ判定（WHERE は SQL で既済。ここでは allRaces の subset を使う）
// 全レースのフラグを付与するために、各条件のレース ID セットをキャッシュする
function buildConditionRaceIdSets(results: Map<string, ConditionResult>): Map<string, Set<string>> {
  const sets = new Map<string, Set<string>>();
  for (const [id, res] of results) {
    const ids = new Set<string>();
    for (const bd of BET_DEFS) {
      const ps = res.singleBets[bd.label];
      // n は各期間で変わるが、race_id は overall に入っている
    }
    sets.set(id, ids);
  }
  return sets;
}

// セレクター評価: forward 期間のみで評価（ルールは train で確定）
type SelectorResult = {
  name: string;
  n: number; skipped: number; selected: number; avgBetsPerRace: number;
  totalStake: number; totalReturn: number; roi: number;
  top1ExclRoi: number; top2ExclRoi: number; top3ExclRoi: number;
  recent3mRoi: number;
  trainRoi: number; forwardRoi: number;
};

// ─── セレクター用の全 forward レースデータを一括取得 ──────────────────────────

function fetchAllForwardRaces(): (RaceRow & {
  is_B: number; is_C: number; is_D: number; is_E: number;
  is_F: number; is_G: number; is_H: number; is_I: number;
  is_J: number; is_K: number; is_L: number;
})[] {
  return db.prepare(`
    SELECT
      dh.race_id, dh.date, dh.venue, dh.race_no, dh.current_odds, dh.result,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-2-3' LIMIT 1), 0) as t123,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-3-2' LIMIT 1), 0) as t132,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trio' AND rp.combination='1-2-3' LIMIT 1), 0) as trio,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='exacta' AND rp.combination='1-2' LIMIT 1), 0) as e12,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='exacta' AND rp.combination='1-3' LIMIT 1), 0) as e13,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='quinella' AND rp.combination='1-2' LIMIT 1), 0) as q12,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='quinella' AND rp.combination='1-3' LIMIT 1), 0) as q13,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='wide' AND rp.combination='1-2' LIMIT 1), 0) as w12,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='wide' AND rp.combination='1-3' LIMIT 1), 0) as w13,
      CASE WHEN EXISTS (SELECT 1 FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta') THEN 1 ELSE 0 END as cov_trifecta,
      CASE WHEN EXISTS (SELECT 1 FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trio') THEN 1 ELSE 0 END as cov_trio,
      CASE WHEN EXISTS (SELECT 1 FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='exacta') THEN 1 ELSE 0 END as cov_exacta,
      CASE WHEN EXISTS (SELECT 1 FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='quinella') THEN 1 ELSE 0 END as cov_quinella,
      CASE WHEN EXISTS (SELECT 1 FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='wide') THEN 1 ELSE 0 END as cov_wide,
      CASE WHEN (${WIND24}) AND (${EXH1_FASTEST}) THEN 1 ELSE 0 END as is_B,
      CASE WHEN venue='住之江' AND current_odds >= 40 AND current_odds < 50 THEN 1 ELSE 0 END as is_C,
      CASE WHEN venue='住之江' AND (${EXH1_FASTEST}) THEN 1 ELSE 0 END as is_D,
      CASE WHEN venue='住之江' AND race_no=5 THEN 1 ELSE 0 END as is_E,
      CASE WHEN venue='住之江' AND current_odds >= 25 AND current_odds < 40 THEN 1 ELSE 0 END as is_F,
      CASE WHEN race_no=5 THEN 1 ELSE 0 END as is_G,
      CASE WHEN current_odds >= 80 THEN 1 ELSE 0 END as is_H,
      CASE WHEN (${EXH1_FASTEST}) THEN 1 ELSE 0 END as is_I,
      CASE WHEN (${BOAT3_FASTER}) THEN 1 ELSE 0 END as is_J,
      CASE WHEN (${BOAT2_FASTER}) THEN 1 ELSE 0 END as is_K,
      CASE WHEN (${WIND24}) THEN 1 ELSE 0 END as is_L
    FROM decision_history dh
    WHERE ${BASE_WHERE} AND dh.date >= '${TRAIN_END}'
    ORDER BY dh.date
  `).all() as (RaceRow & {
    is_B: number; is_C: number; is_D: number; is_E: number;
    is_F: number; is_G: number; is_H: number; is_I: number;
    is_J: number; is_K: number; is_L: number;
  })[];
}

function fetchAllTrainRaces(): (RaceRow & {
  is_B: number; is_C: number; is_D: number; is_E: number;
  is_F: number; is_G: number; is_H: number; is_I: number;
  is_J: number; is_K: number; is_L: number;
})[] {
  return db.prepare(`
    SELECT
      dh.race_id, dh.date, dh.venue, dh.race_no, dh.current_odds, dh.result,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-2-3' LIMIT 1), 0) as t123,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-3-2' LIMIT 1), 0) as t132,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trio' AND rp.combination='1-2-3' LIMIT 1), 0) as trio,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='exacta' AND rp.combination='1-2' LIMIT 1), 0) as e12,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='exacta' AND rp.combination='1-3' LIMIT 1), 0) as e13,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='quinella' AND rp.combination='1-2' LIMIT 1), 0) as q12,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='quinella' AND rp.combination='1-3' LIMIT 1), 0) as q13,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='wide' AND rp.combination='1-2' LIMIT 1), 0) as w12,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='wide' AND rp.combination='1-3' LIMIT 1), 0) as w13,
      CASE WHEN EXISTS (SELECT 1 FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta') THEN 1 ELSE 0 END as cov_trifecta,
      CASE WHEN EXISTS (SELECT 1 FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trio') THEN 1 ELSE 0 END as cov_trio,
      CASE WHEN EXISTS (SELECT 1 FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='exacta') THEN 1 ELSE 0 END as cov_exacta,
      CASE WHEN EXISTS (SELECT 1 FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='quinella') THEN 1 ELSE 0 END as cov_quinella,
      CASE WHEN EXISTS (SELECT 1 FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='wide') THEN 1 ELSE 0 END as cov_wide,
      CASE WHEN (${WIND24}) AND (${EXH1_FASTEST}) THEN 1 ELSE 0 END as is_B,
      CASE WHEN venue='住之江' AND current_odds >= 40 AND current_odds < 50 THEN 1 ELSE 0 END as is_C,
      CASE WHEN venue='住之江' AND (${EXH1_FASTEST}) THEN 1 ELSE 0 END as is_D,
      CASE WHEN venue='住之江' AND race_no=5 THEN 1 ELSE 0 END as is_E,
      CASE WHEN venue='住之江' AND current_odds >= 25 AND current_odds < 40 THEN 1 ELSE 0 END as is_F,
      CASE WHEN race_no=5 THEN 1 ELSE 0 END as is_G,
      CASE WHEN current_odds >= 80 THEN 1 ELSE 0 END as is_H,
      CASE WHEN (${EXH1_FASTEST}) THEN 1 ELSE 0 END as is_I,
      CASE WHEN (${BOAT3_FASTER}) THEN 1 ELSE 0 END as is_J,
      CASE WHEN (${BOAT2_FASTER}) THEN 1 ELSE 0 END as is_K,
      CASE WHEN (${WIND24}) THEN 1 ELSE 0 END as is_L
    FROM decision_history dh
    WHERE ${BASE_WHERE} AND dh.date < '${TRAIN_END}'
    ORDER BY dh.date
  `).all() as (RaceRow & {
    is_B: number; is_C: number; is_D: number; is_E: number;
    is_F: number; is_G: number; is_H: number; is_I: number;
    is_J: number; is_K: number; is_L: number;
  })[];
}

type AnnotatedRace = RaceRow & {
  is_B: number; is_C: number; is_D: number; is_E: number;
  is_F: number; is_G: number; is_H: number; is_I: number;
  is_J: number; is_K: number; is_L: number;
};

function computeSelector1Point(
  races: AnnotatedRace[],
  entries: SelectorEntry[],
  label: string
): SelectorResult {
  let totalStake = 0; let totalReturn = 0;
  let selected = 0; let skipped = 0;
  const returns: number[] = [];
  const recent3m: number[] = [];

  for (const r of races) {
    let chosenKey: BetKey | null = null;
    let isSkipped = false;

    for (const e of entries) {
      let matches = false;
      if (e.condId === "B_wind24_exh1") matches = r.is_B === 1;
      else if (e.condId === "C_suminoe_o4049") matches = r.is_C === 1;
      else if (e.condId === "D_suminoe_exh1") matches = r.is_D === 1;
      else if (e.condId === "E_suminoe_r5") matches = r.is_E === 1;
      else if (e.condId === "F_suminoe_o2539") matches = r.is_F === 1;
      else if (e.condId === "G_race5") matches = r.is_G === 1;
      else if (e.condId === "H_odds80") matches = r.is_H === 1;
      else if (e.condId === "J_boat3faster") matches = r.is_J === 1;
      else if (e.condId === "K_boat2faster") matches = r.is_K === 1;

      if (matches) {
        if (e.skip) { isSkipped = true; break; }
        chosenKey = e.trainBestBetKey;
        break;
      }
    }

    if (isSkipped || chosenKey === null) {
      skipped++;
      continue;
    }

    const ret = r[chosenKey] as number;
    totalStake += STAKE;
    totalReturn += ret;
    returns.push(ret);
    selected++;
    if (r.date >= RECENT_3M) recent3m.push(ret);
  }

  const n = races.length;
  const roi = totalStake > 0 ? r2(totalReturn / totalStake * 100) : 0;
  const sorted = [...returns].sort((a, b) => b - a);
  const top1ExclRoi = totalStake > STAKE ? r2((totalReturn - (sorted[0] ?? 0)) / (totalStake - STAKE) * 100) : 0;
  const top2ExclRoi = totalStake > 2*STAKE ? r2((totalReturn - (sorted[0] ?? 0) - (sorted[1] ?? 0)) / (totalStake - 2*STAKE) * 100) : 0;
  const top3ExclRoi = totalStake > 3*STAKE ? r2((totalReturn - (sorted[0] ?? 0) - (sorted[1] ?? 0) - (sorted[2] ?? 0)) / (totalStake - 3*STAKE) * 100) : 0;
  const r3mStake = recent3m.length * STAKE;
  const recent3mRoi = r3mStake > 0 ? r2(recent3m.reduce((a, b) => a + b, 0) / r3mStake * 100) : 0;

  return { name: label, n, skipped, selected, avgBetsPerRace: 1, totalStake, totalReturn, roi, top1ExclRoi, top2ExclRoi, top3ExclRoi, recent3mRoi, trainRoi: 0, forwardRoi: 0 };
}

function computeSelectorMultiPoint(
  races: AnnotatedRace[],
  results: Map<string, ConditionResult>,
  entries: SelectorEntry[],
  label: string
): SelectorResult {
  let totalStake = 0; let totalReturn = 0;
  let selected = 0; let skipped = 0;
  let totalBetsPlaced = 0;
  const raceReturns: number[] = [];
  const recent3mReturns: number[] = [];

  for (const r of races) {
    const matchedCondIds: string[] = [];
    let isSkipped = false;

    // H(odds80) は常に skip
    if (r.is_H === 1) { isSkipped = true; }

    if (!isSkipped) {
      if (r.is_B === 1) matchedCondIds.push("B_wind24_exh1");
      if (r.is_C === 1) matchedCondIds.push("C_suminoe_o4049");
      if (r.is_D === 1) matchedCondIds.push("D_suminoe_exh1");
      if (r.is_E === 1) matchedCondIds.push("E_suminoe_r5");
      if (r.is_F === 1) matchedCondIds.push("F_suminoe_o2539");
      if (r.is_J === 1) matchedCondIds.push("J_boat3faster");
      if (r.is_K === 1) matchedCondIds.push("K_boat2faster");
    }

    if (isSkipped || matchedCondIds.length === 0) {
      skipped++;
      continue;
    }

    // 各条件の best set のベットキーを収集（重複除去）
    const betKeys = new Set<BetKey>();
    for (const condId of matchedCondIds) {
      const res = results.get(condId);
      if (!res) continue;
      const sd = SET_DEFS.find(s => s.label === res.bestTrainSet);
      if (sd) {
        for (const b of sd.bets) betKeys.add(b.key);
      } else {
        // セット見つからなければ single best bet
        const bd = BET_DEFS.find(b => b.label === res.bestTrainBet);
        if (bd) betKeys.add(bd.key);
      }
    }

    if (betKeys.size === 0) { skipped++; continue; }

    const raceReturn = [...betKeys].reduce((sum, k) => sum + (r[k] as number), 0);
    const raceCost = betKeys.size * STAKE;
    totalStake += raceCost;
    totalReturn += raceReturn;
    totalBetsPlaced += betKeys.size;
    raceReturns.push(raceReturn);
    if (r.date >= RECENT_3M) recent3mReturns.push(raceReturn);
    selected++;
  }

  const n = races.length;
  const roi = totalStake > 0 ? r2(totalReturn / totalStake * 100) : 0;
  const sorted = [...raceReturns].sort((a, b) => b - a);
  // 除外ROIはレース単位（上位レースを除外）
  const avgCost = selected > 0 ? totalStake / selected : STAKE;
  const top1ExclRoi = totalStake > avgCost ? r2((totalReturn - (sorted[0] ?? 0)) / (totalStake - avgCost) * 100) : 0;
  const top2ExclRoi = totalStake > 2*avgCost ? r2((totalReturn - (sorted[0] ?? 0) - (sorted[1] ?? 0)) / (totalStake - 2*avgCost) * 100) : 0;
  const top3ExclRoi = totalStake > 3*avgCost ? r2((totalReturn - (sorted[0] ?? 0) - (sorted[1] ?? 0) - (sorted[2] ?? 0)) / (totalStake - 3*avgCost) * 100) : 0;
  const r3mStake = recent3mReturns.length * avgCost;
  const recent3mRoi = r3mStake > 0 ? r2(recent3mReturns.reduce((a, b) => a + b, 0) / r3mStake * 100) : 0;
  const avgBetsPerRace = selected > 0 ? r2(totalBetsPlaced / selected) : 0;

  return { name: label, n, skipped, selected, avgBetsPerRace, totalStake, totalReturn, roi, top1ExclRoi, top2ExclRoi, top3ExclRoi, recent3mRoi, trainRoi: 0, forwardRoi: 0 };
}

// ─── 重複レース分析 ───────────────────────────────────────────────────────────

type OverlapStats = {
  totalRaces: number;
  singleCondition: number;
  multiCondition: number;
  condOverlap: { conds: string; count: number }[];
};

function analyzeOverlap(races: AnnotatedRace[]): OverlapStats {
  const overlapCount: Record<string, number> = {};
  let singleCondition = 0; let multiCondition = 0;

  for (const r of races) {
    const matched: string[] = [];
    if (r.is_B === 1) matched.push("B");
    if (r.is_C === 1) matched.push("C");
    if (r.is_D === 1) matched.push("D");
    if (r.is_E === 1) matched.push("E");
    if (r.is_F === 1) matched.push("F");
    if (r.is_J === 1) matched.push("J");
    if (r.is_K === 1) matched.push("K");

    if (matched.length === 0) continue;
    if (matched.length === 1) singleCondition++;
    else multiCondition++;

    const key = matched.sort().join("+");
    overlapCount[key] = (overlapCount[key] ?? 0) + 1;
  }

  const condOverlap = Object.entries(overlapCount)
    .sort(([, a], [, b]) => b - a)
    .map(([conds, count]) => ({ conds, count }));

  return {
    totalRaces: races.length,
    singleCondition, multiCondition,
    condOverlap,
  };
}

// ─── メイン実行 ───────────────────────────────────────────────────────────────

console.log("[ticket-selector] 分析開始...");

const results = new Map<string, ConditionResult>();
for (const cond of CONDITIONS) {
  process.stdout.write(`  ${cond.id}... `);
  const r = analyzeCondition(cond);
  results.set(cond.id, r);
  const best = r.singleBets[r.bestTrainBet];
  console.log(`n=${r.n}(train=${r.nTrain}/fwd=${r.nForward}) best=${r.bestTrainBet}(train=${r.bestTrainRoi}%/fwd=${best.forward.roi}%) [${r.trend}]`);
}

console.log("\n[ticket-selector] セレクター用レース一括取得...");
const fwdRaces   = fetchAllForwardRaces();
const trainRaces = fetchAllTrainRaces();
console.log(`  forward: ${fwdRaces.length}件, train: ${trainRaces.length}件`);

const selectorEntries = buildSelectorEntries(results);

console.log("\n[ticket-selector] セレクター計算...");
const sel1PointFwd  = computeSelector1Point(fwdRaces,   selectorEntries, "1点セレクター(forward)");
const sel1PointTrain = computeSelector1Point(trainRaces, selectorEntries, "1点セレクター(train)");
const selMultiFwd    = computeSelectorMultiPoint(fwdRaces,   results, selectorEntries, "複数点セレクター(forward)");
const selMultiTrain  = computeSelectorMultiPoint(trainRaces, results, selectorEntries, "複数点セレクター(train)");

// overlap 分析
const overlapFwd   = analyzeOverlap(fwdRaces);
const overlapTrain = analyzeOverlap(trainRaces);

// ─── Markdown 生成 ────────────────────────────────────────────────────────────

console.log("\n[ticket-selector] レポート生成...");

function fmtRoi(v: number): string { return `${v}%`; }
function fmtN(n: number): string { return n < 30 ? `**${n}**⚠️` : `${n}`; }
function fmtVerdict(v: string): string {
  if (v === "strong") return "✅ strong";
  if (v === "watch") return "👀 watch";
  if (v === "weak-watch") return "⚠️ weak-watch";
  if (v === "reject") return "❌ reject";
  if (v === "data-insufficient") return "🔍 n不足";
  return v;
}

let md = `# 条件別券種/買い目セレクター検証レポート

生成日時: ${new Date().toISOString()}
DB: ${DB_PATH}
対象期間: train < ${TRAIN_END} / forward >= ${TRAIN_END}
直近3ヶ月基準: >= ${RECENT_3M} (DB最大date ${dbMaxDate} から逆算)

> **読み取り専用分析。BUY は検証候補、ROI は検証指標。購入指示ではない。**
> ROI 評価基準: race_payouts.payout_yen 実払戻ベース
> 投資額基準: 1買い目 100円、複数点セットは「買い目数 × 100円」が分母

---

## A. 全体結論

`;

// 全体の結論を先に出す
const allRes = results.get("A_all")!;
const allTrain = allRes.singleBets["3連単1-2-3"].train;
const allFwd   = allRes.singleBets["3連単1-2-3"].forward;

md += `| 指標 | 値 |
|---|---|
| 全体 n | ${allRes.n} (train=${allRes.nTrain} / forward=${allRes.nForward}) |
| 現行 3連単1-2-3 train ROI | ${allTrain.roi}% |
| 現行 3連単1-2-3 forward ROI | ${allFwd.roi}% |
| 現行 3連単1-2-3 trend | ${allRes.trend} |
| 1点セレクター forward ROI | ${sel1PointFwd.roi}% (対象${sel1PointFwd.selected}件/見送り${sel1PointFwd.skipped}件) |
| 複数点セレクター forward ROI | ${selMultiFwd.roi}% (対象${selMultiFwd.selected}件/見送り${selMultiFwd.skipped}件) |

`;

md += `---

## B. 条件別ベスト単体買い（train → forward 固定評価）

| 条件 | n | train n | fwd n | train best bet | train ROI | fwd ROI (同bet) | top2除外 ROI | 判定 | trend |
|---|---|---|---|---|---|---|---|---|---|
`;

for (const [id, res] of results) {
  const best = res.singleBets[res.bestTrainBet];
  md += `| ${res.label} | ${res.n} | ${res.nTrain} | ${fmtN(res.nForward)} | ${res.bestTrainBet} | ${res.bestTrainRoi}% | ${best.forward.roi}% | ${best.forward.top2ExclRoi}% | ${fmtVerdict(res.verdict)} | ${res.trend} |\n`;
}

md += `
---

## C. 条件別 全単体買い ROI 一覧

`;

for (const [id, res] of results) {
  md += `### ${res.label} (n=${res.n} / train=${res.nTrain} / forward=${res.nForward})

#### 単体買い（全期間）

| 買い目 | n | hits | hitRate | ROI | coverage | 最大払戻 | top1除外 | top2除外 | top3除外 |
|---|---|---|---|---|---|---|---|---|---|
`;
  for (const bd of BET_DEFS) {
    const s = res.singleBets[bd.label].overall;
    md += `| ${s.label} | ${s.n} | ${s.hits} | ${s.hitRate}% | **${s.roi}%** | ${s.coverage}% | ${s.maxPayout.toLocaleString()}円 | ${s.top1ExclRoi}% | ${s.top2ExclRoi}% | ${s.top3ExclRoi}% |\n`;
  }

  md += `
#### train / forward 比較（各期間でその買い目が選ばれた場合）

| 買い目 | train n | train ROI | fwd n | fwd ROI | fwd top2除外 | 直近3M ROI | trend |
|---|---|---|---|---|---|---|---|
`;
  for (const bd of BET_DEFS) {
    const ps = res.singleBets[bd.label];
    const trend = decideTrend(ps.train.roi, ps.forward.roi);
    md += `| ${bd.label} | ${ps.train.n} | ${ps.train.roi}% | ${fmtN(ps.forward.n)} | ${ps.forward.roi}% | ${ps.forward.top2ExclRoi}% | ${ps.recent3m.roi}% | ${trend} |\n`;
  }

  md += `\n`;
}

md += `---

## D. 複数点セット合算 ROI（train期間）

| 条件 | セット | betCount | n | totalStake | totalReturn | ROI | vs現行 | top1除外 | top2除外 | top3除外 |
|---|---|---|---|---|---|---|---|---|---|---|
`;

for (const [id, res] of results) {
  for (const [setLabel, s] of Object.entries(res.sets)) {
    const improved = s.improved ? "↑" : "↓";
    md += `| ${res.label} | ${s.label} | ${s.betCount} | ${s.n} | ${s.totalStake.toLocaleString()} | ${s.totalReturn.toLocaleString()} | **${s.roi}%** | ${s.vsBase123Roi > 0 ? "+" : ""}${s.vsBase123Roi}%${improved} | ${s.top1ExclRoi}% | ${s.top2ExclRoi}% | ${s.top3ExclRoi}% |\n`;
  }
}

md += `
---

## E. 複数点セット合算 ROI（forward期間）

| 条件 | セット | betCount | n | ROI | vs現行 | top2除外 |
|---|---|---|---|---|---|---|
`;

for (const [id, res] of results) {
  for (const [setLabel, s] of Object.entries(res.setsForward)) {
    const improved = s.improved ? "↑" : "↓";
    md += `| ${res.label} | ${s.label} | ${s.betCount} | ${s.n} | **${s.roi}%** | ${s.vsBase123Roi > 0 ? "+" : ""}${s.vsBase123Roi}%${improved} | ${s.top2ExclRoi}% |\n`;
  }
}

md += `
---

## F. セレクター比較（train で決めたルールを forward に固定）

### 優先順位ルール（train期間で設定）

| 優先順位 | 条件 | 採用/見送り | 採用買い目 | train ROI |
|---|---|---|---|---|
`;

for (const e of selectorEntries) {
  const res = results.get(e.condId);
  const label = res?.label ?? e.condId;
  const action = e.skip ? "見送り" : `${BET_LABEL_BY_KEY[e.trainBestBetKey]} 採用`;
  const trainRoi = e.skip ? "-" : `${e.trainBestBetRoi}%`;
  md += `| ${e.priority} | ${label} | ${action} | ${e.skip ? "-" : BET_LABEL_BY_KEY[e.trainBestBetKey]} | ${trainRoi} |\n`;
}

md += `
### セレクター結果比較

| セレクター | 対象n | 見送りn | 総投資 | 総払戻 | ROI | 1R平均買い目 | top1除外 | top2除外 | top3除外 | 直近3M ROI |
|---|---|---|---|---|---|---|---|---|---|---|
| 1点セレクター(train) | ${sel1PointTrain.selected} | ${sel1PointTrain.skipped} | ${sel1PointTrain.totalStake.toLocaleString()} | ${sel1PointTrain.totalReturn.toLocaleString()} | **${sel1PointTrain.roi}%** | 1.0 | ${sel1PointTrain.top1ExclRoi}% | ${sel1PointTrain.top2ExclRoi}% | ${sel1PointTrain.top3ExclRoi}% | - |
| 1点セレクター(forward) | ${sel1PointFwd.selected} | ${sel1PointFwd.skipped} | ${sel1PointFwd.totalStake.toLocaleString()} | ${sel1PointFwd.totalReturn.toLocaleString()} | **${sel1PointFwd.roi}%** | 1.0 | ${sel1PointFwd.top1ExclRoi}% | ${sel1PointFwd.top2ExclRoi}% | ${sel1PointFwd.top3ExclRoi}% | ${sel1PointFwd.recent3mRoi}% |
| 複数点セレクター(train) | ${selMultiTrain.selected} | ${selMultiTrain.skipped} | ${selMultiTrain.totalStake.toLocaleString()} | ${selMultiTrain.totalReturn.toLocaleString()} | **${selMultiTrain.roi}%** | ${selMultiTrain.avgBetsPerRace} | ${selMultiTrain.top1ExclRoi}% | ${selMultiTrain.top2ExclRoi}% | ${selMultiTrain.top3ExclRoi}% | - |
| 複数点セレクター(forward) | ${selMultiFwd.selected} | ${selMultiFwd.skipped} | ${selMultiFwd.totalStake.toLocaleString()} | ${selMultiFwd.totalReturn.toLocaleString()} | **${selMultiFwd.roi}%** | ${selMultiFwd.avgBetsPerRace} | ${selMultiFwd.top1ExclRoi}% | ${selMultiFwd.top2ExclRoi}% | ${selMultiFwd.top3ExclRoi}% | ${selMultiFwd.recent3mRoi}% |
| 現行全件3連単1-2-3(train) | ${allTrain.n} | 0 | ${allTrain.totalStake.toLocaleString()} | ${allTrain.totalReturn.toLocaleString()} | **${allTrain.roi}%** | 1.0 | ${allTrain.top1ExclRoi}% | ${allTrain.top2ExclRoi}% | ${allTrain.top3ExclRoi}% | - |
| 現行全件3連単1-2-3(forward) | ${allFwd.n} | 0 | ${allFwd.totalStake.toLocaleString()} | ${allFwd.totalReturn.toLocaleString()} | **${allFwd.roi}%** | 1.0 | ${allFwd.top1ExclRoi}% | ${allFwd.top2ExclRoi}% | ${allFwd.top3ExclRoi}% | - |

`;

md += `---

## G. 重複レース分析

### forward 期間

- 対象 forward レース数: ${overlapFwd.totalRaces}
- 単一条件のみ: ${overlapFwd.singleCondition}件
- 複数条件重複: ${overlapFwd.multiCondition}件
- 重複比率: ${overlapFwd.totalRaces > 0 ? r2(overlapFwd.multiCondition / overlapFwd.totalRaces * 100) : 0}%

#### 重複パターン Top10

| 条件組み合わせ | 件数 |
|---|---|
${overlapFwd.condOverlap.slice(0, 10).map(o => `| ${o.conds} | ${o.count} |`).join("\n")}

### train 期間

- 対象 train レース数: ${overlapTrain.totalRaces}
- 単一条件のみ: ${overlapTrain.singleCondition}件
- 複数条件重複: ${overlapTrain.multiCondition}件

---

## H. 採用候補分類

`;

// 分類
// 判定ルール:
//   n<30 → data-insufficient (trainが高ROIでも "過学習疑い" にしない。n不足で判断不能)
//     ただし train ROI >= 150% の場合は ※過学習リスク を付記
//   n>=30 で train高ROI + forward 0% → 過学習疑い (n>=50 で確定的に判断)
//   条件B(B_wind24_exh1) → 3連単1-3-2 が forward急伸monitor 候補として別管理
const paperForward: string[] = [];
const upgradeWait: string[] = [];
const dataInsufficient: string[] = [];
const fwdRisingMonitor: string[] = []; // forward急伸 で monitor対象（セレクター採用はしない）
const fwdRising: string[] = [];        // forward急伸 その他
const overfit: string[] = [];
const degraded: string[] = [];
const skipped2: string[] = [];
const rejected: string[] = [];

// 条件B の 3連単1-3-2 は「forward急伸monitor」として別枠で管理
const condB = results.get("B_wind24_exh1");
if (condB) {
  const t132fwd   = condB.singleBets["3連単1-3-2"].forward;
  const t132train = condB.singleBets["3連単1-3-2"].train;
  fwdRisingMonitor.push(
    `${condB.label} [3連単1-3-2] train=${t132train.roi}%/fwd=${t132fwd.roi}% top2除外=${t132fwd.top2ExclRoi}% n(fwd)=${t132fwd.n}`
  );
}

for (const [id, res] of results) {
  if (id === "A_all") continue;
  if (id === "B_wind24_exh1") continue; // 上で別管理
  const fwdN    = res.nForward;
  const trainN  = res.nTrain;
  const best    = res.singleBets[res.bestTrainBet];
  const fwdRoi  = best.forward.roi;
  const trainRoi = best.train.roi;
  const top2    = best.forward.top2ExclRoi;

  // n<30: data-insufficient (trainROI高くても過学習疑いとは断定しない)
  if (fwdN < 30) {
    const suffix = trainRoi >= 150 ? " ※過学習リスク(trainROI高+n不足)" : "";
    dataInsufficient.push(`${res.label}${suffix}`);
    continue;
  }
  if (id === "H_odds80" || id === "G_race5") { skipped2.push(res.label); continue; }
  if (res.trend === "forward急伸") { fwdRising.push(res.label); continue; }
  // 過学習疑い: n>=30 かつ train>=100% かつ forward<95%
  if (trainRoi >= 100 && fwdRoi < 95) { overfit.push(res.label); continue; }
  if (res.trend === "reject" && fwdRoi < 95) { rejected.push(res.label); continue; }
  if (fwdRoi >= 100 && top2 >= 100 && fwdN >= 30) { paperForward.push(res.label); continue; }
  if (fwdRoi >= 100 && fwdN < 200) { upgradeWait.push(res.label); continue; }
  if (fwdRoi < 95) { degraded.push(res.label); continue; }
  upgradeWait.push(res.label);
}

md += `| 分類 | 条件 |
|---|---|
| paper-forward候補 | ${paperForward.length > 0 ? paperForward.join("<br>") : "なし"} |
| 格上げ待ち | ${upgradeWait.length > 0 ? upgradeWait.join("<br>") : "なし"} |
| forward急伸monitor(セレクター不採用) | ${fwdRisingMonitor.length > 0 ? fwdRisingMonitor.join("<br>") : "なし"} |
| forward急伸(その他) | ${fwdRising.length > 0 ? fwdRising.join("<br>") : "なし"} |
| data-insufficient(n<30) | ${dataInsufficient.length > 0 ? dataInsufficient.join("<br>") : "なし"} |
| 過学習疑い(n>=30+trainROI高+fwd低) | ${overfit.length > 0 ? overfit.join("<br>") : "なし"} |
| 降格候補 | ${degraded.length > 0 ? degraded.join("<br>") : "なし"} |
| 見送り候補 | ${skipped2.length > 0 ? skipped2.join("<br>") : "なし"} |
| 採用しない | ${rejected.length > 0 ? rejected.join("<br>") : "なし"} |

> **条件B 3連単1-3-2 について**: セレクターとしては不採用（trainROI=66%のため train最良ではなく選ばれない）。
> ただし forward急伸(train=66%/fwd=174%)として monitor継続。top2除外=91%のため格上げ条件（>=100%）未達。
> n=200到達後に再判定。

`;

md += `---

## I. 注意事項

- n<30: 判定不可
- n<50: 要確認
- n>=100: 継続/降格判断可能
- 最大2件除外 ROI < 100%: 本採用候補にしない
- forward直近3ヶ月 ROI = 0%: 降格警戒
- app_settings 変更はしない。paper-forward 観察のみ。

---

## J. 最終結論

### 条件別最良買い目まとめ

| 条件 | best train bet | train ROI | fwd ROI | fwd top2除外 | 判定 | 結論 |
|---|---|---|---|---|---|---|
`;

for (const [id, res] of results) {
  if (id === "A_all") continue;
  const best = res.singleBets[res.bestTrainBet];
  let conclusion = "";
  if (res.verdict === "data-insufficient") conclusion = "判定不可(n不足)";
  else if (id === "H_odds80") conclusion = "見送り推奨";
  else if (id === "G_race5") conclusion = "見送り推奨";
  else if (res.trend === "forward急伸") conclusion = "高配当依存チェック要";
  else if (res.trend === "過学習疑い") conclusion = "過学習疑い→要監視";
  else if (res.trend === "再現") conclusion = "再現confirmed";
  else if (best.forward.roi >= 100) conclusion = "forward観察継続";
  else conclusion = "弱い→見送り検討";
  md += `| ${res.label} | ${res.bestTrainBet} | ${res.bestTrainRoi}% | ${best.forward.roi}% | ${best.forward.top2ExclRoi}% | ${fmtVerdict(res.verdict)} | ${conclusion} |\n`;
}

md += `
### 複数点買いは得か

| 比較 | 単体 ROI (fwd) | 複数点 ROI (fwd) | 判定 |
|---|---|---|---|
`;

for (const [id, res] of results) {
  if (id === "A_all") continue;
  const bestSingle = res.singleBets[res.bestTrainBet].forward.roi;
  const bestSetLabel = res.bestTrainSet;
  const bestSetFwd = res.setsForward[bestSetLabel]?.roi ?? 0;
  const improved = bestSetFwd > bestSingle ? "✅ セット有利" : "❌ 単体有利";
  md += `| ${res.label} | ${bestSingle}% | ${bestSetFwd}% (${bestSetLabel}) | ${improved} |\n`;
}

md += `
---
*生成: analyze-ticket-selector-strategies.ts*
`;

// ─── JSON 出力 ────────────────────────────────────────────────────────────────

const jsonOutput = {
  generatedAt: new Date().toISOString(),
  trainEnd: TRAIN_END,
  recent3m: RECENT_3M,
  conditions: Object.fromEntries(results.entries()),
  selectors: {
    onePt: { train: sel1PointTrain, forward: sel1PointFwd },
    multiPt: { train: selMultiTrain, forward: selMultiFwd },
  },
  overlap: { train: overlapTrain, forward: overlapFwd },
  classification: {
    paperForward, upgradeWait, dataInsufficient,
    fwdRisingMonitor, fwdRising, overfit, degraded, skipped: skipped2, rejected,
  },
};

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");
writeFileSync(OUT_JSON, JSON.stringify(jsonOutput, null, 2), "utf-8");

console.log(`\n[ticket-selector] 完了`);
console.log(`  → ${OUT_MD}`);
console.log(`  → ${OUT_JSON}`);

// 要約表示
console.log("\n=== サマリー ===");
console.log("現行全件 3連単1-2-3:");
console.log(`  train ROI = ${allTrain.roi}%  /  forward ROI = ${allFwd.roi}%`);
console.log("\n1点セレクター (forward):");
console.log(`  対象=${sel1PointFwd.selected}件 / 見送り=${sel1PointFwd.skipped}件 / ROI=${sel1PointFwd.roi}% / top2除外=${sel1PointFwd.top2ExclRoi}% / 直近3M=${sel1PointFwd.recent3mRoi}%`);
console.log("\n複数点セレクター (forward):");
console.log(`  対象=${selMultiFwd.selected}件 / 見送り=${selMultiFwd.skipped}件 / 平均bet=${selMultiFwd.avgBetsPerRace} / ROI=${selMultiFwd.roi}% / top2除外=${selMultiFwd.top2ExclRoi}% / 直近3M=${selMultiFwd.recent3mRoi}%`);
console.log("\n条件別 forward best bet:");
for (const [id, res] of results) {
  if (id === "A_all") continue;
  const best = res.singleBets[res.bestTrainBet];
  console.log(`  ${res.label}: ${res.bestTrainBet} → fwd ROI=${best.forward.roi}% (top2=${best.forward.top2ExclRoi}%) [${res.trend}]`);
}
console.log("\n採用候補分類:");
console.log(`  paper-forward候補: ${paperForward.length > 0 ? paperForward.join(", ") : "なし"}`);
console.log(`  格上げ待ち: ${upgradeWait.length > 0 ? upgradeWait.join(", ") : "なし"}`);
console.log(`  forward急伸monitor(セレクター不採用): ${fwdRisingMonitor.join(", ") || "なし"}`);
console.log(`  data-insufficient(n<30): ${dataInsufficient.join(", ") || "なし"}`);
console.log(`  過学習疑い(n>=30): ${overfit.join(", ") || "なし"}`);
console.log(`  降格候補: ${degraded.join(", ") || "なし"}`);
console.log(`  forward急伸(その他): ${fwdRising.join(", ") || "なし"}`);
