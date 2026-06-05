/**
 * official_historical beforeinfo を使った BUY 削減候補検証レポート。
 *
 * 読み取り専用。INSERT/UPDATE/DELETE なし。app_settings 変更なし。
 * ROI は current_odds 基準。ヒット判定は result = selection。
 * 対象は run_kind='historical-backfill' の BUY のみ。
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));

if (!existsSync(DB_PATH)) {
  console.error(`[official-historical-buy-reduction] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");

type Category = "A削減候補" | "B保留" | "Cデータ不足";

type Row = {
  key: string;
  label: string;
  axes: 1 | 2;
  n: number;
  hits: number;
  roi: number | null;
  n2024: number;
  roi2024: number | null;
  n2025: number;
  roi2025: number | null;
  months: number;
  worstMonth: string | null;
  worstMonthRoi: number | null;
  bestMonth: string | null;
  bestMonthRoi: number | null;
  category: Category;
  reason: string;
  settingsIdea: string | null;
};

type Condition = {
  key: string;
  label: string;
  axes: 1 | 2;
  whereSql: string;
  settingsIdea: string | null;
};

type Metric = { n: number; hits: number; roi: number | null };
type MonthSummary = { months: number; worstMonth: string | null; worstMonthRoi: number | null; bestMonth: string | null; bestMonthRoi: number | null };

try {
  const completeRaces = countCompleteOfficialHistoricalRaces();
  const rows = buildConditions().map(evaluateCondition);
  const sections = {
    A: rows.filter((row) => row.category === "A削減候補"),
    B: rows.filter((row) => row.category === "B保留"),
    C: rows.filter((row) => row.category === "Cデータ不足"),
  };

  if (args.json) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), dbPath: DB_PATH, completeRaces, rows, sections }, null, 2));
  } else {
    printReport(completeRaces, rows, sections);
  }
} finally {
  db.close();
}

function countCompleteOfficialHistoricalRaces(): number {
  const row = db.prepare(`
SELECT COUNT(*) AS complete_races FROM (
  SELECT race_id FROM race_weather WHERE source_type='official_historical'
  INTERSECT SELECT race_id FROM exhibition_data WHERE source_type='official_historical'
  INTERSECT SELECT race_id FROM race_equipment WHERE source_type='official_historical'
)
`).get() as { complete_races: number };
  return Number(row.complete_races ?? 0);
}

function buildConditions(): Condition[] {
  return [
    { key: "stable_plate_on", label: "安定板あり", axes: 1, whereSql: "stable_plate = 1", settingsIdea: "安定板ありのBUYをWATCHへ落とす/BUY閾値を強める" },
    { key: "stable_plate_off", label: "安定板なし", axes: 1, whereSql: "COALESCE(stable_plate, 0) = 0", settingsIdea: null },
    { key: "wind_lt_3", label: "風速 <3m", axes: 1, whereSql: "wind_speed_mps IS NOT NULL AND wind_speed_mps < 3", settingsIdea: null },
    { key: "wind_3_5", label: "風速 3-5m", axes: 1, whereSql: "wind_speed_mps >= 3 AND wind_speed_mps < 5", settingsIdea: "風速3-5mのBUYを追跡し、弱ければ閾値を強める" },
    { key: "wind_ge_5", label: "風速 >=5m", axes: 1, whereSql: "wind_speed_mps >= 5", settingsIdea: "風速5m以上のBUYをWATCHへ落とす/EV閾値を強める" },
    { key: "st_residual_sum_pos", label: "展示ST残差合計 >0", axes: 1, whereSql: "exhibition_st_residual_sum IS NOT NULL AND exhibition_st_residual_sum > 0", settingsIdea: "展示ST残差合計>0のBUYをWATCHへ落とす/閾値を強める" },
    { key: "st_residual_sum_ge_005", label: "展示ST残差合計 >=0.05", axes: 1, whereSql: "exhibition_st_residual_sum IS NOT NULL AND exhibition_st_residual_sum >= 0.05", settingsIdea: "展示ST残差合計>=0.05のBUYを除外候補にする" },
    { key: "selected_st_residual_pos", label: "選択コースの展示ST残差にプラスあり", axes: 1, whereSql: "selected_st_positive_count > 0", settingsIdea: "選択艇のうち展示STが平均より遅い艇を含むBUYを弱める" },
    { key: "tilt_non_zero", label: "選択艇にチルト0以外あり", axes: 1, whereSql: "selected_tilt_non_zero_count > 0", settingsIdea: "チルト0以外を含むBUYをWATCHへ落とす/追跡する" },
    { key: "parts_changed", label: "選択艇に部品交換あり", axes: 1, whereSql: "selected_parts_changed_count > 0", settingsIdea: "部品交換ありを含むBUYをWATCHへ落とす/追跡する" },
    { key: "stable_plate_on_x_wind_ge_5", label: "安定板あり × 風速>=5m", axes: 2, whereSql: "stable_plate = 1 AND wind_speed_mps >= 5", settingsIdea: "安定板あり×風速5m以上のBUYをWATCH/除外候補にする" },
    { key: "st_bad_x_race10", label: "展示ST残差悪い × 10R", axes: 2, whereSql: "exhibition_st_residual_sum IS NOT NULL AND exhibition_st_residual_sum > 0 AND race_no = 10", settingsIdea: "10Rで展示ST残差>0のBUYをWATCHへ落とす" },
  ];
}

function evaluateCondition(condition: Condition): Row {
  const all = queryMetric(condition.whereSql, null);
  const y2024 = queryMetric(condition.whereSql, "2024");
  const y2025 = queryMetric(condition.whereSql, "2025");
  const month = queryMonthSummary(condition.whereSql);
  const category = classify(all, y2024, y2025, month);

  return {
    key: condition.key,
    label: condition.label,
    axes: condition.axes,
    n: all.n,
    hits: all.hits,
    roi: all.roi,
    n2024: y2024.n,
    roi2024: y2024.roi,
    n2025: y2025.n,
    roi2025: y2025.roi,
    months: month.months,
    worstMonth: month.worstMonth,
    worstMonthRoi: month.worstMonthRoi,
    bestMonth: month.bestMonth,
    bestMonthRoi: month.bestMonthRoi,
    category,
    reason: reasonFor(category, all, y2024, y2025, month),
    settingsIdea: category === "A削減候補" ? condition.settingsIdea : null,
  };
}

function queryMetric(whereSql: string, year: string | null): Metric {
  const yearWhere = year ? "AND substr(dh.date, 1, 4) = ?" : "";
  const params = year ? [year] : [];
  const row = db.prepare(`
${baseCte(yearWhere)}
, filtered AS (
  SELECT * FROM selected WHERE ${whereSql}
)
SELECT
  COUNT(*) AS n,
  SUM(CASE WHEN result = selection THEN 1 ELSE 0 END) AS hits,
  ROUND(SUM(CASE WHEN result = selection THEN current_odds ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0), 4) AS roi
FROM filtered
`).get(...params) as { n: number; hits: number | null; roi: number | null };
  return { n: Number(row.n ?? 0), hits: Number(row.hits ?? 0), roi: row.roi == null ? null : Number(row.roi) };
}

function queryMonthSummary(whereSql: string): MonthSummary {
  const rows = db.prepare(`
${baseCte("")}
, monthly AS (
  SELECT
    ym,
    COUNT(*) AS n,
    ROUND(SUM(CASE WHEN result = selection THEN current_odds ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0), 4) AS roi
  FROM selected
  WHERE ${whereSql}
  GROUP BY ym
  HAVING n >= 20
)
SELECT ym, n, roi FROM monthly ORDER BY roi ASC
`).all() as Array<{ ym: string; n: number; roi: number | null }>;

  if (rows.length === 0) return { months: 0, worstMonth: null, worstMonthRoi: null, bestMonth: null, bestMonthRoi: null };
  const worst = rows[0];
  const best = [...rows].sort((a, b) => Number(b.roi ?? -999) - Number(a.roi ?? -999))[0];
  return {
    months: rows.length,
    worstMonth: worst.ym,
    worstMonthRoi: worst.roi == null ? null : Number(worst.roi),
    bestMonth: best.ym,
    bestMonthRoi: best.roi == null ? null : Number(best.roi),
  };
}

function baseCte(extraDecisionWhere: string): string {
  return `
WITH race_avg_st AS (
  SELECT race_id, AVG(start_timing) AS avg_st
  FROM exhibition_data
  WHERE source_type = 'official_historical'
    AND start_timing IS NOT NULL
  GROUP BY race_id
), selected_st AS (
  SELECT
    dh.id,
    SUM(CASE WHEN ed.start_timing - ras.avg_st > 0 THEN 1 ELSE 0 END) AS selected_st_positive_count
  FROM decision_history dh
  JOIN exhibition_data ed
    ON ed.race_id = dh.race_id
   AND ed.source_type = 'official_historical'
   AND instr('-' || dh.selection || '-', '-' || ed.course || '-') > 0
  JOIN race_avg_st ras ON ras.race_id = ed.race_id
  GROUP BY dh.id
), selected_equipment AS (
  SELECT
    dh.id,
    SUM(CASE WHEN ABS(COALESCE(re.tilt_angle, 0)) > 0.0001 THEN 1 ELSE 0 END) AS selected_tilt_non_zero_count,
    SUM(CASE WHEN COALESCE(re.parts_changed_count, 0) > 0 THEN 1 ELSE 0 END) AS selected_parts_changed_count
  FROM decision_history dh
  JOIN race_equipment re
    ON re.race_id = dh.race_id
   AND re.source_type = 'official_historical'
   AND instr('-' || dh.selection || '-', '-' || re.course || '-') > 0
  GROUP BY dh.id
), selected AS (
  SELECT
    dh.id,
    dh.date,
    substr(dh.date, 1, 7) AS ym,
    dh.venue,
    dh.race_no,
    dh.selection,
    dh.result,
    dh.current_odds,
    dh.exhibition_st_residual_sum,
    rw.stable_plate,
    rw.wind_speed_mps,
    COALESCE(st.selected_st_positive_count, 0) AS selected_st_positive_count,
    COALESCE(eq.selected_tilt_non_zero_count, 0) AS selected_tilt_non_zero_count,
    COALESCE(eq.selected_parts_changed_count, 0) AS selected_parts_changed_count
  FROM decision_history dh
  JOIN race_weather rw
    ON rw.race_id = dh.race_id
   AND rw.source_type = 'official_historical'
  LEFT JOIN selected_st st ON st.id = dh.id
  LEFT JOIN selected_equipment eq ON eq.id = dh.id
  WHERE dh.run_kind = 'historical-backfill'
    AND dh.decision = 'BUY'
    AND dh.current_odds IS NOT NULL
    AND dh.result IS NOT NULL
    ${extraDecisionWhere}
    AND EXISTS (SELECT 1 FROM exhibition_data ed WHERE ed.race_id = dh.race_id AND ed.source_type = 'official_historical')
    AND EXISTS (SELECT 1 FROM race_equipment re WHERE re.race_id = dh.race_id AND re.source_type = 'official_historical')
)`;
}

function classify(all: Metric, y2024: Metric, y2025: Metric, month: MonthSummary): Category {
  if (all.n < 100) return "Cデータ不足";

  const bothYearsEnough = y2024.n >= 30 && y2025.n >= 30;
  const bothYearsBad = bothYearsEnough
    && y2024.roi != null
    && y2025.roi != null
    && y2024.roi < 0.8
    && y2025.roi < 0.8;
  const allBad = all.roi != null && all.roi < 0.8;
  const noGoodMonth = month.bestMonthRoi == null || month.bestMonthRoi < 1.0;

  if (allBad && bothYearsBad && noGoodMonth) return "A削減候補";
  return "B保留";
}

function reasonFor(category: Category, all: Metric, y2024: Metric, y2025: Metric, month: MonthSummary): string {
  if (category === "Cデータ不足") return `n=${all.n} < 100 のため採用不可`;
  const parts = [
    `n=${all.n}`,
    `ROI=${fmt(all.roi)}`,
    `2024 n=${y2024.n} ROI=${fmt(y2024.roi)}`,
    `2025 n=${y2025.n} ROI=${fmt(y2025.roi)}`,
    `bestMonth=${month.bestMonth ?? "-"} ${fmt(month.bestMonthRoi)}`,
    `worstMonth=${month.worstMonth ?? "-"} ${fmt(month.worstMonthRoi)}`,
  ];
  if (category === "A削減候補") return `${parts.join(" / ")}。n>=100、両年ROI<0.8、月別で良い月なし`;
  return `${parts.join(" / ")}。n>=100だが採用基準未達。追跡/追加確認`;
}

function printReport(completeRaces: number, rows: Row[], sections: { A: Row[]; B: Row[]; C: Row[] }) {
  console.log("# official_historical BUY削減候補ROI検証");
  console.log("");
  console.log(`DB: ${DB_PATH}`);
  console.log(`complete official_historical races: ${completeRaces}`);
  console.log("target: decision_history.decision='BUY' AND run_kind='historical-backfill'");
  console.log("ROI: current_odds basis, hit = result = selection");
  console.log("source: race_weather / exhibition_data / race_equipment source_type='official_historical' only");
  console.log("");

  printSection("A. 削減候補（n>=100、両年一貫してROI<0.8）", sections.A);
  printSection("B. 保留（n>=100だが追跡必要）", sections.B);
  printSection("C. データ不足（n<100）", sections.C);

  console.log("## D. app_settings への変更案（実行はユーザー承認後）");
  if (sections.A.length === 0) {
    console.log("- 今回の採用基準では即時変更案なし。n>=100、両年一貫ROI<0.8、月別で良い月なしの条件が出た場合のみ変更候補。");
  } else {
    for (const row of sections.A) console.log(`- ${row.label}: ${row.settingsIdea ?? "BUY閾値を強める/検証候補からWATCHへ落とす"}`);
  }
  console.log("");
  console.log("## 全条件一覧");
  printRows(rows);
}

function printSection(title: string, rows: Row[]) {
  console.log(`## ${title}`);
  if (rows.length === 0) {
    console.log("- 該当なし");
    console.log("");
    return;
  }
  printRows(rows);
}

function printRows(rows: Row[]) {
  console.log("| 条件 | 軸 | n | hit | ROI | 2024 n/ROI | 2025 n/ROI | best month | worst month | 判定理由 |");
  console.log("|---|---:|---:|---:|---:|---:|---:|---|---|---|");
  for (const row of rows) {
    console.log(`| ${row.label} | ${row.axes} | ${row.n} | ${row.hits} | ${fmt(row.roi)} | ${row.n2024}/${fmt(row.roi2024)} | ${row.n2025}/${fmt(row.roi2025)} | ${row.bestMonth ?? "-"} ${fmt(row.bestMonthRoi)} | ${row.worstMonth ?? "-"} ${fmt(row.worstMonthRoi)} | ${row.reason} |`);
  }
  console.log("");
}

function fmt(value: number | null): string {
  return value == null ? "-" : value.toFixed(3);
}

function parseArgs(argv: string[]) {
  const parsed = { json: false };
  for (const key of argv) {
    if (key === "--json") parsed.json = true;
    else if (key === "--help" || key === "-h") { printHelp(); process.exit(0); }
    else throw new Error(`unknown option: ${key}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  pnpm exec tsx scripts/report-official-historical-buy-reduction.ts
  pnpm exec tsx scripts/report-official-historical-buy-reduction.ts --json
`);
}
