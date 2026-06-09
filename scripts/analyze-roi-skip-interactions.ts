/**
 * analyze-roi-skip-interactions.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 * BUY は検証候補、ROI は検証指標であり購入推奨ではない。
 * 主評価: race_payouts.payout_yen 実払戻ベース
 *
 * 有力見送り候補（2R/5R/6R, 浜名湖/住之江, odds40〜79）の交差分解。
 * - raceNo × venue / odds / 月
 * - venue × odds / 月
 * - 交差制御後の残差効果（confound 除去後に効果が残るか）
 * - 比較セット A〜L
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/roi-skip-interactions.md";
const OUT_JSON = "reports/roi-skip-interactions.json";
const STAKE = 100;
const FORWARD_START = "2025-01-01";
const JUL25 = "2025-07";
const EXCL_VENUES  = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES   = [10, 11, 12];
const BAD_VENUES   = ["浜名湖", "住之江"];
const WEAK_RACENOS = [2, 5, 6];

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

function r2(v: number) { return Math.round(v * 100) / 100; }
function calcRoi(payout: number, n: number) { return n > 0 ? r2(payout / (n * STAKE) * 100) : 0; }

// ─── DB最新日・直近3M ─────────────────────────────────────────────────────────

const dbMaxDate = (db.prepare(
  "SELECT MAX(date) as d FROM decision_history WHERE date >= ?"
).get(FORWARD_START) as { d: string }).d;
const recent3mCutoff = (() => {
  const [y, m, d] = dbMaxDate.split("-").map(Number);
  const dt = new Date(y, m - 4, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
})();

// ─── 全 forward BUY 取得 ────────────────────────────────────────────────────────

const WIND24 = `EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id
  AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)`;
const EXH1   = `EXISTS (SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=1
    AND ed.exhibition_time IS NOT NULL
    AND ed.exhibition_time = (SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2
      WHERE ed2.race_id=dh.race_id))`;

const excl_v = EXCL_VENUES.map(v => `'${v}'`).join(",");
const excl_r = EXCL_RACES.join(",");

type ForwardRow = {
  date: string; venue: string; race_no: number;
  current_odds: number; result: string; payout: number; is_condB: number;
};

console.log("[interactions] forward BUY 取得中...");
const ALL = db.prepare(`
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

const totalN      = ALL.length;
const totalPayout = ALL.reduce((a, r) => a + r.payout, 0);
const baselineRoi = calcRoi(totalPayout, totalN);
const totalHits   = ALL.filter(r => r.result === "1-2-3").length;
console.log(`[interactions] n=${totalN} hits=${totalHits} ROI=${baselineRoi}%`);

// ─── 述語定義 ────────────────────────────────────────────────────────────────────

const isR2         = (r: ForwardRow) => r.race_no === 2;
const isR5         = (r: ForwardRow) => r.race_no === 5;
const isR6         = (r: ForwardRow) => r.race_no === 6;
const isWeakR      = (r: ForwardRow) => WEAK_RACENOS.includes(r.race_no);
const isBadVenue   = (r: ForwardRow) => BAD_VENUES.includes(r.venue);
const isOdds4079   = (r: ForwardRow) => r.current_odds >= 40 && r.current_odds < 80;
const isJul25      = (r: ForwardRow) => r.date.startsWith(JUL25);
const isRecent3m   = (r: ForwardRow) => r.date >= recent3mCutoff;

// ─── 集計ユーティリティ ──────────────────────────────────────────────────────────

type CellStats = {
  n: number; hits: number; roi: number;
  top1Roi: number; top2Roi: number; jackpotRatio: number;
  flag: string;
};

function cell(rows: ForwardRow[]): CellStats {
  const n = rows.length;
  if (n < 5) return { n, hits: 0, roi: 0, top1Roi: 0, top2Roi: 0, jackpotRatio: 0, flag: "⚫" };
  const hits = rows.filter(r => r.result === "1-2-3").length;
  const payout = rows.reduce((a, r) => a + r.payout, 0);
  const sorted = [...rows].map(r => r.payout).sort((a, b) => b - a);
  const top1 = sorted[0] ?? 0;
  const top2 = top1 + (sorted[1] ?? 0);
  return {
    n, hits, roi: calcRoi(payout, n),
    top1Roi: calcRoi(payout - top1, n),
    top2Roi: calcRoi(payout - top2, n),
    jackpotRatio: payout > 0 ? r2(top1 / payout * 100) : 0,
    flag: n < 30 ? "◐" : hits === 0 ? "⚠️" : calcRoi(payout, n) < 50 ? "❌" : calcRoi(payout, n) >= 100 ? "✅" : "—",
  };
}

function fmtCell(c: CellStats): string {
  if (c.n < 5) return `⚫ n=${c.n}`;
  return `${c.flag} n=${c.n} ${c.roi}%`;
}

// 全体ベースでの skip 効果
function skipEffect(excluded: ForwardRow[]): { skipN: number; skipPct: number; skipRoi: number; remainN: number; remainRoi: number; delta: number } {
  const skipN = excluded.length;
  const skipPay = excluded.reduce((a, r) => a + r.payout, 0);
  const remainPay = totalPayout - skipPay;
  const remainN = totalN - skipN;
  return {
    skipN, skipPct: r2(skipN / totalN * 100), skipRoi: calcRoi(skipPay, skipN),
    remainN, remainRoi: calcRoi(remainPay, remainN),
    delta: r2(calcRoi(remainPay, remainN) - baselineRoi),
  };
}

// 交差制御後の skip 効果（condRows がベース）
type CondSkip = {
  label: string;
  baseN: number; baseRoi: number;
  skipN: number; skipPct: number; skipRoi: number;
  remainN: number; remainRoi: number; delta: number;
};

function condSkip(condRows: ForwardRow[], skipPred: (r: ForwardRow) => boolean, label: string): CondSkip {
  const baseN = condRows.length;
  const basePay = condRows.reduce((a, r) => a + r.payout, 0);
  const skipRows = condRows.filter(skipPred);
  const skipPay = skipRows.reduce((a, r) => a + r.payout, 0);
  const remainN = baseN - skipRows.length;
  const remainPay = basePay - skipPay;
  return {
    label, baseN, baseRoi: calcRoi(basePay, baseN),
    skipN: skipRows.length, skipPct: r2(skipRows.length / baseN * 100),
    skipRoi: calcRoi(skipPay, skipRows.length),
    remainN, remainRoi: calcRoi(remainPay, remainN),
    delta: r2(calcRoi(remainPay, remainN) - calcRoi(basePay, baseN)),
  };
}

function fmtDelta(d: number): string {
  if (d >= 2) return `**+${d}pt**`;
  if (d <= -2) return `**${d}pt**`;
  return `${d}pt`;
}

// ─── 比較セット A〜L ──────────────────────────────────────────────────────────────

type CompSet = { id: string; name: string; desc: string } & ReturnType<typeof skipEffect>;
type CompSetConditional = { id: string; name: string; desc: string } & CondSkip;

// 通常 skip sets (全体ベース)
const COMP_SETS: CompSet[] = [
  { id: "A", name: "2Rのみ",          desc: "2R 単独",           ...skipEffect(ALL.filter(isR2)) },
  { id: "B", name: "5Rのみ",          desc: "5R 単独",           ...skipEffect(ALL.filter(isR5)) },
  { id: "C", name: "6Rのみ",          desc: "6R 単独",           ...skipEffect(ALL.filter(isR6)) },
  { id: "D", name: "2R+5R",           desc: "2R と 5R の和",     ...skipEffect(ALL.filter(r => isR2(r) || isR5(r))) },
  { id: "E", name: "5R+6R",           desc: "5R と 6R の和",     ...skipEffect(ALL.filter(r => isR5(r) || isR6(r))) },
  { id: "F", name: "2R+6R",           desc: "2R と 6R の和",     ...skipEffect(ALL.filter(r => isR2(r) || isR6(r))) },
  { id: "G", name: "2R+5R+6R",        desc: "弱R 3種合算",       ...skipEffect(ALL.filter(isWeakR)) },
  { id: "H", name: "浜名湖+住之江",   desc: "0hit会場 2種",      ...skipEffect(ALL.filter(isBadVenue)) },
  { id: "I", name: "弱R-悪会場",      desc: "weakR から badVenue を除いた行", ...skipEffect(ALL.filter(r => isWeakR(r) && !isBadVenue(r))) },
  { id: "J", name: "悪会場-弱R",      desc: "badVenue から weakR を除いた行", ...skipEffect(ALL.filter(r => isBadVenue(r) && !isWeakR(r))) },
];

// 条件付き skip sets (ベースを絞ってから計算)
const COND_SETS: CompSetConditional[] = [
  // K: odds40-79 を除いた後の weakR 効果
  {
    id: "K", name: "odds40〜79外でのweakR", desc: "odds<40 or >=80 の行だけでの 2R+5R+6R skip効果",
    ...condSkip(ALL.filter(r => !isOdds4079(r)), isWeakR, "K"),
  },
  // L: weakR を除いた後の odds40-79 効果
  {
    id: "L", name: "weakR外でのodds40〜79", desc: "2R/5R/6R 以外の行だけでの odds40〜79 skip効果",
    ...condSkip(ALL.filter(r => !isWeakR(r)), isOdds4079, "L"),
  },
];

// ─── 残差効果（交差制御後）───────────────────────────────────────────────────────

const RESIDUAL: CondSkip[] = [
  // weakR の効果を各 confound を除いた後で測定
  condSkip(ALL.filter(r => !isBadVenue(r)), isWeakR,    "weakR | 悪会場除去後"),
  condSkip(ALL.filter(r => !isOdds4079(r)), isWeakR,    "weakR | odds40〜79除去後"),
  condSkip(ALL.filter(r => !isJul25(r)),    isWeakR,    "weakR | 2025-07除去後"),
  // badVenue の効果を各 confound を除いた後で測定
  condSkip(ALL.filter(r => !isWeakR(r)),    isBadVenue, "badVenue | 弱R除去後"),
  condSkip(ALL.filter(r => !isOdds4079(r)), isBadVenue, "badVenue | odds40〜79除去後"),
  condSkip(ALL.filter(r => !isJul25(r)),    isBadVenue, "badVenue | 2025-07除去後"),
  // odds40-79 の効果を confound 除去後で測定
  condSkip(ALL.filter(r => !isWeakR(r)),    isOdds4079, "odds40〜79 | 弱R除去後"),
  condSkip(ALL.filter(r => !isBadVenue(r)), isOdds4079, "odds40〜79 | 悪会場除去後"),
  condSkip(ALL.filter(r => !isJul25(r)),    isOdds4079, "odds40〜79 | 2025-07除去後"),
];

// ─── 交差マトリクス ──────────────────────────────────────────────────────────────

// 月一覧
const months = [...new Set(ALL.map(r => r.date.slice(0, 7)))].sort();
// 会場一覧（上位+絞り）
const allVenues = [...new Set(ALL.map(r => r.venue))].sort();

// raceNo × venue (focusedR × all venues with n>=5, grouped)
function crossRaceVenue(raceNos: number[]): string {
  const venues = allVenues.filter(v => ALL.filter(r => raceNos.includes(r.race_no) && r.venue === v).length >= 5);
  const header = `| raceNo | ${venues.join(" | ")} | その他会場 | 合計 |`;
  const sep    = `|---|${venues.map(() => "---").join("|")}|---|---|`;
  const rows: string[] = [];
  for (const rn of raceNos) {
    const rnRows = ALL.filter(r => r.race_no === rn);
    const cols = venues.map(v => fmtCell(cell(rnRows.filter(r => r.venue === v))));
    const other = cell(rnRows.filter(r => !venues.includes(r.venue)));
    const total = cell(rnRows);
    rows.push(`| **${rn}R** | ${cols.join(" | ")} | ${fmtCell(other)} | ${fmtCell(total)} |`);
  }
  // weakR 合計行
  const wRows = ALL.filter(r => raceNos.includes(r.race_no));
  const wCols = venues.map(v => fmtCell(cell(wRows.filter(r => r.venue === v))));
  const wOther = cell(wRows.filter(r => !venues.includes(r.venue)));
  rows.push(`| **合計(弱R)** | ${wCols.join(" | ")} | ${fmtCell(wOther)} | ${fmtCell(cell(wRows))} |`);
  // 全体行
  const allCols = venues.map(v => fmtCell(cell(ALL.filter(r => r.venue === v))));
  const allOther = cell(ALL.filter(r => !venues.includes(r.venue)));
  rows.push(`| *全体* | ${allCols.join(" | ")} | ${fmtCell(allOther)} | ${fmtCell(cell(ALL))} |`);
  return `${header}\n${sep}\n${rows.join("\n")}`;
}

// raceNo × odds帯
function crossRaceOdds(raceNos: number[]): string {
  const OBANDS = [
    { name: "odds<40",    pred: (r: ForwardRow) => r.current_odds < 40 },
    { name: "odds40〜79", pred: (r: ForwardRow) => r.current_odds >= 40 && r.current_odds < 80 },
    { name: "odds80+",    pred: (r: ForwardRow) => r.current_odds >= 80 },
  ];
  const header = `| raceNo | ${OBANDS.map(o => o.name).join(" | ")} | 合計 |`;
  const sep    = `|---|${OBANDS.map(() => "---").join("|")}|---|`;
  const rows: string[] = [];
  for (const rn of raceNos) {
    const rnRows = ALL.filter(r => r.race_no === rn);
    const cols = OBANDS.map(o => fmtCell(cell(rnRows.filter(o.pred))));
    rows.push(`| **${rn}R** | ${cols.join(" | ")} | ${fmtCell(cell(rnRows))} |`);
  }
  // 全体行
  const allCols = OBANDS.map(o => fmtCell(cell(ALL.filter(o.pred))));
  rows.push(`| *全体* | ${allCols.join(" | ")} | ${fmtCell(cell(ALL))} |`);
  return `${header}\n${sep}\n${rows.join("\n")}`;
}

// venue × odds帯
function crossVenueOdds(venues: string[]): string {
  const OBANDS = [
    { name: "odds<40",    pred: (r: ForwardRow) => r.current_odds < 40 },
    { name: "odds40〜79", pred: (r: ForwardRow) => r.current_odds >= 40 && r.current_odds < 80 },
    { name: "odds80+",    pred: (r: ForwardRow) => r.current_odds >= 80 },
  ];
  const header = `| venue | ${OBANDS.map(o => o.name).join(" | ")} | 合計 |`;
  const sep    = `|---|${OBANDS.map(() => "---").join("|")}|---|`;
  const rows: string[] = [];
  for (const v of venues) {
    const vRows = ALL.filter(r => r.venue === v);
    const cols = OBANDS.map(o => fmtCell(cell(vRows.filter(o.pred))));
    rows.push(`| **${v}** | ${cols.join(" | ")} | ${fmtCell(cell(vRows))} |`);
  }
  // その他行
  const other = ALL.filter(r => !venues.includes(r.venue));
  const otherCols = OBANDS.map(o => fmtCell(cell(other.filter(o.pred))));
  rows.push(`| *その他会場* | ${otherCols.join(" | ")} | ${fmtCell(cell(other))} |`);
  // 全体行
  const allCols = OBANDS.map(o => fmtCell(cell(ALL.filter(o.pred))));
  rows.push(`| *全体* | ${allCols.join(" | ")} | ${fmtCell(cell(ALL))} |`);
  return `${header}\n${sep}\n${rows.join("\n")}`;
}

// raceNo × 月
function crossRaceMonth(raceNos: number[]): string {
  const header = `| 月 | ${raceNos.map(r => `${r}R`).join(" | ")} | 弱R合計 | その他R | 全体 |`;
  const sep    = `|---|${raceNos.map(() => "---").join("|")}|---|---|---|`;
  const rows = months.map(m => {
    const mAll = ALL.filter(r => r.date.startsWith(m));
    if (mAll.length < 5) return null;
    const cols = raceNos.map(rn => {
      const c = cell(mAll.filter(r => r.race_no === rn));
      return fmtCell(c);
    });
    const weakM = cell(mAll.filter(r => raceNos.includes(r.race_no)));
    const otherM = cell(mAll.filter(r => !raceNos.includes(r.race_no)));
    const jul = m === JUL25 ? `**${m}**` : m;
    return `| ${jul} | ${cols.join(" | ")} | ${fmtCell(weakM)} | ${fmtCell(otherM)} | ${fmtCell(cell(mAll))} |`;
  }).filter(Boolean);
  return `${header}\n${sep}\n${rows.join("\n")}`;
}

// venue × 月
function crossVenueMonth(venues: string[]): string {
  const header = `| 月 | ${venues.join(" | ")} | 悪会場合計 | その他会場 | 全体 |`;
  const sep    = `|---|${venues.map(() => "---").join("|")}|---|---|---|`;
  const rows = months.map(m => {
    const mAll = ALL.filter(r => r.date.startsWith(m));
    if (mAll.length < 5) return null;
    const cols = venues.map(v => fmtCell(cell(mAll.filter(r => r.venue === v))));
    const badM  = cell(mAll.filter(r => venues.includes(r.venue)));
    const goodM = cell(mAll.filter(r => !venues.includes(r.venue)));
    const jul = m === JUL25 ? `**${m}**` : m;
    return `| ${jul} | ${cols.join(" | ")} | ${fmtCell(badM)} | ${fmtCell(goodM)} | ${fmtCell(cell(mAll))} |`;
  }).filter(Boolean);
  return `${header}\n${sep}\n${rows.join("\n")}`;
}

// ─── 集計実行 ────────────────────────────────────────────────────────────────────

console.log("[interactions] 交差分解を計算中...");
const tableRaceVenue  = crossRaceVenue(WEAK_RACENOS);
const tableRaceOdds   = crossRaceOdds(WEAK_RACENOS);
const tableVenueOdds  = crossVenueOdds(BAD_VENUES);
const tableRaceMonth  = crossRaceMonth(WEAK_RACENOS);
const tableVenueMonth = crossVenueMonth(BAD_VENUES);

// ─── 結論判定 ────────────────────────────────────────────────────────────────────

// 残差効果から候補の独立性を判定
function residualVerdict(items: CondSkip[]): string[] {
  return items.map(cs => {
    const sign = cs.delta >= 2 ? "🟢" : cs.delta >= 0.5 ? "🔵" : cs.delta <= -2 ? "🔴" : "⚪";
    return `- ${sign} **${cs.label}**: ベース n=${cs.baseN}(ROI=${cs.baseRoi}%) → skip n=${cs.skipN}(${cs.skipPct}%) → 残存ROI=${cs.remainRoi}% (delta=${fmtDelta(cs.delta)})`;
  });
}

// ─── Markdown 生成 ────────────────────────────────────────────────────────────────

const now = new Date().toISOString();

function compRow(s: CompSet | CompSetConditional): string {
  const excess = s.skipPct > 30 ? " ⚠️強除外" : "";
  if ("baseRoi" in s && "skipN" in s) {
    // CompSetConditional
    const cs = s as CompSetConditional;
    return `| ${cs.id} | ${cs.name} | ${cs.baseN}(ROI=${cs.baseRoi}%) | ${cs.skipN}(${cs.skipPct}%) | ${cs.skipRoi}% | ${cs.remainN} | ${cs.remainRoi}% | ${fmtDelta(cs.delta)}${excess} |`;
  }
  const c = s as CompSet;
  return `| ${c.id} | ${c.name} | ${totalN}(${baselineRoi}%) | ${c.skipN}(${c.skipPct}%) | ${c.skipRoi}% | ${c.remainN} | ${c.remainRoi}% | ${fmtDelta(c.delta)}${excess} |`;
}

const COMP_HDR = `| セット | 内容 | ベース n(ROI) | 除外n(%) | 除外ROI | 残存n | **残存ROI** | **delta** |
|---|---|---|---|---|---|---|---|`;

let md = `# 見送り候補 交差分解 (skip-interactions)

生成日時: ${now}
DB: ${DB_PATH}
forward期間: ${FORWARD_START}〜${dbMaxDate}
直近3M基準: ${recent3mCutoff}〜

> **読み取り専用。BUY は検証候補、ROI は検証指標。購入指示ではない。**
> **app_settings / 本番 decision 変更禁止。**
> ROI基準: race_payouts.payout_yen 実払戻 / ⚫=n<5 / ◐=n<30

---

## ベースライン

| n | 的中 | ROI |
|---|---|---|
| ${totalN} | ${totalHits}(${r2(totalHits / totalN * 100)}%) | **${baselineRoi}%** |

---

## 比較セット A〜J（全体ベース）

${COMP_HDR}
${COMP_SETS.map(compRow).join("\n")}

## 条件付き比較セット K〜L

> K: odds40〜79 を除いた残り全体でのweakR効果 / L: 2R/5R/6R を除いた残り全体でのodds40〜79効果

${COMP_HDR}
${COND_SETS.map(compRow).join("\n")}

---

## 残差効果（交差制御後の独立効果）

> 各候補の効果が、別の confound を除いた後でも残るか。残るなら独立した弱点。

### 2R+5R+6R の残差効果

${residualVerdict(RESIDUAL.slice(0, 3)).join("\n")}

### 浜名湖+住之江 の残差効果

${residualVerdict(RESIDUAL.slice(3, 6)).join("\n")}

### odds40〜79 の残差効果

${residualVerdict(RESIDUAL.slice(6, 9)).join("\n")}

---

## 交差分解マトリクス

> 凡例: ⚫=n<5 / ◐=n<30(要確認) / ⚠️=0hit / ❌=ROI<50% / ✅=ROI>=100% / —=普通

### A. raceNo (2R/5R/6R) × venue

> 2R/5R/6R の悪さが特定会場に偏っているか。偏りが大きければ会場効果が主因。

${tableRaceVenue}

### B. raceNo (2R/5R/6R) × odds帯

> 2R/5R/6R の悪さが odds40〜79 に偏っているか。

${tableRaceOdds}

### C. venue (浜名湖/住之江) × odds帯

> 浜名湖/住之江の悪さが odds40〜79 に偏っているか。

${tableVenueOdds}

### D. raceNo (2R/5R/6R) × 月

> 2R/5R/6R が 2025-07 だけで成立していないか。月別で横断的に弱いか。
> **太字月** = 2025-07

${tableRaceMonth}

### E. venue (浜名湖/住之江) × 月

> 浜名湖/住之江が特定月だけで成立していないか。

${tableVenueMonth}

---

## 結論

### 今すぐ app_settings に反映してよい候補

**原則なし。** monitor-only フェーズ継続。以下はすべて観察・分析結果のみ。

### 有力だが除外率が大きすぎる候補

${(() => {
  const tooWide = COMP_SETS.filter(s => s.skipPct > 30 && s.delta > 0);
  if (tooWide.length === 0) return "> なし";
  return tooWide.map(s =>
    `- **セット${s.id}** (${s.name}): 除外${s.skipN}件(${s.skipPct}%) / delta=+${s.delta}pt — 除外率が大きすぎ、残存サンプルへの集中効果の可能性あり`
  ).join("\n");
})()}

### 交差制御後も効果が残る候補（独立的弱点）

${(() => {
  const strong = RESIDUAL.filter(cs => cs.delta >= 2 && cs.remainN >= 30);
  if (strong.length === 0) return "> 現時点で独立性が高い候補なし";
  return strong.map(cs =>
    `- **${cs.label}**: delta=${fmtDelta(cs.delta)} (ベース n=${cs.baseN} → 残存 n=${cs.remainN})`
  ).join("\n");
})()}

### monitor継続候補

${(() => {
  const monitor = RESIDUAL.filter(cs => cs.delta >= 0.5 && cs.delta < 2 && cs.remainN >= 30);
  return monitor.length > 0
    ? monitor.map(cs => `- **${cs.label}**: delta=${fmtDelta(cs.delta)}`).join("\n")
    : "> なし";
})()}

### 凍結候補（採用不可）

- **2025-07 月別フィルター**: deltaExJul25=0pt — 後付き。未来で使えない
- **除外率 > 30% セット単独採用**: セットG(2R+5R+6R, ${COMP_SETS.find(s => s.id === "G")?.skipPct ?? "?"}%)など — サンプル集中効果の疑い

### 次に見るべき1本

${(() => {
  // Find which residual effect is strongest for weakR
  const weakRResiduals = RESIDUAL.slice(0, 3);
  const maxR = weakRResiduals.reduce((a, b) => b.delta > a.delta ? b : a);
  const badVResiduals = RESIDUAL.slice(3, 6);
  const maxV = badVResiduals.reduce((a, b) => b.delta > a.delta ? b : a);
  if (maxR.delta >= 3 && maxR.delta >= maxV.delta) {
    return `**weakR (${maxR.label})** が最強の独立効果 (delta=${fmtDelta(maxR.delta)})。\n次: 2R/5R/6R 単独 vs 複合の最小除外セット最適化 — どの R を切れば最小コストで最大改善か。`;
  } else if (maxV.delta >= 3) {
    return `**badVenue (${maxV.label})** が最強の独立効果 (delta=${fmtDelta(maxV.delta)})。\n次: 浜名湖/住之江 × 全raceNo の月別推移 — forward後半も0hitが続くか。`;
  }
  return "交差制御後の残差効果がいずれも small。次: より長期のデータ蓄積後に再評価。";
})()}

### 条件B n=200 到達までの判断保留事項

- 条件B (風速2〜4 × 1号艇展示1位 → 1-3-2) は現在 n=167 / top2除外ROI=91.08% / 直近3ヶ月0hit
- 現行 1-2-3 の skip-filter では条件B重複除外 delta=+2.65pt (exJul25=+1.84pt)
- **n=200 到達まで判断保留。app_settings 変更不可。**

---
*生成: analyze-roi-skip-interactions.ts*
`;

// ─── JSON 出力 ───────────────────────────────────────────────────────────────────

const jsonOut = {
  generatedAt: now,
  forwardStart: FORWARD_START,
  forwardEnd: dbMaxDate,
  recent3mCutoff,
  baseline: { n: totalN, hits: totalHits, roi: baselineRoi },
  compSets: COMP_SETS.map(s => ({ id: s.id, name: s.name, skipN: s.skipN, skipPct: s.skipPct, skipRoi: s.skipRoi, remainRoi: s.remainRoi, delta: s.delta })),
  condSets: COND_SETS.map(s => ({ id: s.id, name: s.name, baseN: s.baseN, baseRoi: s.baseRoi, skipN: s.skipN, skipPct: s.skipPct, skipRoi: s.skipRoi, remainRoi: s.remainRoi, delta: s.delta })),
  residuals: RESIDUAL.map(cs => ({ label: cs.label, baseN: cs.baseN, baseRoi: cs.baseRoi, skipN: cs.skipN, skipPct: cs.skipPct, skipRoi: cs.skipRoi, remainN: cs.remainN, remainRoi: cs.remainRoi, delta: cs.delta })),
};

// ─── 書き出し ────────────────────────────────────────────────────────────────────

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD,   md,                             "utf-8");
writeFileSync(OUT_JSON, JSON.stringify(jsonOut, null, 2), "utf-8");

console.log(`\n[interactions] 完了 → ${OUT_MD}`);
console.log(`  ベースライン: ${baselineRoi}% (n=${totalN})`);
console.log("\n  比較セット:");
COMP_SETS.forEach(s => console.log(`    [${s.id}] ${s.name}: skip ${s.skipPct}% / delta=${s.delta}pt / 残存ROI=${s.remainRoi}%`));
console.log("  条件付き:");
COND_SETS.forEach(s => console.log(`    [${s.id}] ${s.name}: ベースROI=${s.baseRoi}% / skip ${s.skipPct}% / delta=${s.delta}pt`));
console.log("\n  残差効果:");
RESIDUAL.forEach(cs => console.log(`    ${cs.label}: delta=${cs.delta}pt (n=${cs.skipN}/${cs.baseN})`));
