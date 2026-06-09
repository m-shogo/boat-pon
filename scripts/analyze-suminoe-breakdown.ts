/**
 * analyze-suminoe-breakdown.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 *
 * 目的: 現行除外条件適用後 ROI=100.79% のうち、住之江（ROI=65.22%, n=207）の
 *       中身を多軸で分解し、「全除外すべきか」「特定条件のみ除外すべきか」を判定する。
 *
 * ベースライン（現行除外後）: n=4,401 / ROI=100.79%
 * 住之江: n=207 / hits=4 / ROI=65.22% / 残存ROI改善+1.76pt
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/suminoe-breakdown.md";
const OUT_JSON = "reports/suminoe-breakdown.json";
const STAKE = 100;

const EXCLUDED_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACE_NOS = [10, 11, 12];

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

// ─── 型定義 ──────────────────────────────────────────────────────────────────

type Stat = {
  label: string;
  n: number;
  hits: number;
  hitRate: number;
  roi: number;
  warning: string;
};

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

const BASE_WHERE = `
  decision='BUY' AND run_kind='historical-backfill'
  AND result IS NOT NULL AND result != ''
  AND venue NOT IN (${EXCLUDED_VENUES.map(v => `'${v}'`).join(",")})
  AND race_no NOT IN (${EXCLUDED_RACE_NOS.join(",")})
`;

function queryBase(extraWhere: string): { n: number; hits: number; totalReturn: number } {
  const r = db.prepare(`
    SELECT COUNT(*) as n,
      SUM(CASE WHEN result=selection THEN 1 ELSE 0 END) as hits,
      SUM(CASE WHEN result=selection THEN current_odds*${STAKE} ELSE 0 END) as total_return
    FROM decision_history dh
    WHERE ${BASE_WHERE}
    ${extraWhere ? "AND " + extraWhere : ""}
  `).get() as { n: number; hits: number; total_return: number };
  return { n: r.n ?? 0, hits: r.hits ?? 0, totalReturn: r.total_return ?? 0 };
}

function querySuminoe(extraWhere: string): { n: number; hits: number; totalReturn: number } {
  const r = db.prepare(`
    SELECT COUNT(*) as n,
      SUM(CASE WHEN result=selection THEN 1 ELSE 0 END) as hits,
      SUM(CASE WHEN result=selection THEN current_odds*${STAKE} ELSE 0 END) as total_return
    FROM decision_history dh
    WHERE ${BASE_WHERE}
    AND venue = '住之江'
    ${extraWhere ? "AND " + extraWhere : ""}
  `).get() as { n: number; hits: number; total_return: number };
  return { n: r.n ?? 0, hits: r.hits ?? 0, totalReturn: r.total_return ?? 0 };
}

function toStat(label: string, r: { n: number; hits: number; totalReturn: number }, warn = ""): Stat {
  const stake = r.n * STAKE;
  return {
    label, n: r.n, hits: r.hits,
    hitRate: r.n > 0 ? Math.round(r.hits / r.n * 10000) / 100 : 0,
    roi: stake > 0 ? Math.round(r.totalReturn / stake * 10000) / 100 : 0,
    warning: warn,
  };
}

function statS(label: string, where: string, warn = ""): Stat {
  return toStat(label, querySuminoe(where), warn);
}

// 判定ロジック
function classify(s: Stat): "paper-forward候補" | "要追加確認" | "採用しない" {
  if (s.n < 20) return "採用しない";
  if (s.roi < 80 && s.n >= 30) return "paper-forward候補";
  if (s.roi < 90 && s.n >= 20) return "要追加確認";
  return "採用しない";
}

// ─── ベースライン・住之江全体 ────────────────────────────────────────────────

const baseline = toStat("ベースライン（全体・除外後）", queryBase(""));
const suminoeAll = toStat("住之江 全体", querySuminoe(""));

// 住之江を除外した場合の残存ROI
const withoutSuminoe = toStat("住之江除外後残存", queryBase("venue != '住之江'"));

// ─── A. オッズ帯別 ───────────────────────────────────────────────────────────

const oddsBands: Stat[] = [
  statS("住之江 odds 25〜39", "current_odds >= 25 AND current_odds < 40"),
  statS("住之江 odds 40〜49", "current_odds >= 40 AND current_odds < 50"),
  statS("住之江 odds 50〜59", "current_odds >= 50 AND current_odds < 60"),
  statS("住之江 odds 60〜69", "current_odds >= 60 AND current_odds < 70"),
  statS("住之江 odds 70〜79", "current_odds >= 70 AND current_odds < 80"),
  statS("住之江 odds 80以上", "current_odds >= 80"),
];

// ─── B. race_no 別 ───────────────────────────────────────────────────────────

const raceNoStats: Stat[] = [];
for (let rn = 1; rn <= 9; rn++) {
  raceNoStats.push(statS(`住之江 ${rn}R`, `race_no = ${rn}`));
}

// ─── C. selection 別 ─────────────────────────────────────────────────────────

const selectionRows = db.prepare(`
  SELECT selection,
    COUNT(*) as n,
    SUM(CASE WHEN result=selection THEN 1 ELSE 0 END) as hits,
    SUM(CASE WHEN result=selection THEN current_odds*${STAKE} ELSE 0 END) as total_return
  FROM decision_history
  WHERE ${BASE_WHERE}
  AND venue = '住之江'
  GROUP BY selection ORDER BY COUNT(*) DESC LIMIT 10
`).all() as { selection: string; n: number; hits: number; total_return: number }[];

const selectionStats = selectionRows.map(r => ({
  selection: r.selection, n: r.n, hits: r.hits,
  share: suminoeAll.n > 0 ? Math.round(r.n / suminoeAll.n * 10000) / 100 : 0,
  roi: r.n > 0 ? Math.round(r.total_return / (r.n * STAKE) * 10000) / 100 : 0,
}));

const sel123 = statS("住之江 selection=1-2-3", "selection='1-2-3'");
const selOther = statS("住之江 selection≠1-2-3", "selection!='1-2-3'");

// ─── D. 展示タイム順位（exhibition_time で再計算） ────────────────────────────

// exhibition_data.ranking は全NULL。exhibition_time (小さいほど速い) で順位計算。
const exhibitionGroups: Stat[] = [
  statS("住之江 展示データなし（1着候補）",
    `NOT EXISTS (SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
        AND ed.exhibition_time IS NOT NULL)`),
  statS("住之江 展示タイム1位（1着候補）",
    `EXISTS (SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
        AND ed.exhibition_time IS NOT NULL
        AND ed.exhibition_time = (
          SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2 WHERE ed2.race_id=dh.race_id
        ))`),
  statS("住之江 展示タイム2〜3位（1着候補）",
    `EXISTS (
      SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
        AND ed.exhibition_time IS NOT NULL
        AND (SELECT COUNT(*) FROM exhibition_data ed2
              WHERE ed2.race_id=dh.race_id AND ed2.exhibition_time IS NOT NULL
                AND ed2.exhibition_time < ed.exhibition_time) BETWEEN 1 AND 2
    )`),
  statS("住之江 展示タイム4位以下（1着候補）",
    `EXISTS (
      SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
        AND ed.exhibition_time IS NOT NULL
        AND (SELECT COUNT(*) FROM exhibition_data ed2
              WHERE ed2.race_id=dh.race_id AND ed2.exhibition_time IS NOT NULL
                AND ed2.exhibition_time < ed.exhibition_time) >= 3
    )`),
];

// ─── E. 展示ST別 ─────────────────────────────────────────────────────────────

const stGroups: Stat[] = [
  statS("住之江 ST < 0.15（早い）",
    `EXISTS (SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
        AND ed.start_timing IS NOT NULL AND ed.start_timing < 0.15)`),
  statS("住之江 ST 0.15〜0.20",
    `EXISTS (SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
        AND ed.start_timing IS NOT NULL AND ed.start_timing >= 0.15 AND ed.start_timing < 0.20)`),
  statS("住之江 ST 0.20以上（遅い）",
    `EXISTS (SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
        AND ed.start_timing IS NOT NULL AND ed.start_timing >= 0.20)`),
  statS("住之江 STデータなし",
    `NOT EXISTS (SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
        AND ed.start_timing IS NOT NULL)`),
];

// ─── F. 風速・安定板別 ───────────────────────────────────────────────────────

const windGroups: Stat[] = [
  statS("住之江 風速データなし",      "NOT EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id)"),
  statS("住之江 風速 0〜2m/s",       "EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id AND rw.wind_speed_mps < 2)"),
  statS("住之江 風速 2〜4m/s",       "EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)"),
  statS("住之江 風速 4m/s以上",       "EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id AND rw.wind_speed_mps >= 4)"),
  statS("住之江 安定板あり",           "EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id AND rw.stable_plate = 1)"),
  statS("住之江 安定板なし",           "EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id AND rw.stable_plate = 0)"),
];

// ─── G. 進入コース別 ─────────────────────────────────────────────────────────

const courseGroups: Stat[] = [
  statS("住之江 1着候補 進入1コース",
    `EXISTS (SELECT 1 FROM race_entries re WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER) AND re.entry_course=1)`),
  statS("住之江 1着候補 進入2コース",
    `EXISTS (SELECT 1 FROM race_entries re WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER) AND re.entry_course=2)`),
  statS("住之江 1着候補 進入3コース以上",
    `EXISTS (SELECT 1 FROM race_entries re WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER) AND re.entry_course >= 3)`),
];

// ─── H. クロス分析 ────────────────────────────────────────────────────────────

type CrossStat = Stat & { condition: string };

function crossStat(label: string, condition: string, where: string): CrossStat {
  return { ...statS(label, where), condition };
}

const crossStats: CrossStat[] = [
  crossStat("住之江 × odds>=80",       "住之江 × odds>=80",       "current_odds >= 80"),
  crossStat("住之江 × odds 70〜79",    "住之江 × odds 70〜79",    "current_odds >= 70 AND current_odds < 80"),
  crossStat("住之江 × odds 60〜69",    "住之江 × odds 60〜69",    "current_odds >= 60 AND current_odds < 70"),
  crossStat("住之江 × odds < 60",      "住之江 × odds < 60",      "current_odds < 60"),
  crossStat("住之江 × 2R",             "住之江 × 2R",             "race_no = 2"),
  crossStat("住之江 × 5R",             "住之江 × 5R",             "race_no = 5"),
  crossStat("住之江 × 1R",             "住之江 × 1R",             "race_no = 1"),
  crossStat("住之江 × 3R",             "住之江 × 3R",             "race_no = 3"),
  crossStat("住之江 × 展示タイム1位",
    "住之江 × 展示タイム1位",
    `EXISTS (SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
        AND ed.exhibition_time IS NOT NULL
        AND ed.exhibition_time = (
          SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2 WHERE ed2.race_id=dh.race_id
        ))`),
  crossStat("住之江 × 1-2-3",          "住之江 × 1-2-3",          "selection='1-2-3'"),
  crossStat("住之江 × odds>=80 × 1-2-3",
    "住之江 × odds>=80 × 1-2-3",
    "current_odds >= 80 AND selection='1-2-3'"),
  crossStat("住之江 × odds<60 × 1-2-3",
    "住之江 × odds<60 × 1-2-3",
    "current_odds < 60 AND selection='1-2-3'"),
];

// ─── 判定まとめ ───────────────────────────────────────────────────────────────

// 全 stat をフラットにして判定
const allStats: (Stat & { group: string })[] = [
  ...oddsBands.map(s => ({ ...s, group: "オッズ帯" })),
  ...raceNoStats.map(s => ({ ...s, group: "race_no" })),
  { ...sel123, group: "selection" },
  { ...selOther, group: "selection" },
  ...exhibitionGroups.map(s => ({ ...s, group: "展示タイム" })),
  ...stGroups.map(s => ({ ...s, group: "展示ST" })),
  ...windGroups.map(s => ({ ...s, group: "風速" })),
  ...courseGroups.map(s => ({ ...s, group: "進入コース" })),
];

// 住之江全体(n=207)の 90%以上をカバーする条件は「実質全体」として除外
// （例: selection=1-2-3 が 100%、進入1コースが 98.6%、安定板なしが 99% → 独立した除外条件として無意味）
const SUMINOE_N = suminoeAll.n;
const isTriviallyBroad = (s: Stat) => SUMINOE_N > 0 && s.n / SUMINOE_N >= 0.90;

const paperForward = allStats.filter(s =>
  classify(s) === "paper-forward候補" && !isTriviallyBroad(s)
);
const needsCheck   = allStats.filter(s =>
  classify(s) === "要追加確認" && !isTriviallyBroad(s)
);
const goodConditions = allStats.filter(s => s.n >= 20 && s.roi >= 100 && !isTriviallyBroad(s));

// 住之江全除外 vs 条件付き除外の暫定判定
function finalVerdict(): string {
  const pfCount = paperForward.length;
  const goodCount = goodConditions.length;
  if (pfCount === 0) return "採用しない（住之江内に明確な除外候補なし。全除外は過剰）";
  if (goodCount >= 2) return "条件付き除外推奨（ROI>=100の条件は残し、ROI<80の条件のみ除外候補）";
  return "paper-forward候補あり（住之江内ROI<80条件でforward検証し、会場全除外前に確認推奨）";
}

// ─── Markdown 生成 ────────────────────────────────────────────────────────────

const pct = (v: number) => v.toFixed(1) + "%";

let md = `# 住之江 中身分解レポート

生成日時: ${new Date().toISOString()}
DB: ${DB_PATH}

> 現行除外条件（5会場 + race_no 10,11,12）適用後のデータを対象とする。
> このレポートは読み取り専用分析。本番ロジック変更は含まない。

## ベースライン

| 指標 | 値 |
|---|---|
| 全体（除外後）| n=${baseline.n.toLocaleString()} / ROI=${baseline.roi}% |
| **住之江 全体** | **n=${suminoeAll.n} / hits=${suminoeAll.hits} / ROI=${suminoeAll.roi}%** |
| 住之江除外後残存 | n=${withoutSuminoe.n} / ROI=${withoutSuminoe.roi}% |
| 住之江除外時ROI改善 | +${Math.round((withoutSuminoe.roi - baseline.roi) * 100) / 100}pt |

---

## A. オッズ帯別

| オッズ帯 | n | hits | ROI | 判定 |
|---|---|---|---|---|
${oddsBands.map(s => `| ${s.label} | ${s.n} | ${s.hits} | **${s.roi}%** | ${classify(s)} |`).join("\n")}

---

## B. race_no 別

| race_no | n | hits | ROI | 判定 |
|---|---|---|---|---|
${raceNoStats.map(s => `| ${s.label} | ${s.n} | ${s.hits} | **${s.roi}%** | ${classify(s)} |`).join("\n")}

---

## C. selection 別

| selection | n | 構成比 | hits | ROI |
|---|---|---|---|---|
${selectionStats.map(s => `| \`${s.selection}\` | ${s.n} | ${pct(s.share)} | ${s.hits} | **${s.roi}%** |`).join("\n")}

- **1-2-3**: n=${sel123.n} / hits=${sel123.hits} / ROI=${sel123.roi}%
- **1-2-3以外**: n=${selOther.n} / hits=${selOther.hits} / ROI=${selOther.roi}%

---

## D. 展示タイム順位（1着候補・exhibition_time 再計算）

| 条件 | n | hits | ROI | 判定 |
|---|---|---|---|---|
${exhibitionGroups.map(s => `| ${s.label} | ${s.n} | ${s.hits} | **${s.roi}%** | ${classify(s)} |`).join("\n")}

---

## E. 展示ST別（1着候補）

| 条件 | n | hits | ROI | 判定 |
|---|---|---|---|---|
${stGroups.map(s => `| ${s.label} | ${s.n} | ${s.hits} | **${s.roi}%** | ${classify(s)} |`).join("\n")}

---

## F. 風速・安定板別

| 条件 | n | hits | ROI | 判定 |
|---|---|---|---|---|
${windGroups.map(s => `| ${s.label} | ${s.n} | ${s.hits} | **${s.roi}%** | ${classify(s)} |`).join("\n")}

---

## G. 進入コース別（1着候補）

| 条件 | n | hits | ROI | 判定 |
|---|---|---|---|---|
${courseGroups.map(s => `| ${s.label} | ${s.n} | ${s.hits} | **${s.roi}%** | ${classify(s)} |`).join("\n")}

---

## H. クロス分析（住之江 × 複合条件）

| 条件 | n | hits | ROI | 判定 |
|---|---|---|---|---|
${crossStats.map(s => `| ${s.condition} | ${s.n} | ${s.hits} | **${s.roi}%** | ${classify(s)} |`).join("\n")}

---

## 判定まとめ

### paper-forward候補（n>=30 かつ ROI<80）

> ※ 住之江全体(n=${SUMINOE_N})の90%以上をカバーする条件は「実質全体と同義」として除外（例: selection=1-2-3が100%、進入1コースが99%）。

${paperForward.length > 0
  ? paperForward.map(s => `- **${s.label}**: n=${s.n} / hits=${s.hits} / ROI=${s.roi}%`).join("\n")
  : "- なし（ROI<80 かつ n>=30 の条件なし）"}

### 要追加確認（n>=20 かつ ROI<90）

${needsCheck.length > 0
  ? needsCheck.map(s => `- ${s.label}: n=${s.n} / hits=${s.hits} / ROI=${s.roi}%`).join("\n")
  : "- なし"}

### 残すべき条件（n>=20 かつ ROI>=100）

${goodConditions.length > 0
  ? goodConditions.map(s => `- **${s.label}**: n=${s.n} / ROI=${s.roi}%`).join("\n")
  : "- なし（ROI>=100 の条件なし）"}

---

## 暫定判定

**${finalVerdict()}**

| 判定 | 根拠 |
|---|---|
| paper-forward候補数 | ${paperForward.length}件 |
| ROI>=100の残すべき条件数 | ${goodConditions.length}件 |
| 住之江全体ROI | ${suminoeAll.roi}% |
| 住之江除外時ROI改善幅 | +${Math.round((withoutSuminoe.roi - baseline.roi) * 100) / 100}pt |

> **注意**: 住之江全除外にも paper-forward候補に絞った部分除外にも、今すぐ app_settings を変更しない。
> ROI改善 +1.76pt は小さく、n=207の除外が長期的なBUY母数に影響する可能性がある。
> 分解結果を踏まえ、ROI<80の特定条件だけを paper-forward で観察してから判断する。
`;

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");
writeFileSync(OUT_JSON, JSON.stringify({
  generatedAt: new Date().toISOString(),
  baseline: { n: baseline.n, roi: baseline.roi },
  suminoeAll,
  withoutSuminoe,
  roiImprovement: Math.round((withoutSuminoe.roi - baseline.roi) * 100) / 100,
  oddsBands, raceNoStats, selectionStats, sel123, selOther,
  exhibitionGroups, stGroups, windGroups, courseGroups, crossStats,
  paperForward, needsCheck, goodConditions,
  finalVerdict: finalVerdict(),
}, null, 2), "utf-8");

console.log(`[suminoe-breakdown] 完了 → ${OUT_MD}`);
console.log(`\n住之江全体: n=${suminoeAll.n} / hits=${suminoeAll.hits} / ROI=${suminoeAll.roi}%`);
console.log(`住之江除外後残存: n=${withoutSuminoe.n} / ROI=${withoutSuminoe.roi}%`);
console.log(`\n【paper-forward候補】`);
if (paperForward.length === 0) {
  console.log("  なし");
} else {
  paperForward.forEach(s => console.log(`  ${s.label}: ROI=${s.roi}% (n=${s.n})`));
}
console.log(`\n【残すべき条件（ROI>=100）】`);
if (goodConditions.length === 0) {
  console.log("  なし");
} else {
  goodConditions.forEach(s => console.log(`  ${s.label}: ROI=${s.roi}% (n=${s.n})`));
}
console.log(`\n【暫定判定】${finalVerdict()}`);
