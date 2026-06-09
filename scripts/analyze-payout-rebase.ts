/**
 * analyze-payout-rebase.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 *
 * 目的: 過去スクリプト（roi-bad-conditions / 123-breakdown / suminoe-breakdown）で
 *       current_odds ベースで評価した全候補条件を、
 *       race_payouts.payout_yen 実払戻ベースで再集計し、3分類に整理する。
 *
 * 出力: reports/payout-rebase.md / reports/payout-rebase.json
 *
 * 3分類:
 *   A) switch候補  — 1-3-2変換で実払戻ROI >= 100%
 *   B) 除外候補    — 実払戻ROIが低い かつ 除外後残存が改善
 *   C) 楽観判定    — current_odds >= 100% だが 実払戻 < 95%（過信注意）
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD  = "reports/payout-rebase.md";
const OUT_JSON = "reports/payout-rebase.json";
const STAKE = 100;

const EXCLUDED_VENUES   = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACE_NOS = [10, 11, 12];

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

const BASE_WHERE = `
  decision='BUY' AND run_kind='historical-backfill'
  AND result IS NOT NULL AND result != ''
  AND venue NOT IN (${EXCLUDED_VENUES.map(v => `'${v}'`).join(",")})
  AND race_no NOT IN (${EXCLUDED_RACE_NOS.join(",")})
`;

// ─── WHERE スニペット ──────────────────────────────────────────────────────────

const EXH1_FASTEST = `EXISTS (SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
    AND ed.exhibition_time IS NOT NULL
    AND ed.exhibition_time = (
      SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2 WHERE ed2.race_id=dh.race_id
    ))`;

const EXH1_RANK23 = `EXISTS (
  SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
    AND ed.exhibition_time IS NOT NULL
    AND (SELECT COUNT(*) FROM exhibition_data ed2
          WHERE ed2.race_id=dh.race_id AND ed2.exhibition_time IS NOT NULL
            AND ed2.exhibition_time < ed.exhibition_time) BETWEEN 1 AND 2
)`;

const EXH1_RANK4PLUS = `EXISTS (
  SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
    AND ed.exhibition_time IS NOT NULL
    AND (SELECT COUNT(*) FROM exhibition_data ed2
          WHERE ed2.race_id=dh.race_id AND ed2.exhibition_time IS NOT NULL
            AND ed2.exhibition_time < ed.exhibition_time) >= 3
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

const BOAT3_FASTER = `EXISTS (
  SELECT 1 FROM race_entries re2
  JOIN exhibition_data ed2 ON ed2.race_id=re2.race_id AND ed2.course=re2.entry_course
  JOIN race_entries re3 ON re3.race_id=re2.race_id AND re3.boat=3
  JOIN exhibition_data ed3 ON ed3.race_id=re3.race_id AND ed3.course=re3.entry_course
  WHERE re2.race_id=dh.race_id AND re2.boat=2
    AND ed2.exhibition_time IS NOT NULL AND ed3.exhibition_time IS NOT NULL
    AND ed3.exhibition_time < ed2.exhibition_time
)`;

const WIND24 = `EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)`;

// ─── 型 ──────────────────────────────────────────────────────────────────────

type Stat = {
  label: string;
  n: number;
  hits: number;
  currentRoi: number;
  payoutRoi: number;
  gap: number;
};

type SwitchStat = Stat & {
  payoutRoi132: number;
  switchGain: number;
};

type ResidualStat = {
  label: string;
  excl: Stat;
  residual: Stat;
  baseCurrentRoi: number;
  basePayoutRoi: number;
  improvCurrent: number;
  improvPayout: number;
};

// ─── クエリ helpers ──────────────────────────────────────────────────────────

function stat(label: string, where: string, selFilter = ""): Stat {
  const selW = selFilter ? `AND ${selFilter}` : "";
  const condW = where ? `AND (${where})` : "";
  const r = db.prepare(`
    SELECT COUNT(*) as n,
      SUM(CASE WHEN result=selection THEN 1 ELSE 0 END) as hits,
      SUM(CASE WHEN result=selection THEN current_odds*${STAKE} ELSE 0 END) as cr,
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp
        WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination=dh.selection LIMIT 1), 0)) as pr
    FROM decision_history dh
    WHERE ${BASE_WHERE} ${selW} ${condW}
  `).get() as { n: number; hits: number; cr: number; pr: number };

  const n = r.n ?? 0;
  const stake = n * STAKE;
  const roi = (v: number) => stake > 0 ? Math.round(v / stake * 10000) / 100 : 0;
  const cr = roi(r.cr ?? 0);
  const pr = roi(r.pr ?? 0);
  return { label, n, hits: r.hits ?? 0, currentRoi: cr, payoutRoi: pr, gap: Math.round((cr - pr) * 100) / 100 };
}

function switchStat(label: string, where: string, selFilter = ""): SwitchStat {
  const selW = selFilter ? `AND ${selFilter}` : "";
  const condW = where ? `AND (${where})` : "";
  const r = db.prepare(`
    SELECT COUNT(*) as n,
      SUM(CASE WHEN result=selection THEN 1 ELSE 0 END) as hits,
      SUM(CASE WHEN result=selection THEN current_odds*${STAKE} ELSE 0 END) as cr,
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp
        WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination=dh.selection LIMIT 1), 0)) as pr,
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp
        WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-3-2' LIMIT 1), 0)) as pr132
    FROM decision_history dh
    WHERE ${BASE_WHERE} ${selW} ${condW}
  `).get() as { n: number; hits: number; cr: number; pr: number; pr132: number };

  const n = r.n ?? 0;
  const stake = n * STAKE;
  const roi = (v: number) => stake > 0 ? Math.round(v / stake * 10000) / 100 : 0;
  const cr = roi(r.cr ?? 0);
  const pr = roi(r.pr ?? 0);
  const pr132 = roi(r.pr132 ?? 0);
  return {
    label, n, hits: r.hits ?? 0,
    currentRoi: cr, payoutRoi: pr,
    gap: Math.round((cr - pr) * 100) / 100,
    payoutRoi132: pr132,
    switchGain: Math.round((pr132 - pr) * 100) / 100,
  };
}

function residualStat(label: string, excludeWhere: string, selFilter = ""): ResidualStat {
  const base = stat("ベースライン", "", selFilter);
  const excl = stat("除外対象", excludeWhere, selFilter);
  const rest = stat("残存", `NOT (${excludeWhere})`, selFilter);
  return {
    label,
    excl,
    residual: rest,
    baseCurrentRoi: base.currentRoi,
    basePayoutRoi: base.payoutRoi,
    improvCurrent: Math.round((rest.currentRoi - base.currentRoi) * 100) / 100,
    improvPayout:  Math.round((rest.payoutRoi  - base.payoutRoi)  * 100) / 100,
  };
}

// ─── 集計 ────────────────────────────────────────────────────────────────────

console.log("[payout-rebase] ベースライン集計...");
const BASE_ALL  = stat("全体",          "",              "");
const BASE_123  = stat("全体 sel=1-2-3", "",             "selection='1-2-3'");
console.log(`  全体: current=${BASE_ALL.currentRoi}% / payout=${BASE_ALL.payoutRoi}% / gap=${BASE_ALL.gap}pt`);
console.log(`  1-2-3: current=${BASE_123.currentRoi}% / payout=${BASE_123.payoutRoi}% / gap=${BASE_123.gap}pt`);

// ── A) switch候補（1-3-2 変換で payout >= 100%） ────────────────────────────

console.log("\n[payout-rebase] switch候補...");
const SWITCH_CANDS: { label: string; where: string; sel?: string }[] = [
  { label: "風速2〜4 × 1号艇展示1位",   where: `${WIND24} AND ${EXH1_FASTEST}`,                                    sel: "selection='1-2-3'" },
  { label: "住之江 × odds40〜49",        where: "venue='住之江' AND current_odds>=40 AND current_odds<50",          sel: "selection='1-2-3'" },
  { label: "住之江 × 1号艇展示1位",     where: `venue='住之江' AND ${EXH1_FASTEST}`,                               sel: "selection='1-2-3'" },
  { label: "3号艇が2号艇より展示速い",  where: BOAT3_FASTER,                                                       sel: "selection='1-2-3'" },
  { label: "1号艇展示1位 全体",         where: EXH1_FASTEST,                                                       sel: "selection='1-2-3'" },
  { label: "住之江 × 5R",              where: "venue='住之江' AND race_no=5",                                      sel: "selection='1-2-3'" },
];

const switchResults: SwitchStat[] = [];
for (const c of SWITCH_CANDS) {
  const r = switchStat(c.label, c.where, c.sel);
  switchResults.push(r);
  console.log(`  ${c.label}: n=${r.n} payout1-2-3=${r.payoutRoi}% → 1-3-2=${r.payoutRoi132}% (+${r.switchGain}pt)`);
}

// ── B) 除外候補（実払戻ROI が低く、除外後に残存が改善） ──────────────────────

console.log("\n[payout-rebase] 除外候補（残存ROI改善）...");
const EXCL_CANDS: { label: string; where: string; sel?: string }[] = [
  { label: "1号艇展示1位 除外",          where: EXH1_FASTEST,                                                      sel: "selection='1-2-3'" },
  { label: "5R 除外",                   where: "race_no=5",                                                       sel: "selection='1-2-3'" },
  { label: "odds 80以上 除外",           where: "current_odds>=80",                                               sel: "selection='1-2-3'" },
  { label: "風速2〜4m/s 除外",           where: WIND24,                                                            sel: "selection='1-2-3'" },
  { label: "住之江 全除外",             where: "venue='住之江'",                                                   sel: "selection='1-2-3'" },
  { label: "住之江 × odds40〜49 除外",   where: "venue='住之江' AND current_odds>=40 AND current_odds<50",         sel: "selection='1-2-3'" },
  { label: "3号艇が2号艇より展示速い 除外", where: BOAT3_FASTER,                                                  sel: "selection='1-2-3'" },
];

const residuals: ResidualStat[] = [];
for (const c of EXCL_CANDS) {
  const r = residualStat(c.label, c.where, c.sel);
  residuals.push(r);
  console.log(`  ${c.label}: 除外n=${r.excl.n} 残存payout=${r.residual.payoutRoi}% (+${r.improvPayout}pt)`);
}

// ── C) current_odds楽観判定（current >= 100% だが payout < 95%） ───────────────

console.log("\n[payout-rebase] 楽観判定チェック...");
const CHECK_CANDS: { label: string; where: string; sel?: string }[] = [
  { label: "2号艇が3号艇より展示速い",   where: BOAT2_FASTER,   sel: "selection='1-2-3'" },
  { label: "1号艇展示タイム2〜3位",      where: EXH1_RANK23,    sel: "selection='1-2-3'" },
  { label: "1号艇展示タイム4位以下",     where: EXH1_RANK4PLUS, sel: "selection='1-2-3'" },
  { label: "住之江 × odds25〜39",        where: "venue='住之江' AND current_odds>=25 AND current_odds<40", sel: "selection='1-2-3'" },
];

const optimisticCheck: Stat[] = [];
for (const c of CHECK_CANDS) {
  const r = stat(c.label, c.where, c.sel);
  optimisticCheck.push(r);
  const flag = r.currentRoi >= 100 && r.payoutRoi < 95 ? "⚠️楽観" : r.payoutRoi >= 100 ? "✅有望" : "—";
  console.log(`  ${c.label}: current=${r.currentRoi}% / payout=${r.payoutRoi}% ${flag}`);
}

// ─── 複合除外のシミュレーション ───────────────────────────────────────────────

console.log("\n[payout-rebase] 複合除外シミュレーション...");
const COMBO_EXCLS: { label: string; where: string }[] = [
  {
    label: "1号艇展示1位 + 5R 除外",
    where: `(${EXH1_FASTEST}) OR race_no=5`,
  },
  {
    label: "1号艇展示1位 + 5R + 風速2〜4 除外",
    where: `(${EXH1_FASTEST}) OR race_no=5 OR (${WIND24})`,
  },
  {
    label: "1号艇展示1位 + 5R + 住之江 除外",
    where: `(${EXH1_FASTEST}) OR race_no=5 OR venue='住之江'`,
  },
];

const comboResults: ResidualStat[] = [];
for (const c of COMBO_EXCLS) {
  const r = residualStat(c.label, c.where, "selection='1-2-3'");
  comboResults.push(r);
  console.log(`  ${c.label}: 除外n=${r.excl.n} 残存n=${r.residual.n} payout=${r.residual.payoutRoi}% (+${r.improvPayout}pt)`);
}

// ─── Markdown 生成 ────────────────────────────────────────────────────────────

const switchConfirmed = switchResults.filter(r => r.payoutRoi132 >= 100);
const switchPending   = switchResults.filter(r => r.payoutRoi132 < 100 && r.payoutRoi132 > r.payoutRoi);
const exclEffective   = residuals.filter(r => r.improvPayout > 0);
const optimisticWarn  = optimisticCheck.filter(r => r.currentRoi >= 100 && r.payoutRoi < 95);

let md = `# payout_yen 基準 全候補再集計レポート

生成日時: ${new Date().toISOString()}
DB: ${DB_PATH}

> 過去スクリプト（roi-bad-conditions / 123-breakdown / suminoe-breakdown / odds-payout-gap）で
> current_odds ベースで評価した候補を、race_payouts.payout_yen 実払戻ベースで再整理。
> このレポートは読み取り専用分析。本番ロジック変更は含まない。

---

## ベースライン（実払戻基準）

| 対象 | n | current_odds ROI | 実払戻 ROI | **gap** |
|---|---|---|---|---|
| 全体 | ${BASE_ALL.n} | ${BASE_ALL.currentRoi}% | **${BASE_ALL.payoutRoi}%** | ${BASE_ALL.gap}pt |
| selection=1-2-3 | ${BASE_123.n} | ${BASE_123.currentRoi}% | **${BASE_123.payoutRoi}%** | ${BASE_123.gap}pt |

> **現時点の実払戻ベース ROI は ${BASE_123.payoutRoi}%（黒字圏外）**
> 除外・switch でここを引き上げることが目標。

---

## 分類 A: switch候補（1-3-2変換で実払戻 >= 100%）

| 条件 | n | current1-2-3 | payout1-2-3 | **payout1-3-2** | switch改善 | 判定 |
|---|---|---|---|---|---|---|
${switchResults.map(r => {
  const verdict = r.payoutRoi132 >= 100 ? "✅ 確定switch候補" : r.payoutRoi132 > r.payoutRoi + 10 ? "🔶 改善あり（100%未満）" : "保留";
  return `| ${r.label} | ${r.n} | ${r.currentRoi}% | ${r.payoutRoi}% | **${r.payoutRoi132}%** | +${r.switchGain}pt | ${verdict} |`;
}).join("\n")}

### 確定 switch候補（実払戻 1-3-2 >= 100%）
${switchConfirmed.length === 0 ? "- なし" : switchConfirmed.map(r =>
  `- **${r.label}**: n=${r.n} / 実払戻 1-3-2 = ${r.payoutRoi132}%`
).join("\n")}

### 保留（改善あり、100%未満）
${switchPending.length === 0 ? "- なし" : switchPending.map(r =>
  `- **${r.label}**: n=${r.n} / 実払戻 1-3-2 = ${r.payoutRoi132}% (payout1-2-3より+${r.switchGain}pt)`
).join("\n")}

---

## 分類 B: 除外候補（除外後に残存ROIが実払戻ベースで改善）

| 除外条件 | 除外n | 残存n | 残存 current ROI | 残存 payout ROI | 実払戻改善幅 | 判定 |
|---|---|---|---|---|---|---|
${residuals.map(r => {
  const verdict = r.improvPayout > 5 ? "✅ 有効" : r.improvPayout > 0 ? "🔶 微改善" : "⚠️効果なし";
  return `| ${r.label} | ${r.excl.n} | ${r.residual.n} | ${r.residual.currentRoi}% | **${r.residual.payoutRoi}%** | +${r.improvPayout}pt | ${verdict} |`;
}).join("\n")}

> ベースライン: current=${BASE_123.currentRoi}% / payout=${BASE_123.payoutRoi}%

### 実払戻で有効な除外候補（improvPayout > 0）
${exclEffective.length === 0 ? "- なし" : exclEffective.map(r =>
  `- **${r.label}**: 残存payout=${r.residual.payoutRoi}% / +${r.improvPayout}pt`
).join("\n")}

---

## 複合除外シミュレーション（実払戻ベース）

| 複合除外 | 除外n | 残存n | 残存 payout ROI | ベースから改善 |
|---|---|---|---|---|
${comboResults.map(r => `| ${r.label} | ${r.excl.n} | ${r.residual.n} | **${r.residual.payoutRoi}%** | +${r.improvPayout}pt |`).join("\n")}

> 黒字圏（>= 100%）到達に何が必要かを確認する指標。

---

## 分類 C: current_odds楽観判定（過信注意）

| 条件 | n | current_odds ROI | 実払戻 ROI | gap | 判定 |
|---|---|---|---|---|---|
${optimisticCheck.map(r => {
  const verdict = r.currentRoi >= 100 && r.payoutRoi < 95 ? "⚠️ current_odds楽観" : r.payoutRoi >= 100 ? "✅ 実払戻でも有望" : "—";
  return `| ${r.label} | ${r.n} | ${r.currentRoi}% | ${r.payoutRoi}% | ${r.gap}pt | ${verdict} |`;
}).join("\n")}

### current_odds >= 100% だが実払戻 < 95% の条件（過信注意）
${optimisticWarn.length === 0 ? "- なし（楽観判定はベースライン全体レベルのみ）" : optimisticWarn.map(r =>
  `- **${r.label}**: current=${r.currentRoi}% → payout=${r.payoutRoi}% (gap=${r.gap}pt)`
).join("\n")}

---

## paper-forward 候補一覧（実払戻基準・優先度順）

### Switch候補（優先度: 最高）
> 実払戻 1-3-2 >= 100%。app_settings は変更しない。観察のみ。

| 優先 | 条件 | 変換 | n | 実払戻1-3-2 |
|---|---|---|---|---|
${switchConfirmed.map((r, i) => `| ${i+1} | ${r.label} | 1-2-3 → **1-3-2** | ${r.n} | ${r.payoutRoi132}% |`).join("\n")}

> n が 50 未満（住之江系）は forward で再現性確認が必須。

### 除外候補（優先度: 高）
> 実払戻ベースで改善幅が大きい順。除外後も黒字とは限らない点に注意。

| 優先 | 条件 | 除外n | 残存payout ROI | 実払戻改善 |
|---|---|---|---|---|
${[...exclEffective].sort((a, b) => b.improvPayout - a.improvPayout).map((r, i) =>
  `| ${i+1} | ${r.label} | ${r.excl.n} | ${r.residual.payoutRoi}% | +${r.improvPayout}pt |`
).join("\n")}

---

## ROI判断基準 変更まとめ

| 項目 | 旧基準 | 新基準 |
|---|---|---|
| 主評価軸 | current_odds * 100 | **race_payouts.payout_yen** |
| 補助評価 | — | current_odds（参考のみ） |
| gap > 10pt の条件 | current_odds で判断 | **実払戻で再確認必須** |
| paper-forward 記録 | 任意 | **実払戻を記録する** |

> current_odds は締切前の暫定値。実際払戻とのgapは条件によって 3〜18pt 変動する。
> gap が大きい条件（風速2〜4など）は current_odds 判断を信頼しない。
`;

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");
writeFileSync(OUT_JSON, JSON.stringify({
  generatedAt: new Date().toISOString(),
  baseline: { all: BASE_ALL, sel123: BASE_123 },
  switchResults,
  residuals,
  comboResults,
  optimisticCheck,
  paperForward: {
    switch: switchConfirmed.map(r => ({ label: r.label, n: r.n, payoutRoi132: r.payoutRoi132 })),
    exclude: [...exclEffective].sort((a, b) => b.improvPayout - a.improvPayout).map(r => ({
      label: r.label, exclN: r.excl.n, residualPayoutRoi: r.residual.payoutRoi, improvPayout: r.improvPayout,
    })),
  },
}, null, 2), "utf-8");

console.log(`\n[payout-rebase] 完了 → ${OUT_MD}`);
console.log(`\n【paper-forward候補 サマリ】`);
console.log(`  === switch候補（実払戻1-3-2 >= 100%）===`);
switchConfirmed.forEach((r, i) => console.log(`  ${i+1}. ${r.label}: payout1-3-2=${r.payoutRoi132}% (n=${r.n})`));
console.log(`  === 除外候補（実払戻改善 > 0pt）===`);
[...exclEffective].sort((a, b) => b.improvPayout - a.improvPayout).forEach((r, i) =>
  console.log(`  ${i+1}. ${r.label}: 残存payout=${r.residual.payoutRoi}% (+${r.improvPayout}pt)`)
);
if (optimisticWarn.length > 0) {
  console.log(`  === ⚠️ current_odds楽観（過信注意）===`);
  optimisticWarn.forEach(r => console.log(`     ${r.label}: current=${r.currentRoi}% → payout=${r.payoutRoi}%`));
}
