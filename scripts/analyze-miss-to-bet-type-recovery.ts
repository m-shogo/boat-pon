/**
 * analyze-miss-to-bet-type-recovery.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 *
 * 目的: 現行3連単BUYの外れを別券種なら救えたかを分析する。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/miss-to-bet-type-recovery.md";
const OUT_JSON = "reports/miss-to-bet-type-recovery.json";
const STAKE = 100;

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

// ─── データ取得 ──────────────────────────────────────────────────────────────

type RawRow = {
  race_id: string; date: string; venue: string; race_no: number;
  selection: string; result: string; current_odds: number | null;
};

const rows = db.prepare(`
  SELECT race_id, date, venue, race_no, selection, result, current_odds
  FROM decision_history
  WHERE decision='BUY' AND run_kind='historical-backfill'
    AND result IS NOT NULL AND result != ''
  ORDER BY date
`).all() as RawRow[];

type PayoutRow = { race_id: string; bet_type: string; combination: string; payout_yen: number | null; returned: number };

const payoutIndex = new Map<string, number>();
const returnedSet = new Set<string>();
for (const p of db.prepare(`
  SELECT race_id, bet_type, combination, payout_yen, returned
  FROM race_payouts WHERE bet_type IN ('exacta','quinella','wide','trifecta','trio')
`).all() as PayoutRow[]) {
  const key = `${p.race_id}|${p.bet_type}|${p.combination}`;
  payoutIndex.set(key, p.payout_yen ?? 0);
  if (p.returned) returnedSet.add(key);
}

// ─── ユーティリティ ──────────────────────────────────────────────────────────

function sel(s: string) { return s.split("-").map(Number); }
function sp(a: number, b: number) { return a < b ? `${a}-${b}` : `${b}-${a}`; }
function st(a: number, b: number, c: number) { return [a,b,c].sort((x,y)=>x-y).join("-"); }
function hasPayout(raceId: string, bt: string, comb: string): { hit: boolean; payout: number } {
  const key = `${raceId}|${bt}|${comb}`;
  if (returnedSet.has(key)) return { hit: false, payout: 0 };
  const p = payoutIndex.get(key);
  if (p !== undefined && p > 0) return { hit: true, payout: p };
  return { hit: false, payout: 0 };
}

// ─── ミスタイプ分類 ──────────────────────────────────────────────────────────

type MissType =
  | "3連単的中"
  | "3連複なら的中"
  | "2連単なら的中"
  | "2連複なら的中"
  | "拡連複なら的中"
  | "全部ダメ";

type SelectionAccuracy =
  | "1着完全一致"
  | "1着はTop3内"
  | "3艇全部Top3内"
  | "2/3着だけ逆"
  | "上位2艇絡み"
  | "完全外れ";

type RecoveryRow = {
  raceId: string; date: string; venue: string; raceNo: number;
  selection: string; result: string;
  missType: MissType;
  selAccuracy: SelectionAccuracy;
  trifectaHit: boolean; trioHit: boolean; exactaHit: boolean;
  quinellaHit: boolean; wideHit: boolean;
  trioPayout: number; exactaPayout: number; quinellaPayout: number; widePayout: number;
  trifectaPayout: number;
};

const analyzed: RecoveryRow[] = [];

for (const row of rows) {
  const [s1, s2, s3] = sel(row.selection);
  const result = sel(row.result);
  const [r1, r2, r3] = result;
  const raceId = row.race_id;

  const trifectaComb = `${s1}-${s2}-${s3}`;
  const trioComb = st(s1, s2, s3);
  const exactaComb = `${s1}-${s2}`;
  const quinellaComb = sp(s1, s2);
  const wideComb = sp(s1, s2);

  const trifecta = hasPayout(raceId, "trifecta", trifectaComb);
  const trio = hasPayout(raceId, "trio", trioComb);
  const exacta = hasPayout(raceId, "exacta", exactaComb);
  const quinella = hasPayout(raceId, "quinella", quinellaComb);
  const wide = hasPayout(raceId, "wide", wideComb);

  // ミスタイプ
  let missType: MissType;
  if (trifecta.hit) missType = "3連単的中";
  else if (trio.hit) missType = "3連複なら的中";
  else if (exacta.hit) missType = "2連単なら的中";
  else if (quinella.hit) missType = "2連複なら的中";
  else if (wide.hit) missType = "拡連複なら的中";
  else missType = "全部ダメ";

  // 選択精度
  const selSet = new Set([s1, s2, s3]);
  const top3Set = new Set([r1, r2, r3]);

  let selAccuracy: SelectionAccuracy;
  if (r1 === s1 && r2 === s2 && r3 === s3) selAccuracy = "1着完全一致"; // (trifecta hit)
  else if (r1 === s1 && r2 === s2) selAccuracy = "2/3着だけ逆";
  else if (r1 === s1 && top3Set.has(s2) && top3Set.has(s3)) selAccuracy = "1着完全一致";
  else if (r1 === s1) selAccuracy = "1着はTop3内";
  else if ([...selSet].every(b => top3Set.has(b))) selAccuracy = "3艇全部Top3内";
  else if (top3Set.has(s1) && top3Set.has(s2)) selAccuracy = "上位2艇絡み";
  else selAccuracy = "完全外れ";

  analyzed.push({
    raceId, date: row.date, venue: row.venue, raceNo: row.race_no,
    selection: row.selection, result: row.result,
    missType, selAccuracy,
    trifectaHit: trifecta.hit, trioHit: trio.hit, exactaHit: exacta.hit,
    quinellaHit: quinella.hit, wideHit: wide.hit,
    trifectaPayout: trifecta.payout, trioPayout: trio.payout,
    exactaPayout: exacta.payout, quinellaPayout: quinella.payout,
    widePayout: wide.payout,
  });
}

// ─── 集計 ────────────────────────────────────────────────────────────────────

const total = analyzed.length;

function countAndRate<T extends string>(field: keyof RecoveryRow & string, values: T[]) {
  return values.map(v => {
    const n = analyzed.filter(r => r[field] === v).length;
    return { value: v, n, rate: Math.round(n / total * 10000) / 100 };
  });
}

const missTypeBreakdown = countAndRate("missType", [
  "3連単的中","3連複なら的中","2連単なら的中","2連複なら的中","拡連複なら的中","全部ダメ"
] as MissType[]);

const selAccBreakdown = countAndRate("selAccuracy", [
  "1着完全一致","2/3着だけ逆","3艇全部Top3内","1着はTop3内","上位2艇絡み","完全外れ"
] as SelectionAccuracy[]);

// 券種変換ROI（全BUYに対して別券種を買ったとした場合）
function altROI(betType: "trio"|"exacta"|"quinella"|"wide", field: keyof RecoveryRow & string) {
  const hits = analyzed.filter(r => r[field] as boolean);
  const totalReturn = analyzed.reduce((s, r) => s + (r[field as keyof RecoveryRow] as number), 0);
  return {
    hits: hits.length,
    totalReturn,
    roi: Math.round(totalReturn / (total * STAKE) * 10000) / 100,
  };
}

const altStats = {
  trio: { hits: analyzed.filter(r=>r.trioHit).length, totalReturn: analyzed.reduce((s,r)=>s+r.trioPayout,0) },
  exacta: { hits: analyzed.filter(r=>r.exactaHit).length, totalReturn: analyzed.reduce((s,r)=>s+r.exactaPayout,0) },
  quinella: { hits: analyzed.filter(r=>r.quinellaHit).length, totalReturn: analyzed.reduce((s,r)=>s+r.quinellaPayout,0) },
  wide: { hits: analyzed.filter(r=>r.wideHit).length, totalReturn: analyzed.reduce((s,r)=>s+r.widePayout,0) },
};
for (const [,v] of Object.entries(altStats)) {
  (v as { roi?: number }).roi = Math.round((v as { totalReturn: number }).totalReturn / (total * STAKE) * 10000) / 100;
}

// 会場別 miss分布
const venueMap = new Map<string, { total: number; trioHit: number; exactaHit: number; quinellaHit: number; allMiss: number }>();
for (const r of analyzed) {
  const v = r.venue;
  if (!venueMap.has(v)) venueMap.set(v, { total: 0, trioHit: 0, exactaHit: 0, quinellaHit: 0, allMiss: 0 });
  const e = venueMap.get(v)!;
  e.total++;
  if (r.trioHit) e.trioHit++;
  if (r.exactaHit) e.exactaHit++;
  if (r.quinellaHit) e.quinellaHit++;
  if (r.missType === "全部ダメ") e.allMiss++;
}

// race_no別
const raceNoMap = new Map<number, { total: number; trioHit: number; quinellaHit: number; allMiss: number }>();
for (const r of analyzed) {
  const rn = r.raceNo;
  if (!raceNoMap.has(rn)) raceNoMap.set(rn, { total: 0, trioHit: 0, quinellaHit: 0, allMiss: 0 });
  const e = raceNoMap.get(rn)!;
  e.total++;
  if (r.trioHit) e.trioHit++;
  if (r.quinellaHit) e.quinellaHit++;
  if (r.missType === "全部ダメ") e.allMiss++;
}

// ─── Markdown ────────────────────────────────────────────────────────────────

const pct = (v: number) => v.toFixed(1) + "%";

let md = `# 3連単外れ → 別券種回収分析

生成日時: ${new Date().toISOString()}
DB: ${DB_PATH}

- 対象: ${total.toLocaleString()} レース (BUY, historical-backfill, result あり)

## ミスタイプ分類

| ミスタイプ | 件数 | 割合 |
|---|---|---|
${missTypeBreakdown.map(r => `| ${r.value} | ${r.n} | ${pct(r.rate)} |`).join("\n")}

## 選択精度分類

| 選択精度 | 件数 | 割合 |
|---|---|---|
${selAccBreakdown.map(r => `| ${r.value} | ${r.n} | ${pct(r.rate)} |`).join("\n")}

## 別券種に切り替えた場合の ROI（全${total}レース）

| 券種 | 的中数 | 総回収 | ROI |
|---|---|---|---|
| 3連複 (trio) | ${altStats.trio.hits} | ${altStats.trio.totalReturn.toLocaleString()}円 | **${(altStats.trio as {roi?:number}).roi}%** |
| 2連単 (exacta) | ${altStats.exacta.hits} | ${altStats.exacta.totalReturn.toLocaleString()}円 | **${(altStats.exacta as {roi?:number}).roi}%** |
| 2連複 (quinella) | ${altStats.quinella.hits} | ${altStats.quinella.totalReturn.toLocaleString()}円 | **${(altStats.quinella as {roi?:number}).roi}%** |
| 拡連複 (wide) | ${altStats.wide.hits} | ${altStats.wide.totalReturn.toLocaleString()}円 | **${(altStats.wide as {roi?:number}).roi}%** |

> 3連単BUYをそのまま上記券種に置き換えた場合の理論ROI。

## 会場別 miss・回収分布 (上位10会場)

| 会場 | total | trio的中 | exacta的中 | quinella的中 | 全外れ率 |
|---|---|---|---|---|---|
${[...venueMap.entries()].sort((a,b)=>b[1].total-a[1].total).slice(0,10).map(([v,e]) =>
  `| ${v} | ${e.total} | ${e.trioHit} | ${e.exactaHit} | ${e.quinellaHit} | ${pct(e.allMiss/e.total*100)} |`
).join("\n")}

## レース番号別 miss分布

| race_no | total | trio的中 | quinella的中 | 全外れ率 |
|---|---|---|---|---|
${[...raceNoMap.entries()].sort((a,b)=>a[0]-b[0]).map(([rn,e]) =>
  `| ${rn}R | ${e.total} | ${e.trioHit} | ${e.quinellaHit} | ${pct(e.allMiss/e.total*100)} |`
).join("\n")}

## 解釈ガイド

- **2/3着だけ逆**: 1着は当たったが2/3着が逆。3連単 → 3連複か2連複に変えると救える場合がある。
- **3艇全部Top3内**: 順番が違うだけ。3連複なら的中の最多パターン。
- **全部ダメ**: selection 自体が外れ。券種変換では救えない。
- ROI < 100% は現行選択の期待値自体が低いことを示す。券種変換で改善幅を確認すること。
`;

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");
writeFileSync(OUT_JSON, JSON.stringify({
  generatedAt: new Date().toISOString(), total, missTypeBreakdown, selAccBreakdown, altStats,
}, null, 2), "utf-8");

console.log(`[miss-recovery] 完了 → ${OUT_MD}`);
console.log(`  全部ダメ: ${missTypeBreakdown.find(r=>r.value==="全部ダメ")?.n}件 (${missTypeBreakdown.find(r=>r.value==="全部ダメ")?.rate}%)`);
console.log(`  3連複なら的中: ${missTypeBreakdown.find(r=>r.value==="3連複なら的中")?.n}件`);
