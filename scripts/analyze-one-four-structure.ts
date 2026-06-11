/**
 * analyze-one-four-structure.ts — 読み取り専用
 *
 * 禁止: DBへのINSERT/UPDATE/DELETE/DROP, app_settings変更, 本番decision変更
 * 禁止: 自動投票・ログイン保存・投票サイト操作・購入推奨
 * BUY は検証候補、ROI は検証指標であり購入推奨ではない。
 *
 * 目的: 全券種ROIシミュレーター (774026b) で見えた「1-4系の相対優位」の構造検証。
 *   「たまたま良かった」のか「現行BUY集合で4号艇相手が市場に過小評価されている」のかを
 *   説明可能な特徴量だけで切り分ける。
 *
 * ⚠️ やってはいけないこと:
 *   - 条件を足しまくって ROI>100% を探す (条件後付けの過学習)
 *   - ここでの結果を live forward として扱う
 *   - app_settings へ反映する
 *
 * 主候補:   2連単 1-4 / 2連複 1=4 / 3連単 1-4-2
 * 比較対象: 2連単 1-2 / 1-3、3連単 1-2-3 / 1-3-2
 *
 * 切り口: 4号艇展示順位 / 展示タイム差 / 2号艇展示順位 / 1号艇展示1位有無 /
 *   4号艇モーター・ボート上位 / 風速帯 / 風向 / 波高 / 会場 / raceNo / 月 /
 *   skip6R・skipVenue・condB 除外
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/one-four-structure.md";
const OUT_JSON = "reports/one-four-structure.json";

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

const excl_v = EXCL_VENUES.map(v => `'${v}'`).join(",");
const excl_r = EXCL_RACES.join(",");

// ─── 対象レース (governor と同条件) ──────────────────────────────────────────

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
const raceIdList = allForwardRaces.map(r => `'${r.race_id}'`).join(",");

// 重複セット
const skip6RIds    = new Set(allForwardRaces.filter(r => r.race_no === 6).map(r => r.race_id));
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

// ─── 払戻データ ───────────────────────────────────────────────────────────────

type PayoutRow = { race_id: string; bet_type: string; combination: string; payout_yen: number };
const allPayouts = db.prepare(`
  SELECT race_id, bet_type, combination, payout_yen
  FROM race_payouts
  WHERE race_id IN (${raceIdList})
    AND bet_type IN ('trifecta','exacta','quinella')
`).all() as PayoutRow[];

const payoutMap = new Map<string, Map<string, Record<string, number>>>();
for (const p of allPayouts) {
  if (!payoutMap.has(p.race_id)) payoutMap.set(p.race_id, new Map());
  const btMap = payoutMap.get(p.race_id)!;
  if (!btMap.has(p.bet_type)) btMap.set(p.bet_type, {});
  btMap.get(p.bet_type)![p.combination] = p.payout_yen;
}

// 1着=1号艇時の2着分布用 (trifecta 当選組番)
const winOrderMap = new Map<string, { first: string; second: string; third: string }>();
for (const [raceId, btMap] of payoutMap) {
  const tri = btMap.get("trifecta");
  if (!tri) continue;
  const combos = Object.keys(tri);
  if (combos.length === 0) continue;
  const parts = combos[0].split("-");
  if (parts.length === 3) winOrderMap.set(raceId, { first: parts[0], second: parts[1], third: parts[2] });
}

// ─── 特徴量取得 ───────────────────────────────────────────────────────────────

// 展示タイム (boat→entry_course→exhibition_data)
type ExhRow = { race_id: string; boat: number; exhibition_time: number };
const exhRows = db.prepare(`
  SELECT re.race_id, re.boat, ed.exhibition_time
  FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id = re.race_id AND ed.course = re.entry_course
  WHERE re.race_id IN (${raceIdList})
    AND ed.exhibition_time IS NOT NULL
`).all() as ExhRow[];

// race_id → boat → exh_time
const exhMap = new Map<string, Map<number, number>>();
for (const r of exhRows) {
  if (!exhMap.has(r.race_id)) exhMap.set(r.race_id, new Map());
  exhMap.get(r.race_id)!.set(r.boat, r.exhibition_time);
}

// モーター/ボート 2連率 (course基準 → boat へは race_entries 経由)
type MotorRow = { race_id: string; boat: number; motor_top2_rate: number | null; boat_top2_rate: number | null };
const motorRows = db.prepare(`
  SELECT re.race_id, re.boat, mbs.motor_top2_rate, mbs.boat_top2_rate
  FROM race_entries re
  JOIN motor_boat_stats mbs ON mbs.race_id = re.race_id AND mbs.course = re.entry_course
  WHERE re.race_id IN (${raceIdList})
`).all() as MotorRow[];
const motorMap = new Map<string, Map<number, { motor: number | null; boat: number | null }>>();
for (const r of motorRows) {
  if (!motorMap.has(r.race_id)) motorMap.set(r.race_id, new Map());
  motorMap.get(r.race_id)!.set(r.boat, { motor: r.motor_top2_rate, boat: r.boat_top2_rate });
}

// 天候 (風速・波高) + 風向
type WeatherRow = { race_id: string; wind_speed_mps: number | null; wave_height_cm: number | null };
const weatherMap = new Map<string, WeatherRow>();
for (const r of db.prepare(`
  SELECT race_id, wind_speed_mps, wave_height_cm FROM race_weather WHERE race_id IN (${raceIdList})
`).all() as WeatherRow[]) weatherMap.set(r.race_id, r);

type CondRow = { race_id: string; wind_dir: string | null };
const windDirMap = new Map<string, string | null>();
for (const r of db.prepare(`
  SELECT race_id, wind_dir FROM race_conditions WHERE race_id IN (${raceIdList})
`).all() as CondRow[]) windDirMap.set(r.race_id, r.wind_dir);

// ─── race ごとの特徴量を構築 ──────────────────────────────────────────────────

type Features = {
  exhRank1: number | null;   // 1号艇の展示順位 (1=最速)
  exhRank2: number | null;
  exhRank4: number | null;
  exhDiff4: number | null;   // 4号艇展示タイム - レース最速 (0=最速)
  motorTop4: boolean | null; // 4号艇モーター2連率がレース内上位2位以内
  boatTop4: boolean | null;
  windBand: string;          // "0-1" / "2-3" / "4+" / "不明"
  windDir: string;           // 風向 or "不明"
  waveBand: string;          // "0-2" / "3-5" / "6+" / "不明"
};

const featureMap = new Map<string, Features>();
for (const r of allForwardRaces) {
  const exh = exhMap.get(r.race_id);
  let exhRank1: number | null = null, exhRank2: number | null = null, exhRank4: number | null = null, exhDiff4: number | null = null;
  if (exh && exh.size >= 4) {
    const sorted = [...exh.entries()].sort((a, b) => a[1] - b[1]);
    const rankOf = (boat: number) => {
      const i = sorted.findIndex(([b]) => b === boat);
      return i >= 0 ? i + 1 : null;
    };
    exhRank1 = rankOf(1);
    exhRank2 = rankOf(2);
    exhRank4 = rankOf(4);
    const t4 = exh.get(4);
    if (t4 != null) exhDiff4 = Math.round((t4 - sorted[0][1]) * 100) / 100;
  }

  const motor = motorMap.get(r.race_id);
  let motorTop4: boolean | null = null, boatTop4: boolean | null = null;
  if (motor && motor.size >= 4) {
    const mArr = [...motor.entries()].filter(([, v]) => v.motor != null).sort((a, b) => (b[1].motor ?? 0) - (a[1].motor ?? 0));
    const bArr = [...motor.entries()].filter(([, v]) => v.boat != null).sort((a, b) => (b[1].boat ?? 0) - (a[1].boat ?? 0));
    if (mArr.length >= 4) motorTop4 = mArr.slice(0, 2).some(([b]) => b === 4);
    if (bArr.length >= 4) boatTop4 = bArr.slice(0, 2).some(([b]) => b === 4);
  }

  const w = weatherMap.get(r.race_id);
  const ws = w?.wind_speed_mps;
  const windBand = ws == null ? "不明" : ws < 2 ? "0-1" : ws < 4 ? "2-3" : "4+";
  const wave = w?.wave_height_cm;
  const waveBand = wave == null ? "不明" : wave <= 2 ? "0-2" : wave <= 5 ? "3-5" : "6+";
  const windDir = windDirMap.get(r.race_id) ?? "不明";

  featureMap.set(r.race_id, { exhRank1, exhRank2, exhRank4, exhDiff4, motorTop4, boatTop4, windBand, windDir: windDir || "不明", waveBand });
}

const exhCoverage = [...featureMap.values()].filter(f => f.exhRank4 !== null).length;
const motorCoverage = [...featureMap.values()].filter(f => f.motorTop4 !== null).length;
console.log(`特徴量coverage: 展示 ${exhCoverage}/${allForwardRaces.length} / モーター ${motorCoverage}/${allForwardRaces.length}`);

// ─── チケット定義と集計 ───────────────────────────────────────────────────────

type Ticket = { id: string; label: string; betType: string; combination: string };
const TICKETS: Ticket[] = [
  { id: "exacta_14",   label: "2連単 1-4",   betType: "exacta",   combination: "1-4" },
  { id: "quinella_14", label: "2連複 1=4",   betType: "quinella", combination: "1-4" },
  { id: "trifecta_142", label: "3連単 1-4-2", betType: "trifecta", combination: "1-4-2" },
  { id: "exacta_12",   label: "2連単 1-2",   betType: "exacta",   combination: "1-2" },
  { id: "exacta_13",   label: "2連単 1-3",   betType: "exacta",   combination: "1-3" },
  { id: "trifecta_123", label: "3連単 1-2-3", betType: "trifecta", combination: "1-2-3" },
  { id: "trifecta_132", label: "3連単 1-3-2", betType: "trifecta", combination: "1-3-2" },
];

type Cell = { n: number; hits: number; hitRate: number; roi: number; top1ExclRoi: number; top2ExclRoi: number; maxStreak: number; avgPayout: number | null; medPayout: number | null };

function payoutOf(raceId: string, t: Ticket): number {
  const y = payoutMap.get(raceId)?.get(t.betType)?.[t.combination] ?? 0;
  return y > 0 ? y / 100 * UNIT : 0;
}

function cellOf(races: Race[], t: Ticket): Cell {
  const sorted = [...races].sort((a, b) => a.date.localeCompare(b.date) || a.race_id.localeCompare(b.race_id));
  let hits = 0, payout = 0, maxStreak = 0, cur = 0;
  const payouts: number[] = [];
  const hitPayouts: number[] = [];
  for (const r of sorted) {
    const p = payoutOf(r.race_id, t);
    payouts.push(p);
    payout += p;
    if (p > 0) { hits++; hitPayouts.push(p); cur = 0; } else { cur++; if (cur > maxStreak) maxStreak = cur; }
  }
  const n = races.length;
  const invest = n * UNIT;
  const roi = invest > 0 ? payout / invest * 100 : 0;
  function exclTop(k: number): number {
    const sortedP = [...payouts].sort((a, b) => b - a);
    const cut = sortedP.slice(k);
    const inv2 = cut.length * UNIT;
    return inv2 > 0 ? cut.reduce((s, v) => s + v, 0) / inv2 * 100 : 0;
  }
  hitPayouts.sort((a, b) => a - b);
  return {
    n, hits, hitRate: n > 0 ? hits / n : 0, roi,
    top1ExclRoi: exclTop(1), top2ExclRoi: exclTop(2),
    maxStreak,
    avgPayout: hitPayouts.length > 0 ? hitPayouts.reduce((s, v) => s + v, 0) / hitPayouts.length : null,
    medPayout: hitPayouts.length > 0 ? hitPayouts[Math.floor(hitPayouts.length / 2)] : null,
  };
}

type Verdict = "promote" | "watch" | "reject" | "insufficient";
function judge(c: Cell): Verdict {
  if (c.n < MIN_N_FOR_JUDGE || c.hits < MIN_HITS_FOR_JUDGE) return "insufficient";
  if (c.roi >= 100 && c.top2ExclRoi >= 100) return "watch"; // backtestのみのためpromote不可
  if (c.roi >= 100) return "watch";
  return "reject";
}

// ─── 切り口定義 ───────────────────────────────────────────────────────────────

type Split = { name: string; groups: Array<{ label: string; filter: (r: Race) => boolean }> };

const f = (id: string) => featureMap.get(id)!;

const SPLITS: Split[] = [
  {
    name: "1. 4号艇展示順位",
    groups: [
      { label: "展示1位", filter: r => f(r.race_id).exhRank4 === 1 },
      { label: "展示2-3位", filter: r => { const v = f(r.race_id).exhRank4; return v === 2 || v === 3; } },
      { label: "展示4位以下", filter: r => { const v = f(r.race_id).exhRank4; return v !== null && v >= 4; } },
    ],
  },
  {
    name: "2. 4号艇展示タイム差 (レース最速比)",
    groups: [
      { label: "最速 (0.00)", filter: r => { const v = f(r.race_id).exhDiff4; return v !== null && v <= 0; } },
      { label: "0.01-0.05", filter: r => { const v = f(r.race_id).exhDiff4; return v !== null && v > 0 && v <= 0.05; } },
      { label: "0.06-0.10", filter: r => { const v = f(r.race_id).exhDiff4; return v !== null && v > 0.05 && v <= 0.10; } },
      { label: "0.10超", filter: r => { const v = f(r.race_id).exhDiff4; return v !== null && v > 0.10; } },
    ],
  },
  {
    name: "3. 2号艇展示順位",
    groups: [
      { label: "展示1位", filter: r => f(r.race_id).exhRank2 === 1 },
      { label: "展示2-3位", filter: r => { const v = f(r.race_id).exhRank2; return v === 2 || v === 3; } },
      { label: "展示4位以下", filter: r => { const v = f(r.race_id).exhRank2; return v !== null && v >= 4; } },
    ],
  },
  {
    name: "4. 1号艇展示1位有無",
    groups: [
      { label: "1号艇展示1位", filter: r => f(r.race_id).exhRank1 === 1 },
      { label: "1号艇展示非1位", filter: r => { const v = f(r.race_id).exhRank1; return v !== null && v > 1; } },
    ],
  },
  {
    name: "5. 4号艇モーター2連率 (レース内上位2)",
    groups: [
      { label: "モーター上位", filter: r => f(r.race_id).motorTop4 === true },
      { label: "モーター非上位", filter: r => f(r.race_id).motorTop4 === false },
    ],
  },
  {
    name: "6. 4号艇ボート2連率 (レース内上位2)",
    groups: [
      { label: "ボート上位", filter: r => f(r.race_id).boatTop4 === true },
      { label: "ボート非上位", filter: r => f(r.race_id).boatTop4 === false },
    ],
  },
  {
    name: "7. 風速帯",
    groups: [
      { label: "0-1 m/s", filter: r => f(r.race_id).windBand === "0-1" },
      { label: "2-3 m/s", filter: r => f(r.race_id).windBand === "2-3" },
      { label: "4+ m/s", filter: r => f(r.race_id).windBand === "4+" },
    ],
  },
  {
    name: "9. 波高",
    groups: [
      { label: "0-2 cm", filter: r => f(r.race_id).waveBand === "0-2" },
      { label: "3-5 cm", filter: r => f(r.race_id).waveBand === "3-5" },
      { label: "6+ cm", filter: r => f(r.race_id).waveBand === "6+" },
    ],
  },
  {
    name: "13-15. 既存フィルター除外",
    groups: [
      { label: "全体", filter: () => true },
      { label: "skip6R除外", filter: r => !skip6RIds.has(r.race_id) },
      { label: "skipVenue除外", filter: r => !skipVenueIds.has(r.race_id) },
      { label: "condB除外", filter: r => !condBIds.has(r.race_id) },
      { label: "skip6R+skipVenue除外", filter: r => !skip6RIds.has(r.race_id) && !skipVenueIds.has(r.race_id) },
    ],
  },
];

// 風向 (n>=30 のみ)
const windDirCounts = new Map<string, number>();
for (const r of allForwardRaces) {
  const d = f(r.race_id).windDir;
  windDirCounts.set(d, (windDirCounts.get(d) ?? 0) + 1);
}
const windDirGroups = [...windDirCounts.entries()]
  .filter(([d, n]) => d !== "不明" && n >= 30)
  .sort((a, b) => b[1] - a[1])
  .map(([d]) => ({ label: d, filter: (r: Race) => f(r.race_id).windDir === d }));
if (windDirGroups.length > 0) SPLITS.splice(7, 0, { name: "8. 風向 (n≥30のみ)", groups: windDirGroups });

// 会場 (n>=30)
const venueCounts = new Map<string, number>();
for (const r of allForwardRaces) venueCounts.set(r.venue, (venueCounts.get(r.venue) ?? 0) + 1);
const venueGroups = [...venueCounts.entries()]
  .filter(([, n]) => n >= 30)
  .sort((a, b) => b[1] - a[1])
  .map(([v]) => ({ label: v, filter: (r: Race) => r.venue === v }));
SPLITS.push({ name: "10. 会場 (n≥30のみ)", groups: venueGroups });

// raceNo
const raceNoGroups = [...new Set(allForwardRaces.map(r => r.race_no))].sort((a, b) => a - b)
  .map(no => ({ label: `${no}R`, filter: (r: Race) => r.race_no === no }));
SPLITS.push({ name: "11. raceNo", groups: raceNoGroups });

// 月
const monthGroups = [...new Set(allForwardRaces.map(r => r.date.slice(0, 7)))].sort()
  .map(m => ({ label: m, filter: (r: Race) => r.date.startsWith(m) }));
SPLITS.push({ name: "12. 月別", groups: monthGroups });

// ─── 1着=1号艇時の2着分布 (市場の歪み直接チェック) ────────────────────────────

const boat1WinRaces = allForwardRaces.filter(r => winOrderMap.get(r.race_id)?.first === "1");
const secondDist: Record<string, { count: number; avgExactaPayout: number | null }> = {};
for (const second of ["2", "3", "4", "5", "6"]) {
  const subset = boat1WinRaces.filter(r => winOrderMap.get(r.race_id)?.second === second);
  const payouts = subset
    .map(r => payoutMap.get(r.race_id)?.get("exacta")?.[`1-${second}`])
    .filter((v): v is number => v != null && v > 0);
  secondDist[second] = {
    count: subset.length,
    avgExactaPayout: payouts.length > 0 ? payouts.reduce((s, v) => s + v, 0) / payouts.length : null,
  };
}

// ─── 計算実行 ─────────────────────────────────────────────────────────────────

console.log("切り口別計算中...");

type SplitResult = {
  name: string;
  rows: Array<{
    group: string;
    cells: Record<string, Cell & { verdict: Verdict }>;
  }>;
};

const MAIN_TICKETS = TICKETS.filter(t => ["exacta_14", "quinella_14", "trifecta_142", "exacta_12"].includes(t.id));

const splitResults: SplitResult[] = SPLITS.map(split => ({
  name: split.name,
  rows: split.groups.map(g => {
    const races = allForwardRaces.filter(g.filter);
    const cells: Record<string, Cell & { verdict: Verdict }> = {};
    for (const t of MAIN_TICKETS) {
      const c = cellOf(races, t);
      cells[t.id] = { ...c, verdict: judge(c) };
    }
    return { group: g.label, cells };
  }),
}));

// 全体セル (7チケット)
const overallCells = TICKETS.map(t => ({ ticket: t, cell: cellOf(allForwardRaces, t), verdict: judge(cellOf(allForwardRaces, t)) }));

// ─── MD 出力 ──────────────────────────────────────────────────────────────────

function fmtRoi(v: number) { return v.toFixed(1) + "%"; }
function fmtPct(v: number) { return (v * 100).toFixed(1) + "%"; }

const now = new Date().toISOString();
const lines: string[] = [];

lines.push(`# 1-4系 構造検証 (市場の4号艇過小評価仮説)`);
lines.push(``);
lines.push(`生成日時: ${now}`);
lines.push(``);
lines.push(`> **読み取り専用。BUY は検証候補、ROI は検証指標。購入推奨ではない。**`);
lines.push(`> **これは実払戻 backtest であり live/T-5 forward ではない。app_settings 反映禁止。**`);
lines.push(`> **条件を足して ROI>100% を探す行為は禁止。説明可能な特徴量での切り分けのみ。**`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 検証概要`);
lines.push(``);
lines.push(`| 項目 | 値 |`);
lines.push(`|---|---|`);
lines.push(`| 対象 forward BUY race | ${allForwardRaces.length}件 |`);
lines.push(`| 展示特徴量 coverage | ${exhCoverage}/${allForwardRaces.length} (${(exhCoverage/allForwardRaces.length*100).toFixed(1)}%) |`);
lines.push(`| モーター特徴量 coverage | ${motorCoverage}/${allForwardRaces.length} (${(motorCoverage/allForwardRaces.length*100).toFixed(1)}%) |`);
lines.push(`| 1号艇1着レース | ${boat1WinRaces.length}件 (${(boat1WinRaces.length/allForwardRaces.length*100).toFixed(1)}%) |`);
lines.push(`| 判定最低 n / hits | ${MIN_N_FOR_JUDGE} / ${MIN_HITS_FOR_JUDGE} |`);
lines.push(``);
lines.push(`## 全体 (参考: 774026b 全券種シミュレーターと同値になるはず)`);
lines.push(``);
lines.push(`| チケット | n | hits | 的中率 | ROI | top2除外 | 最大連敗 | 判定 |`);
lines.push(`|---|---:|---:|---:|---:|---:|---:|---|`);
for (const o of overallCells) {
  lines.push(`| ${o.ticket.label} | ${o.cell.n} | ${o.cell.hits} | ${fmtPct(o.cell.hitRate)} | ${fmtRoi(o.cell.roi)} | ${fmtRoi(o.cell.top2ExclRoi)} | ${o.cell.maxStreak} | ${o.verdict} |`);
}
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 市場の歪み直接チェック: 1号艇1着時の2着分布と平均払戻`);
lines.push(``);
lines.push(`> 2着率が同程度なのに平均払戻が高い相手は、市場が過小評価している候補。`);
lines.push(``);
lines.push(`| 2着艇 | 回数 | 2着率 (1着=1中) | 平均2連単払戻 (100円) | 暗黙の期待値 (2着率×平均払戻/100) |`);
lines.push(`|---|---:|---:|---:|---:|`);
for (const second of ["2", "3", "4", "5", "6"]) {
  const d = secondDist[second];
  const rate = boat1WinRaces.length > 0 ? d.count / boat1WinRaces.length : 0;
  const ev = d.avgExactaPayout !== null ? rate * d.avgExactaPayout / 100 : null;
  lines.push(`| ${second}号艇 | ${d.count} | ${fmtPct(rate)} | ${d.avgExactaPayout !== null ? d.avgExactaPayout.toFixed(0) + "円" : "—"} | ${ev !== null ? ev.toFixed(3) : "—"} |`);
}
lines.push(``);
lines.push(`> 暗黙の期待値 = この BUY 集合で「1号艇1着」が確定だと仮置きした場合の相対比較。`);
lines.push(`> 1.0 超は「1着さえ当たれば黒字」、ただし実際は1着率 ${(boat1WinRaces.length/allForwardRaces.length*100).toFixed(1)}% を掛ける必要がある。`);
lines.push(``);
lines.push(`---`);
lines.push(``);

// 切り口別
lines.push(`## 切り口別比較 (2連単1-4 / 2連複1=4 / 3連単1-4-2 vs 2連単1-2)`);
lines.push(``);
for (const sr of splitResults) {
  lines.push(`### ${sr.name}`);
  lines.push(``);
  lines.push(`| 条件 | n | 2連単1-4 ROI (hits) | 2連複1=4 ROI | 3連単1-4-2 ROI | 2連単1-2 ROI | 1-4判定 |`);
  lines.push(`|---|---:|---:|---:|---:|---:|---|`);
  for (const row of sr.rows) {
    const c14 = row.cells["exacta_14"];
    const q14 = row.cells["quinella_14"];
    const t142 = row.cells["trifecta_142"];
    const c12 = row.cells["exacta_12"];
    lines.push(`| ${row.group} | ${c14.n} | ${fmtRoi(c14.roi)} (${c14.hits}) | ${fmtRoi(q14.roi)} | ${fmtRoi(t142.roi)} | ${fmtRoi(c12.roi)} | ${c14.verdict} |`);
  }
  lines.push(``);
}
lines.push(`---`);
lines.push(``);

lines.push(`## 注記`);
lines.push(``);
lines.push(`- これは実払戻 backtest。live/T-5 forward ではない`);
lines.push(`- 結果が良くても app_settings / 本番 decision への反映は禁止`);
lines.push(`- ROI>100% の条件が出ても、それは「条件後付け」の可能性があるため即採用不可`);
lines.push(`- n<${MIN_N_FOR_JUDGE} / hits<${MIN_HITS_FOR_JUDGE} は insufficient`);
lines.push(`- 判定 watch は「forward監視する価値あり」であって採用ではない`);
lines.push(`- 自動投票・購入推奨ではない`);
lines.push(``);
lines.push(`---`);
lines.push(`*生成: analyze-one-four-structure.ts*`);

const md = lines.join("\n");
if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");

// ─── JSON 出力 ────────────────────────────────────────────────────────────────

function cellJson(c: Cell & { verdict?: Verdict }) {
  return {
    n: c.n, hits: c.hits,
    hitRate: Math.round(c.hitRate * 10000) / 100,
    roi: Math.round(c.roi * 100) / 100,
    top1ExclRoi: Math.round(c.top1ExclRoi * 100) / 100,
    top2ExclRoi: Math.round(c.top2ExclRoi * 100) / 100,
    maxStreak: c.maxStreak,
    avgPayout: c.avgPayout !== null ? Math.round(c.avgPayout) : null,
    medPayout: c.medPayout !== null ? Math.round(c.medPayout) : null,
    verdict: c.verdict ?? null,
  };
}

const jsonOutput = {
  generatedAt: now,
  meta: {
    description: "1-4系構造検証 (市場の4号艇過小評価仮説)",
    warningNotForward: "実払戻backtest。live/T-5 forwardではない",
    warningNoAdoption: "結果が良くてもapp_settings反映禁止。購入推奨ではない",
    forwardStart: FORWARD_START,
    unit: UNIT,
    minNForJudge: MIN_N_FOR_JUDGE,
    minHitsForJudge: MIN_HITS_FOR_JUDGE,
  },
  overview: {
    forwardRaces: allForwardRaces.length,
    exhCoverage, motorCoverage,
    boat1WinRaces: boat1WinRaces.length,
    boat1WinRate: Math.round(boat1WinRaces.length / allForwardRaces.length * 10000) / 100,
  },
  overall: overallCells.map(o => ({ id: o.ticket.id, label: o.ticket.label, ...cellJson({ ...o.cell, verdict: o.verdict }) })),
  secondDistGivenBoat1Win: Object.fromEntries(
    Object.entries(secondDist).map(([k, d]) => [k, {
      count: d.count,
      rate: boat1WinRaces.length > 0 ? Math.round(d.count / boat1WinRaces.length * 10000) / 100 : 0,
      avgExactaPayout: d.avgExactaPayout !== null ? Math.round(d.avgExactaPayout) : null,
    }])
  ),
  splits: splitResults.map(sr => ({
    name: sr.name,
    rows: sr.rows.map(row => ({
      group: row.group,
      cells: Object.fromEntries(Object.entries(row.cells).map(([k, c]) => [k, cellJson(c)])),
    })),
  })),
};
writeFileSync(OUT_JSON, JSON.stringify(jsonOutput, null, 2), "utf-8");

// ─── コンソール出力 ───────────────────────────────────────────────────────────

console.log("\n=== 1号艇1着時の2着分布 ===");
for (const second of ["2", "3", "4", "5", "6"]) {
  const d = secondDist[second];
  const rate = boat1WinRaces.length > 0 ? d.count / boat1WinRaces.length * 100 : 0;
  console.log(`  2着=${second}号艇: ${d.count}回 (${rate.toFixed(1)}%) / 平均2連単払戻 ${d.avgExactaPayout?.toFixed(0) ?? "—"}円`);
}
console.log("\n=== 主要切り口 (2連単1-4 ROI) ===");
for (const sr of splitResults.slice(0, 8)) {
  console.log(`  ${sr.name}`);
  for (const row of sr.rows) {
    const c = row.cells["exacta_14"];
    console.log(`    ${row.group}: n=${c.n} / ROI=${fmtRoi(c.roi)} / top2除外=${fmtRoi(c.top2ExclRoi)} / hits=${c.hits} → ${c.verdict}`);
  }
}
console.log();
console.log(`出力: ${OUT_MD}`);
console.log(`出力: ${OUT_JSON}`);
