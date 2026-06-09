/**
 * analyze-odds-payout-gap.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 *
 * 目的: decision_history.current_odds ベース ROI と
 *       race_payouts.payout_yen 実払戻ベース ROI の乖離構造を分析し、
 *       過去の候補条件を実払戻ベースで再評価する。
 *
 * 背景: 1-2-3 全体で current_odds ベース ≈ 100.12%、実払戻ベース = 86.29%
 *       約 13.8pt の乖離が判明。過去の除外候補等は current_odds ベースで評価されていた。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD  = "reports/odds-payout-gap.md";
const OUT_JSON = "reports/odds-payout-gap.json";
const STAKE = 100;

const EXCLUDED_VENUES   = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACE_NOS = [10, 11, 12];

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

// ─── 型 ──────────────────────────────────────────────────────────────────────

type GapResult = {
  label: string;
  n: number;
  hits: number;
  coverageRate: number;          // race_payouts で trifecta がある割合
  currentOddsRoi: number;        // current_odds * 100 ベース
  payoutRoi: number;             // race_payouts.payout_yen ベース
  gap: number;                   // currentOddsRoi - payoutRoi
  avgCurrentOdds: number;        // 的中時の平均 current_odds
  avgPayoutOdds: number;         // 的中時の平均 payout_yen / 100
  verdict: "実払戻でも有望" | "current_odds楽観" | "要注意" | "採用不可";
};

type ResidualResult = {
  label: string;
  // 除外対象
  excluded: { n: number; currentRoi: number; payoutRoi: number };
  // 除外後残存
  residual: { n: number; currentRoi: number; payoutRoi: number };
  // 全体ベースライン
  baseline: { currentRoi: number; payoutRoi: number };
  // 改善幅 (residual - baseline)
  improvement: { current: number; payout: number };
};

// ─── WHERE 定義 ──────────────────────────────────────────────────────────────

const BASE_WHERE = `
  decision='BUY' AND run_kind='historical-backfill'
  AND result IS NOT NULL AND result != ''
  AND venue NOT IN (${EXCLUDED_VENUES.map(v => `'${v}'`).join(",")})
  AND race_no NOT IN (${EXCLUDED_RACE_NOS.join(",")})
`;

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

// ─── コアクエリ（1条件につき両ベースを1クエリで集計） ────────────────────────

function analyzeGap(label: string, extraWhere: string, selectionFilter = ""): GapResult {
  const selWhere = selectionFilter ? `AND ${selectionFilter}` : "";
  const condWhere = extraWhere ? `AND ${extraWhere}` : "";

  const row = db.prepare(`
    SELECT
      COUNT(*) as n,
      SUM(CASE WHEN result=selection THEN 1 ELSE 0 END) as hits,
      -- trifecta カバレッジ確認
      SUM(CASE WHEN EXISTS (SELECT 1 FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta') THEN 1 ELSE 0 END) as covered,
      -- current_odds ベース return
      SUM(CASE WHEN result=selection THEN current_odds*${STAKE} ELSE 0 END) as current_return,
      -- payout_yen ベース return（3連単 selection組み合わせで検索）
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp
        WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination=dh.selection LIMIT 1), 0)) as payout_return,
      -- 的中時の平均 current_odds
      AVG(CASE WHEN result=selection THEN current_odds ELSE NULL END) as avg_current_odds,
      -- 的中時の平均実払戻倍率（payout_yen / 100）
      AVG(CASE WHEN result=selection THEN
        COALESCE((SELECT rp.payout_yen / 100.0 FROM race_payouts rp
          WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination=dh.selection LIMIT 1), NULL)
        ELSE NULL END) as avg_payout_odds
    FROM decision_history dh
    WHERE ${BASE_WHERE} ${selWhere} ${condWhere}
  `).get() as {
    n: number; hits: number; covered: number;
    current_return: number; payout_return: number;
    avg_current_odds: number | null; avg_payout_odds: number | null;
  };

  const n = row.n ?? 0;
  const stake = n * STAKE;
  const cr = stake > 0 ? Math.round((row.current_return ?? 0) / stake * 10000) / 100 : 0;
  const pr = stake > 0 ? Math.round((row.payout_return ?? 0) / stake * 10000) / 100 : 0;
  const gap = Math.round((cr - pr) * 100) / 100;
  const avgCo = row.avg_current_odds != null ? Math.round(row.avg_current_odds * 100) / 100 : 0;
  const avgPo = row.avg_payout_odds  != null ? Math.round(row.avg_payout_odds  * 100) / 100 : 0;

  let verdict: GapResult["verdict"];
  if (pr >= 100) verdict = "実払戻でも有望";
  else if (cr >= 100 && pr < 95) verdict = "current_odds楽観";
  else if (gap >= 10) verdict = "要注意";
  else verdict = "採用不可";

  return {
    label, n, hits: row.hits ?? 0,
    coverageRate: n > 0 ? Math.round((row.covered ?? 0) / n * 10000) / 100 : 0,
    currentOddsRoi: cr, payoutRoi: pr, gap,
    avgCurrentOdds: avgCo, avgPayoutOdds: avgPo,
    verdict,
  };
}

// ─── 残存ROI改善幅（両ベースで比較） ──────────────────────────────────────────

function analyzeResidual(
  label: string,
  excludeWhere: string,
  selectionFilter = ""
): ResidualResult {
  const baseResult = analyzeGap("ベースライン", "", selectionFilter);
  const exclResult = analyzeGap("除外対象", excludeWhere, selectionFilter);
  const restResult = analyzeGap("残存", `NOT (${excludeWhere})`, selectionFilter);

  return {
    label,
    excluded: { n: exclResult.n, currentRoi: exclResult.currentOddsRoi, payoutRoi: exclResult.payoutRoi },
    residual: { n: restResult.n, currentRoi: restResult.currentOddsRoi, payoutRoi: restResult.payoutRoi },
    baseline: { currentRoi: baseResult.currentOddsRoi, payoutRoi: baseResult.payoutRoi },
    improvement: {
      current: Math.round((restResult.currentOddsRoi - baseResult.currentOddsRoi) * 100) / 100,
      payout:  Math.round((restResult.payoutRoi  - baseResult.payoutRoi)  * 100) / 100,
    },
  };
}

// ─── 全条件集計 ───────────────────────────────────────────────────────────────

console.log("[odds-payout-gap] 分析開始...");

const CONDITIONS: { id: string; label: string; where: string; sel?: string }[] = [
  { id: "all",           label: "A. 全体",                          where: "" },
  { id: "sel123",        label: "B. selection=1-2-3",               where: "",                    sel: "selection='1-2-3'" },
  { id: "exh1_fastest",  label: "C. 1号艇展示タイム1位",              where: EXH1_FASTEST,          sel: "selection='1-2-3'" },
  { id: "exh1_rank23",   label: "D. 1号艇展示タイム2〜3位",           where: EXH1_RANK23,           sel: "selection='1-2-3'" },
  { id: "exh1_rank4p",   label: "E. 1号艇展示タイム4位以下",          where: EXH1_RANK4PLUS,        sel: "selection='1-2-3'" },
  { id: "race5",         label: "F. 5R",                           where: "race_no=5",            sel: "selection='1-2-3'" },
  { id: "odds80p",       label: "G. odds 80以上",                   where: "current_odds>=80",     sel: "selection='1-2-3'" },
  { id: "suminoe",       label: "H. 住之江",                        where: "venue='住之江'",        sel: "selection='1-2-3'" },
  { id: "suminoe_o40",   label: "I. 住之江 × odds40〜49",            where: "venue='住之江' AND current_odds>=40 AND current_odds<50", sel: "selection='1-2-3'" },
  { id: "suminoe_exh1",  label: "J. 住之江 × 1号艇展示1位",          where: `venue='住之江' AND ${EXH1_FASTEST}`,                     sel: "selection='1-2-3'" },
  { id: "wind24",        label: "K. 風速2〜4m/s",                   where: WIND24,                 sel: "selection='1-2-3'" },
  { id: "wind24_exh1",   label: "L. 風速2〜4 × 1号艇展示1位",        where: `${WIND24} AND ${EXH1_FASTEST}`,                         sel: "selection='1-2-3'" },
  { id: "boat2_faster",  label: "M. 2号艇が3号艇より展示速い",        where: BOAT2_FASTER,           sel: "selection='1-2-3'" },
  { id: "boat3_faster",  label: "N. 3号艇が2号艇より展示速い",        where: BOAT3_FASTER,           sel: "selection='1-2-3'" },
];

const gaps: GapResult[] = [];
for (const c of CONDITIONS) {
  process.stdout.write(`  ${c.id}... `);
  const r = analyzeGap(c.label, c.where, c.sel);
  gaps.push(r);
  console.log(`n=${r.n} / current=${r.currentOddsRoi}% / payout=${r.payoutRoi}% / gap=${r.gap}pt`);
}

// ─── 残存ROI改善幅の再評価（過去候補条件） ────────────────────────────────────

console.log("\n[odds-payout-gap] 残存ROI改善幅の再評価...");

const RESIDUAL_CANDIDATES: { id: string; label: string; where: string; sel?: string }[] = [
  { id: "excl_exh1",      label: "1号艇展示1位 除外",                 where: EXH1_FASTEST,           sel: "selection='1-2-3'" },
  { id: "excl_race5",     label: "5R 除外",                          where: "race_no=5",             sel: "selection='1-2-3'" },
  { id: "excl_odds80",    label: "odds 80以上 除外",                  where: "current_odds>=80",      sel: "selection='1-2-3'" },
  { id: "excl_suminoe",   label: "住之江 全除外",                     where: "venue='住之江'",         sel: "selection='1-2-3'" },
  { id: "excl_suminoe40", label: "住之江 × odds40〜49 除外",          where: "venue='住之江' AND current_odds>=40 AND current_odds<50", sel: "selection='1-2-3'" },
  { id: "excl_wind24",    label: "風速2〜4m/s 除外",                  where: WIND24,                  sel: "selection='1-2-3'" },
];

const residuals: ResidualResult[] = [];
for (const c of RESIDUAL_CANDIDATES) {
  process.stdout.write(`  ${c.id}... `);
  const r = analyzeResidual(c.label, c.where, c.sel);
  residuals.push(r);
  console.log(`除外n=${r.excluded.n} / 残存 current+${r.improvement.current}pt payout+${r.improvement.payout}pt`);
}

// ─── switch シナリオ（1-3-2 変換）の payout ベース ROI ────────────────────────

console.log("\n[odds-payout-gap] switch シナリオ（実払戻 1-3-2）...");

type SwitchResult = {
  label: string; n: number;
  currentRoi123: number;
  payoutRoi123: number;
  payoutRoi132: number;
  switchGain: number;
};

function analyzeSwitch(label: string, extraWhere: string): SwitchResult {
  const selWhere = "selection='1-2-3'";
  const condWhere = extraWhere ? `AND ${extraWhere}` : "";
  const row = db.prepare(`
    SELECT COUNT(*) as n,
      SUM(CASE WHEN result=selection THEN current_odds*${STAKE} ELSE 0 END) as current_return,
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp
        WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-2-3' LIMIT 1), 0)) as payout_123,
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp
        WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-3-2' LIMIT 1), 0)) as payout_132
    FROM decision_history dh
    WHERE ${BASE_WHERE} AND ${selWhere} ${condWhere}
  `).get() as { n: number; current_return: number; payout_123: number; payout_132: number };

  const n = row.n ?? 0;
  const stake = n * STAKE;
  const roi = (r: number) => stake > 0 ? Math.round(r / stake * 10000) / 100 : 0;
  const p132 = roi(row.payout_132 ?? 0);
  const p123 = roi(row.payout_123 ?? 0);
  return {
    label, n,
    currentRoi123: roi(row.current_return ?? 0),
    payoutRoi123: p123,
    payoutRoi132: p132,
    switchGain: Math.round((p132 - p123) * 100) / 100,
  };
}

const SWITCH_CANDIDATES = [
  { label: "風速2〜4 × 1号艇展示1位 → 1-3-2", where: `${WIND24} AND ${EXH1_FASTEST}` },
  { label: "住之江 × odds40〜49 → 1-3-2",      where: "venue='住之江' AND current_odds>=40 AND current_odds<50" },
  { label: "住之江 × 1号艇展示1位 → 1-3-2",    where: `venue='住之江' AND ${EXH1_FASTEST}` },
  { label: "1号艇展示1位 全体 → 1-3-2",         where: EXH1_FASTEST },
  { label: "3号艇が2号艇より展示速い → 1-3-2",  where: BOAT3_FASTER },
];

const switchResults: SwitchResult[] = [];
for (const c of SWITCH_CANDIDATES) {
  process.stdout.write(`  ${c.label}... `);
  const r = analyzeSwitch(c.label, c.where);
  switchResults.push(r);
  console.log(`n=${r.n} / payout1-2-3=${r.payoutRoi123}% / payout1-3-2=${r.payoutRoi132}% (+${r.switchGain}pt)`);
}

// ─── Markdown 生成 ────────────────────────────────────────────────────────────

const baselineGap = gaps.find(g => g.label === "A. 全体");

let md = `# current_odds vs 実払戻 乖離監査レポート

生成日時: ${new Date().toISOString()}
DB: ${DB_PATH}

> 現行除外条件（5会場 + race_no 10,11,12）適用後のデータを対象とする。
> このレポートは読み取り専用分析。本番ロジック変更は含まない。

## 背景

| 指標 | 値 |
|---|---|
| 全体 current_odds ベース ROI | ${baselineGap?.currentOddsRoi ?? "-"}% |
| 全体 実払戻ベース ROI | ${baselineGap?.payoutRoi ?? "-"}% |
| **乖離幅** | **${baselineGap?.gap ?? "-"}pt** |

> **原因**: current_odds は締め切り前の暫定オッズ。実際の払戻金は直前の投票流入・払戻調整で変動する。
> この乖離が存在する限り、current_odds ベースの ROI は楽観的推定値であることを前提に判断する必要がある。

---

## 判定基準

| 分類 | 条件 |
|---|---|
| 実払戻でも有望 | 実払戻ROI >= 100% |
| current_odds楽観 | current_oddsROI >= 100% かつ 実払戻ROI < 95% |
| 要注意 | gap >= 10pt |
| 採用不可 | 実払戻ROI < 90% |

---

## 条件別 乖離比較

| 条件 | n | hits | カバー率 | current_odds ROI | 実払戻 ROI | **gap** | 判定 |
|---|---|---|---|---|---|---|---|
${gaps.map(g =>
  `| ${g.label} | ${g.n} | ${g.hits} | ${g.coverageRate}% | ${g.currentOddsRoi}% | **${g.payoutRoi}%** | **${g.gap}pt** | ${g.verdict} |`
).join("\n")}

---

## 残存ROI改善幅の再評価（両ベース比較）

| 除外条件 | 除外n | 残存n | current_odds改善幅 | 実払戻改善幅 | 評価 |
|---|---|---|---|---|---|
${residuals.map(r => {
  const evalStr = r.improvement.payout > 0 && r.improvement.payout >= r.improvement.current * 0.5
    ? "実払戻でも有効"
    : r.improvement.payout <= 0
      ? "⚠️実払戻で改善なし"
      : "要注意（current優先）";
  return `| ${r.label} | ${r.excluded.n} | ${r.residual.n} | +${r.improvement.current}pt | **+${r.improvement.payout}pt** | ${evalStr} |`;
}).join("\n")}

> ベースライン: current_odds=${baselineGap?.currentOddsRoi ?? "-"}% / 実払戻=${baselineGap?.payoutRoi ?? "-"}%

---

## switch候補 1-3-2 変換の実払戻再評価

| 条件 | n | current_odds ROI | 実払戻 1-2-3 | 実払戻 1-3-2 | switch改善幅 | 判定 |
|---|---|---|---|---|---|---|
${switchResults.map(r => {
  const evalStr = r.payoutRoi132 >= 100
    ? "✅ 実払戻でも有望"
    : r.payoutRoi132 > r.payoutRoi123 + 10
      ? "🔶 改善あり（100%未満）"
      : "保留";
  return `| ${r.label} | ${r.n} | ${r.currentRoi123}% | ${r.payoutRoi123}% | **${r.payoutRoi132}%** | +${r.switchGain}pt | ${evalStr} |`;
}).join("\n")}

---

## 結論

### 実払戻でも有望な条件（payoutROI >= 100）
${gaps.filter(g => g.verdict === "実払戻でも有望").map(g =>
  `- **${g.label}**: 実払戻ROI=${g.payoutRoi}%`
).join("\n") || "- なし（全条件で実払戻ROI < 100%）"}

### current_odds楽観だった条件（gap大 / currentOddsROI >= 100 だが payoutROI < 95）
${gaps.filter(g => g.verdict === "current_odds楽観").map(g =>
  `- **${g.label}**: current_odds=${g.currentOddsRoi}% → 実払戻=${g.payoutRoi}% (乖離 ${g.gap}pt)`
).join("\n") || "- なし"}

### gap >= 10pt の要注意条件
${gaps.filter(g => g.gap >= 10).map(g =>
  `- **${g.label}**: gap=${g.gap}pt (current=${g.currentOddsRoi}% / payout=${g.payoutRoi}%)`
).join("\n") || "- なし"}

### 今後の ROI 判断指針
1. **実払戻ベース（payout_yen）を基準にする** — current_odds ベースは参考程度
2. **乖離幅が大きい条件**（gap >= 10pt）は current_odds ベースの判断を信頼しない
3. **switch候補（1-3-2）の採用判断**も実払戻ベースで行う
4. **paper-forward 観察**では 実際の払戻金を記録し、current_odds との差を継続追跡する
`;

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");
writeFileSync(OUT_JSON, JSON.stringify({
  generatedAt: new Date().toISOString(),
  gaps, residuals, switchResults,
  baseline: {
    currentOddsRoi: baselineGap?.currentOddsRoi,
    payoutRoi: baselineGap?.payoutRoi,
    gap: baselineGap?.gap,
  },
}, null, 2), "utf-8");

console.log(`\n[odds-payout-gap] 完了 → ${OUT_MD}`);
console.log(`\n【乖離サマリ】`);
console.log(`  全体 gap: ${baselineGap?.gap ?? "-"}pt`);
console.log(`  current_odds楽観条件: ${gaps.filter(g => g.verdict === "current_odds楽観").map(g => g.label).join(", ") || "なし"}`);
console.log(`\n【switch候補 実払戻】`);
switchResults.forEach(r => {
  const mark = r.payoutRoi132 >= 100 ? "✅" : "🔶";
  console.log(`  ${mark} ${r.label}: 1-2-3=${r.payoutRoi123}% → 1-3-2=${r.payoutRoi132}% (+${r.switchGain}pt)`);
});
