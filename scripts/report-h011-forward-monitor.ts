/**
 * report-h011-forward-monitor.ts — 読み取り専用
 *
 * 禁止: DBへのINSERT/UPDATE/DELETE/DROP, app_settings変更, 本番decision変更
 * 禁止: 自動投票・ログイン保存・投票サイト操作・購入推奨
 * BUY は検証候補、ROI は検証指標であり購入推奨ではない。
 *
 * 目的: H011「1-4系 市場過小評価」仮説を forward (2026-06以降) で固定監視する。
 *   ⚠️ これは「未来データで H011 を検証する箱」であり、条件を足して勝てる条件を
 *   探すツールではない。条件追加・ROI掘りは禁止。
 *
 * 監視対象 (backtest=9fb13c3 で固定した3条件のみ):
 *   H011-A: 2連単 1-4 全体
 *   H011-B: 2連単 1-4 × 風速2-3m/s帯
 *   H011-C: 2連単 1-4 × 4号艇モーター上位
 *
 * ⚠️ backtest 実績 (採用ではない、forward比較の基準として表示):
 *   H011-A: ROI 94.7% / top2除外 88.6% / n=1522
 *   H011-B: ROI 113.5% / top2除外 103.4% / n=694  ← backtest内条件、採用不可
 *   H011-C: ROI 112.1% / top2除外 99.5% / n=538   ← backtest内条件、採用不可
 *
 * pending と resolved-miss の区別:
 *   - race_payouts に当該レースの exacta 行があれば「確定済み」
 *     → combination='1-4' があれば hit、なければ resolved-miss (0円負け)
 *   - exacta 行が1つもなければ「未確定 (pending)」= 0円負けに混ぜない
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/h011-forward-monitor.md";
const OUT_JSON = "reports/h011-forward-monitor.json";

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

// forward monitor 開始日。H011 を未来で検証するための境界。
const MONITOR_START = process.env.H011_MONITOR_START ?? "2026-06-01";
// 全データは run_kind='historical-backfill' のみ (paper-forward-monitor と同じ)。
const RUN_KIND      = process.env.H011_RUN_KIND ?? "historical-backfill";
const EXCL_VENUES   = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES    = [10, 11, 12];
const UNIT          = 100;
const MIN_N_FOR_JUDGE = 30;
const MIN_HITS_FOR_JUDGE = 3;

const excl_v = EXCL_VENUES.map(v => `'${v}'`).join(",");
const excl_r = EXCL_RACES.join(",");

// ─── backtest 基準値 (9fb13c3 で固定。forward 比較用の表示のみ) ────────────────

const BACKTEST = {
  "H011-A": { label: "2連単 1-4 全体",            roi: 94.7,  top2: 88.6,  n: 1522 },
  "H011-B": { label: "2連単 1-4 × 風速2-3m/s",    roi: 113.5, top2: 103.4, n: 694 },
  "H011-C": { label: "2連単 1-4 × 4号艇モーター上位", roi: 112.1, top2: 99.5,  n: 538 },
} as const;

// ─── forward 対象レース ───────────────────────────────────────────────────────

type Race = { race_id: string; date: string; venue: string; race_no: number };

const forwardRaces = db.prepare(`
  SELECT DISTINCT dh.race_id, dh.date, dh.venue, dh.race_no
  FROM decision_history dh
  WHERE dh.decision='BUY' AND dh.run_kind='${RUN_KIND}'
    AND dh.current_odds IS NOT NULL
    AND dh.venue NOT IN (${excl_v})
    AND dh.race_no NOT IN (${excl_r})
    AND dh.selection='1-2-3'
    AND dh.date >= '${MONITOR_START}'
  ORDER BY dh.date
`).all() as Race[];

console.log(`H011 forward monitor 開始日: ${MONITOR_START} / run_kind: ${RUN_KIND}`);
console.log(`forward 対象レース: ${forwardRaces.length}件`);

const raceIdList = forwardRaces.map(r => `'${r.race_id}'`).join(",") || "''";

// ─── 払戻 (exacta) ────────────────────────────────────────────────────────────

type PayoutRow = { race_id: string; combination: string; payout_yen: number };
const exactaRows = forwardRaces.length > 0
  ? db.prepare(`
      SELECT race_id, combination, payout_yen
      FROM race_payouts
      WHERE race_id IN (${raceIdList}) AND bet_type='exacta'
    `).all() as PayoutRow[]
  : [];

// race_id → { hasSettled, payout14 }
const settledRaces = new Set<string>();
const payout14Map = new Map<string, number>();
for (const r of exactaRows) {
  settledRaces.add(r.race_id);
  if (r.combination === "1-4") payout14Map.set(r.race_id, r.payout_yen);
}

// ─── 特徴量 (H011-B 風速 / H011-C モーター上位) ───────────────────────────────

// 風速: race_weather.wind_speed_mps
type WRow = { race_id: string; wind_speed_mps: number | null };
const windMap = new Map<string, number | null>();
if (forwardRaces.length > 0) {
  for (const r of db.prepare(`SELECT race_id, wind_speed_mps FROM race_weather WHERE race_id IN (${raceIdList})`).all() as WRow[]) {
    windMap.set(r.race_id, r.wind_speed_mps);
  }
}

// モーター: 4号艇の motor_top2_rate がレース内6艇中 top2 か (構造検証スクリプトと同一定義)
type MRow = { race_id: string; boat: number; motor_top2_rate: number | null };
const motorByRace = new Map<string, Array<{ boat: number; rate: number }>>();
if (forwardRaces.length > 0) {
  for (const r of db.prepare(`
    SELECT re.race_id, re.boat, mbs.motor_top2_rate
    FROM race_entries re
    JOIN motor_boat_stats mbs ON mbs.race_id = re.race_id AND mbs.course = re.entry_course
    WHERE re.race_id IN (${raceIdList}) AND mbs.motor_top2_rate IS NOT NULL
  `).all() as MRow[]) {
    if (r.motor_top2_rate == null) continue;
    if (!motorByRace.has(r.race_id)) motorByRace.set(r.race_id, []);
    motorByRace.get(r.race_id)!.push({ boat: r.boat, rate: r.motor_top2_rate });
  }
}
function motorTop4(raceId: string): boolean | null {
  const arr = motorByRace.get(raceId);
  if (!arr || arr.length < 4) return null;
  const sorted = [...arr].sort((a, b) => b.rate - a.rate);
  return sorted.slice(0, 2).some(x => x.boat === 4);
}

// H011-B: 2 <= wind_speed_mps < 4
//   ⚠️ 境界注記: backtest の "2-3m/s帯" は構造検証スクリプトの windBand 定義
//   (2 <= ws < 4) と同一。3.x m/s を含み 4.0 を含まない。condB の風速2-4帯と同じ境界。
function windBandB(raceId: string): boolean | null {
  const ws = windMap.get(raceId);
  if (ws == null) return null;
  return ws >= 2 && ws < 4;
}

// ─── 監視条件定義 ─────────────────────────────────────────────────────────────

type Condition = { id: keyof typeof BACKTEST; label: string; filter: (r: Race) => boolean | null };
const CONDITIONS: Condition[] = [
  { id: "H011-A", label: BACKTEST["H011-A"].label, filter: () => true },
  { id: "H011-B", label: BACKTEST["H011-B"].label, filter: r => windBandB(r.race_id) },
  { id: "H011-C", label: BACKTEST["H011-C"].label, filter: r => motorTop4(r.race_id) },
];

// ─── 集計 ─────────────────────────────────────────────────────────────────────

type Verdict = "pending" | "insufficient" | "watch" | "reject";

type Stats = {
  id: string; label: string;
  n_total: number;       // 条件該当 (特徴量で除外されていないレース)
  n_unknownFeature: number; // 特徴量が取れずに条件判定不能なレース
  n_resolved: number;    // exacta確定済み
  n_pending: number;     // 未確定
  hits: number;
  hitRate: number;       // hits / n_resolved
  stake: number;         // n_resolved * UNIT
  payout: number;
  profit: number;
  roi: number;
  top1ExclRoi: number;
  top2ExclRoi: number;
  maxLosingStreak: number;
  avgPayout: number | null;
  medPayout: number | null;
  monthly: Record<string, { n_resolved: number; hits: number; roi: number }>;
  verdict: Verdict;
  verdictReason: string;
};

function aggregate(cond: Condition): Stats {
  // 条件該当判定: filter が true のレースのみ対象。null は特徴量不明として除外カウント。
  const matched: Race[] = [];
  let unknownFeature = 0;
  for (const r of forwardRaces) {
    const v = cond.filter(r);
    if (v === null) { unknownFeature++; continue; }
    if (v === true) matched.push(r);
  }

  // resolved / pending
  const resolved: Race[] = [];
  let pending = 0;
  for (const r of matched) {
    if (settledRaces.has(r.race_id)) resolved.push(r);
    else pending++;
  }

  // 時系列ソート (連敗計算用)
  resolved.sort((a, b) => a.date.localeCompare(b.date) || a.race_id.localeCompare(b.race_id));

  const payouts: number[] = [];
  const hitPayouts: number[] = [];
  let hits = 0, totalPayout = 0, maxStreak = 0, cur = 0;
  for (const r of resolved) {
    const y = payout14Map.get(r.race_id) ?? 0;
    const p = y > 0 ? y / 100 * UNIT : 0;
    payouts.push(p);
    totalPayout += p;
    if (p > 0) { hits++; hitPayouts.push(p); cur = 0; } else { cur++; if (cur > maxStreak) maxStreak = cur; }
  }
  const nResolved = resolved.length;
  const stake = nResolved * UNIT;
  const roi = stake > 0 ? totalPayout / stake * 100 : 0;

  function exclTop(k: number): number {
    const sorted = [...payouts].sort((a, b) => b - a).slice(k);
    const inv = sorted.length * UNIT;
    return inv > 0 ? sorted.reduce((s, v) => s + v, 0) / inv * 100 : 0;
  }
  hitPayouts.sort((a, b) => a - b);

  // 月別
  const monthly: Stats["monthly"] = {};
  for (const r of resolved) {
    const m = r.date.slice(0, 7);
    if (!monthly[m]) monthly[m] = { n_resolved: 0, hits: 0, roi: 0 };
    monthly[m].n_resolved++;
    const y = payout14Map.get(r.race_id) ?? 0;
    if (y > 0) monthly[m].hits++;
  }
  for (const m of Object.keys(monthly)) {
    const sub = resolved.filter(r => r.date.startsWith(m));
    const inv = sub.length * UNIT;
    const pay = sub.reduce((s, r) => { const y = payout14Map.get(r.race_id) ?? 0; return s + (y > 0 ? y / 100 * UNIT : 0); }, 0);
    monthly[m].roi = inv > 0 ? pay / inv * 100 : 0;
  }

  // 判定
  let verdict: Verdict;
  let verdictReason: string;
  if (nResolved === 0) {
    verdict = "pending";
    verdictReason = pending > 0
      ? `確定レースなし (pending=${pending})。forward データ蓄積待ち`
      : `対象レースなし。${MONITOR_START}以降のBUYレース待ち`;
  } else if (nResolved < MIN_N_FOR_JUDGE || hits < MIN_HITS_FOR_JUDGE) {
    verdict = "insufficient";
    verdictReason = `n_resolved=${nResolved} / hits=${hits}: 判定基準 (n≥${MIN_N_FOR_JUDGE}, hits≥${MIN_HITS_FOR_JUDGE}) 未達`;
  } else if (roi >= 100 && exclTop(2) >= 100) {
    verdict = "watch";
    verdictReason = `ROI ${roi.toFixed(1)}% / top2除外 ${exclTop(2).toFixed(1)}% とも≥100%だが forward 単独データのみ: watch 止まり (app_settings反映不可)`;
  } else if (roi >= 100) {
    verdict = "watch";
    verdictReason = `ROI ${roi.toFixed(1)}% ≥100% だが top2除外 ${exclTop(2).toFixed(1)}% <100%: 高配当依存の可能性 → watch`;
  } else {
    verdict = "reject";
    verdictReason = `ROI ${roi.toFixed(1)}% <100%: 期待値なし`;
  }

  return {
    id: cond.id, label: cond.label,
    n_total: matched.length, n_unknownFeature: unknownFeature,
    n_resolved: nResolved, n_pending: pending,
    hits, hitRate: nResolved > 0 ? hits / nResolved : 0,
    stake, payout: totalPayout, profit: totalPayout - stake, roi,
    top1ExclRoi: exclTop(1), top2ExclRoi: exclTop(2),
    maxLosingStreak: maxStreak,
    avgPayout: hitPayouts.length > 0 ? hitPayouts.reduce((s, v) => s + v, 0) / hitPayouts.length : null,
    medPayout: hitPayouts.length > 0 ? hitPayouts[Math.floor(hitPayouts.length / 2)] : null,
    monthly, verdict, verdictReason,
  };
}

const stats = CONDITIONS.map(aggregate);

// data-unavailable: forward レースのうち exacta 未確定 (= pending) 件数
const totalPending = forwardRaces.filter(r => !settledRaces.has(r.race_id)).length;

// ─── MD 出力 ──────────────────────────────────────────────────────────────────

function fmtRoi(v: number) { return v.toFixed(1) + "%"; }
function fmtPct(v: number) { return (v * 100).toFixed(1) + "%"; }

const now = new Date().toISOString();
const lines: string[] = [];

lines.push(`# H011 「1-4系 市場過小評価」 forward モニター`);
lines.push(``);
lines.push(`生成日時: ${now}`);
lines.push(`monitor 開始日: **${MONITOR_START}** (run_kind=${RUN_KIND})`);
lines.push(``);
lines.push(`> **読み取り専用。BUY は検証候補、ROI は検証指標。購入推奨ではない。**`);
lines.push(`> **これは H011 を未来データで検証する箱。条件追加・ROI掘りは禁止。app_settings 反映禁止。**`);
lines.push(`> **backtest (9fb13c3) で見えた条件付き>100% は in-sample 条件選択であり、forward での再現を待つ。**`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 監視対象の定義 (固定)`);
lines.push(``);
lines.push(`| ID | 条件 | 定義 |`);
lines.push(`|---|---|---|`);
lines.push(`| H011-A | 2連単 1-4 全体 | 現行BUY集合 (selection=1-2-3) の全レースで exacta 1-4 を1点100円 |`);
lines.push(`| H011-B | × 風速2-3m/s | race_weather.wind_speed_mps が \`2 ≤ ws < 4\` |`);
lines.push(`| H011-C | × 4号艇モーター上位 | 4号艇の motor_top2_rate がレース内6艇中 top2 (構造検証スクリプトと同一定義) |`);
lines.push(``);
lines.push(`> **H011-B 境界注記**: backtest の「2-3m/s帯」は構造検証スクリプトの windBand 定義 \`2 ≤ ws < 4\` と同一。`);
lines.push(`> 3.x m/s を含み 4.0 を含まない (condB の風速2-4帯と同じ境界)。この定義で backtest n=694 / ROI=113.5% を得た。`);
lines.push(`> **H011-C 定義**: 構造検証 (9fb13c3) で「motorTop4 = 4号艇の motor_top2_rate が降順 top2」とした定義を踏襲。`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## forward 集計サマリ`);
lines.push(``);
lines.push(`| 項目 | 値 |`);
lines.push(`|---|---|`);
lines.push(`| monitor 開始日 | ${MONITOR_START} |`);
lines.push(`| forward 対象レース総数 | ${forwardRaces.length} |`);
lines.push(`| うち exacta 確定済み | ${forwardRaces.length - totalPending} |`);
lines.push(`| うち未確定 (pending) | ${totalPending} |`);
lines.push(`| 判定最低 n_resolved / hits | ${MIN_N_FOR_JUDGE} / ${MIN_HITS_FOR_JUDGE} |`);
lines.push(``);
if (forwardRaces.length === 0) {
  lines.push(`> ⚠️ **現時点で ${MONITOR_START} 以降の forward BUY レースは 0 件**。`);
  lines.push(`> 全データは run_kind=${RUN_KIND} で最新が 2026-05-29 まで。これは正常 (未来監視の箱を先に用意した状態)。`);
  lines.push(`> 新しいレースが追加されると本レポートが自動で埋まる。`);
  lines.push(``);
}
lines.push(`---`);
lines.push(``);
lines.push(`## 条件別 forward 結果 (backtest 基準と並列表示)`);
lines.push(``);
lines.push(`| ID | 条件 | backtest ROI (n) | forward n_total | resolved | pending | hits | forward ROI | top2除外 | 最大連敗 | 判定 |`);
lines.push(`|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|`);
for (const s of stats) {
  const bt = BACKTEST[s.id as keyof typeof BACKTEST];
  const fwdRoi = s.n_resolved > 0 ? fmtRoi(s.roi) : "—";
  const fwdT2  = s.n_resolved > 0 ? fmtRoi(s.top2ExclRoi) : "—";
  lines.push(`| ${s.id} | ${s.label} | ${fmtRoi(bt.roi)} (n=${bt.n}) | ${s.n_total} | ${s.n_resolved} | ${s.n_pending} | ${s.hits} | ${fwdRoi} | ${fwdT2} | ${s.maxLosingStreak} | **${s.verdict}** |`);
}
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 各条件 詳細`);
lines.push(``);
for (const s of stats) {
  const bt = BACKTEST[s.id as keyof typeof BACKTEST];
  lines.push(`### ${s.id}: ${s.label}`);
  lines.push(``);
  lines.push(`**backtest 基準 (9fb13c3、採用ではない)**: ROI ${fmtRoi(bt.roi)} / top2除外 ${fmtRoi(bt.top2)} / n=${bt.n}`);
  lines.push(``);
  lines.push(`| 項目 | forward 値 |`);
  lines.push(`|---|---|`);
  lines.push(`| n_total (条件該当) | ${s.n_total} |`);
  lines.push(`| 特徴量不明で除外 | ${s.n_unknownFeature} |`);
  lines.push(`| n_resolved (確定) | ${s.n_resolved} |`);
  lines.push(`| n_pending (未確定) | ${s.n_pending} |`);
  lines.push(`| hits / 的中率 | ${s.hits} / ${s.n_resolved > 0 ? fmtPct(s.hitRate) : "—"} |`);
  lines.push(`| stake / payout / profit | ${s.stake}円 / ${s.payout.toFixed(0)}円 / ${s.profit.toFixed(0)}円 |`);
  lines.push(`| ROI | ${s.n_resolved > 0 ? "**" + fmtRoi(s.roi) + "**" : "— (pending)"} |`);
  lines.push(`| top1除外 / top2除外 ROI | ${s.n_resolved > 0 ? fmtRoi(s.top1ExclRoi) + " / " + fmtRoi(s.top2ExclRoi) : "—"} |`);
  lines.push(`| 最大連敗 | ${s.maxLosingStreak} |`);
  lines.push(`| avg / med 払戻 | ${s.avgPayout !== null ? s.avgPayout.toFixed(0) + "円" : "—"} / ${s.medPayout !== null ? s.medPayout.toFixed(0) + "円" : "—"} |`);
  lines.push(`| 判定 | **${s.verdict}** — ${s.verdictReason} |`);
  lines.push(``);
  if (Object.keys(s.monthly).length > 0) {
    lines.push(`**月別** (resolved のみ)`);
    lines.push(``);
    lines.push(`| 月 | n | hits | ROI |`);
    lines.push(`|---|---:|---:|---:|`);
    for (const m of Object.keys(s.monthly).sort()) {
      const mo = s.monthly[m];
      lines.push(`| ${m} | ${mo.n_resolved} | ${mo.hits} | ${fmtRoi(mo.roi)} |`);
    }
    lines.push(``);
  }
  lines.push(`---`);
  lines.push(``);
}
lines.push(`## review trigger`);
lines.push(``);
lines.push(`- **H011-A** が n_resolved ≥ ${MIN_N_FOR_JUDGE} に到達 → forward ROI を backtest 94.7% と比較`);
lines.push(`- **H011-B / H011-C** が n_resolved ≥ ${MIN_N_FOR_JUDGE} に到達 → 条件付き優位が forward で再現するか確認`);
lines.push(`- いずれも forward ROI ≥ 100% かつ top2除外 ≥ 100% が継続して初めて「edge候補」`);
lines.push(`- **それでも app_settings 反映は不可** (forward の事前オッズ検証・複数期間確認が前提)`);
lines.push(``);
lines.push(`## 注記`);
lines.push(``);
lines.push(`- pending (exacta未確定) は 0円負けに混ぜず、resolved からも除外している`);
lines.push(`- forward 単独で ROI>100% でも、それは1期間の結果であり採用条件ではない`);
lines.push(`- 条件追加・風向/会場での再探索は禁止 (過学習防止)`);
lines.push(`- 自動投票・購入推奨ではない`);
lines.push(``);
lines.push(`---`);
lines.push(`*生成: report-h011-forward-monitor.ts*`);

const md = lines.join("\n");
if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");

// ─── JSON 出力 ────────────────────────────────────────────────────────────────

const jsonOutput = {
  generatedAt: now,
  meta: {
    description: "H011「1-4系 市場過小評価」forward モニター (未来データ固定監視)",
    monitorStart: MONITOR_START,
    runKind: RUN_KIND,
    warningNotAdoption: "forward>100%でもapp_settings反映禁止。条件追加・ROI掘り禁止。購入推奨ではない",
    minNForJudge: MIN_N_FOR_JUDGE,
    minHitsForJudge: MIN_HITS_FOR_JUDGE,
    h011bWindBoundary: "2 <= wind_speed_mps < 4 (構造検証windBand '2-3'帯と同一)",
    h011cMotorDef: "4号艇 motor_top2_rate がレース内6艇中top2 (構造検証motorTop4と同一)",
  },
  backtestReference: BACKTEST,
  overview: {
    forwardRaces: forwardRaces.length,
    settled: forwardRaces.length - totalPending,
    pending: totalPending,
  },
  conditions: stats.map(s => ({
    id: s.id, label: s.label,
    n_total: s.n_total,
    n_unknownFeature: s.n_unknownFeature,
    n_resolved: s.n_resolved,
    n_pending: s.n_pending,
    hits: s.hits,
    hitRate: s.n_resolved > 0 ? Math.round(s.hitRate * 10000) / 100 : null,
    stake: s.stake,
    payout: Math.round(s.payout),
    profit: Math.round(s.profit),
    roi: s.n_resolved > 0 ? Math.round(s.roi * 100) / 100 : null,
    top1ExclRoi: s.n_resolved > 0 ? Math.round(s.top1ExclRoi * 100) / 100 : null,
    top2ExclRoi: s.n_resolved > 0 ? Math.round(s.top2ExclRoi * 100) / 100 : null,
    maxLosingStreak: s.maxLosingStreak,
    avgPayout: s.avgPayout !== null ? Math.round(s.avgPayout) : null,
    medPayout: s.medPayout !== null ? Math.round(s.medPayout) : null,
    monthly: Object.fromEntries(Object.entries(s.monthly).sort().map(([m, mo]) => [m, { n_resolved: mo.n_resolved, hits: mo.hits, roi: Math.round(mo.roi * 100) / 100 }])),
    verdict: s.verdict,
    verdictReason: s.verdictReason,
  })),
};
writeFileSync(OUT_JSON, JSON.stringify(jsonOutput, null, 2), "utf-8");

// ─── コンソール ───────────────────────────────────────────────────────────────

console.log("\n=== H011 forward monitor ===");
for (const s of stats) {
  const roi = s.n_resolved > 0 ? `ROI=${fmtRoi(s.roi)} / top2除外=${fmtRoi(s.top2ExclRoi)}` : "ROI=— (pending)";
  console.log(`  ${s.id} ${s.label}: n_total=${s.n_total} / resolved=${s.n_resolved} / pending=${s.n_pending} / hits=${s.hits} / ${roi} → ${s.verdict}`);
}
console.log();
console.log(`出力: ${OUT_MD}`);
console.log(`出力: ${OUT_JSON}`);
