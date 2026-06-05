/**
 * official_historical beforeinfo を使った BUY 削減候補検証レポート。
 *
 * 目的:
 * - historical-backfill の BUY だけを対象に、読み取り専用でROI検証する
 * - 安定板/風速/展示ST残差/チルト/部品交換/2軸条件を確認する
 * - app_settings は変更せず、変更案だけ出す
 *
 * 絶対ルール:
 * - INSERT/UPDATE/DELETE しない
 * - app_settings を変更しない
 * - 自動投票・ログイン保存・投票サイト操作なし
 * - ROIは payout_yen ではなく current_odds 基準
 * - run_kind='historical-backfill' のみ
 * - ヒット判定は result = selection
 * - source_type='official_historical' の beforeinfo のみ
 * - 3軸以上は採用候補にしない
 *
 * Usage:
 *   pnpm exec tsx scripts/report-official-historical-buy-reduction.ts
 *   pnpm exec tsx scripts/report-official-historical-buy-reduction.ts --json
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

type Row = {
  key: string;
  label: string;
  axes: 1 | 2;
  n: number;
  hits: number;
  roi: number | null;
  roi2024: number | null;
  n2024: number;
  roi2025: number | null;
  n2025: number;
  worstMonthRoi: number | null;
  worstMonth: string | null;
  months: number;
  category: "A削減候補" | "B保留" | "Cデータ不足";
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

try {
  const completeRaces = countCompleteOfficialHistoricalRaces();
  const conditions = buildConditions();
  const rows = conditions.map(evaluateCondition);
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
    {
      key: "stable_plate_on",
      label: "安定板あり",
      axes: 1,
      whereSql: "stable_plate = 1",
      settingsIdea: "安定板ありのBUYをWATCHへ落とす/閾値を強める",
    },
    {
      key: "stable_plate_off",
      label: "安定板なし",
      axes: 1,
      whereSql: "COALESCE(stable_plate, 0) = 0",
      settingsIdea: null,
    },
    {
      key: "wind_lt_3",
      label: "風速 <3m",
      axes: 1,
      whereSql: "wind_speed_mps IS NOT NULL AND wind_speed_mps < 3",
      settingsIdea: null,
    },
    {
      key: "wind_3_5",
      label: "風速 3-5m",
      axes: 1,
      whereSql: "wind_speed_mps >= 3 AND wind_speed_mps < 5",
      settingsIdea: "風速3-5mのBUYを追跡し、弱ければ閾値を強める",
    },
    {
      key: "wind_ge_5",
      label: "風速 >=5m",
      axes: 1,
      whereSql: "wind_speed_mps >= 5",
      settingsIdea: "風速5m以上のBUYをWATCHへ落とす/EV閾値を強める",
    },
    {
      key: "st_residual_sum_pos",
      label: "展示ST残差合計 >0（選択艇が平均より遅め）",
      axes: 1,
      whereSql: "exhibition_st_residual_sum IS NOT NULL AND exhibition_st_residual_sum > 0",
      settingsIdea: "展示ST残差合計>0のBUYをWATCHへ落とす/閾値を強める",
    },
    {
      key: "st_residual_sum_ge_005",
      label: "展示ST残差合計 >=0.05",
      axes: 1,
      whereSql: "exhibition_st_residual_sum IS NOT NULL AND exhibition_st_residual_sum >= 0.05",
      settingsIdea: "展示ST残差合計>=0.05のBUYを除外候補にする",
    },
    {
      key: "selected_st_residual_pos",
      label: "選択コースの展示ST残差にプラスあり",
      axes: 1,
      whereSql: "selected_st_positive_count > 0",
      settingsIdea: "選択艇のうち展示STが平均より遅い艇を含むBUYを弱める",
    },
    {
      key: "tilt_non_zero",
      label: "選択艇にチルト0以外あり",
      axes: 1,
      whereSql: "selected_tilt_non_zero_count > 0",
      settingsIdea: "チルト0以外を含むBUYを追跡/弱ければWATCHへ落とす",
    },
    {
      key: "parts_changed",
      label: "選択艇に部品交換あり",
      axes: 1,
      whereSql: "selected_parts_changed_count > 0",
      settingsIdea: "部品交換ありを含むBUYを追跡/弱ければWATCHへ落とす",
    },
    {
      key: "stable_plate_on_x_wind_ge_5",
      label: "安定板あり × 風速>=5m",
      axes: 2,
      whereSql: "stable_plate = 1 AND wind_speed_mps >= 5",
      settingsIdea: "安定板あり×風速5m以上のBUYをWATCH/除外候補にする",
    },
    {
      key: "st_bad_x_race10",
      label: "展示ST残差悪い × 10R",
      axes: 2,
      whereSql: "exhibition_st_residual_sum IS NOT NULL AND exhibition_st_residual_sum > 0 AND race_no = 10",
      settingsIdea: "10Rで展示ST残差>0のBUYをWATCHへ落とす",
    },
  ];
}

function evaluateCondition(condition: Condition): Row {
  const all = queryMetric(condition.whereSql, null);
  const y2024 = queryMetric(condition.whereSql, "2024");
  const y2025 = queryMetric(condition.whereSql, "2025");
  const worst = queryWorstMonth(condition.whereSql);

  const category = classify(all.n, all.roi, y2024.roi, y2024.n, y2025.roi, y2025.n, worst.roi);
  return {
    key: condition.key,
    label: condition.label,
    axes: condition.axes,
    n: all.n,
    hits: all.hits,
    roi: all.roi,
    roi2024: y2024.roi,
    n2024: y2024.n,
    roi2025: y2025.roi,
    n2025: y2025.n,
    worstMonthRoi: worst.roi,
    worstMonth: worst.month,
    months: worst.months,
    category,
    reason: reasonFor(category, all.n, all.roi, y2024.roi, y2024.n, y2025.roi, y2025.n, worst.roi),
    settingsIdea: category === "A削減候補" ? condition.settingsIdea : null,
  };
}

function queryMetric(whereSql: string, year: string | null): { n: number; hits: number; roi: number | null } {
  const yearWhere = year ? "AND substr(date, 1, 4) = ?" : "";
  const params = year ? [year] : [];
  const row = db.prepare(`
WITH selected AS (
  SELECT
    dh.id,
    dh.date,
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
  WHERE dh.run_kind = 'historical-backfill'
    AND dh.decision = 'BUY'
    AND dh.current_odds IS NOT NULL
    AND dh.result IS NOT NULL
    ${yearWhere}
    AND EXISTS (SELECT 1 FROM exhibition_data ed WHERE ed.race_id = dh.race_id AND ed.source_type = 'official_historical')
    AND EXISTS (SELECT 1 FROM race_equipment re WHERE re.race_id = dh.race_id AND re.source_type = 'official_historical')
  LEFT JOIN (
    SELECT race_id, selection, SUM(CASE WHEN selected_start_residual > 0 THEN 1 ELSE 0 END) AS selected_st_positive_count
    FROM selected_start_residuals
    GROUP BY race_id, selection
  ) st ON st.race_id = dh.race_id AND st.selection = dh.selection
  LEFT JOIN (
    SELECT race_id, selection,
           SUM(CASE WHEN ABS(COALESCE(tilt_angle, 0)) > 0.0001 THEN 1 ELSE 0 END) AS selected_tilt_non_zero_count,
           SUM(CASE WHEN COALESCE(parts_changed_count, 0) > 0 THEN 1 ELSE 0 END) AS selected_parts_changed_count
    FROM selected_equipment
    GROUP BY race_id, selection
  ) eq ON eq.race_id = dh.race_id AND eq.selection = dh.selection
), filtered AS (
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

function queryWorstMonth(whereSql: string): { month: string | null; roi: number | null; months: number } {
  const rows = db.prepare(`
WITH selected AS (
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
  WHERE dh.run_kind = 'historical-backfill'
    AND dh.decision = 'BUY'
    AND dh.current_odds IS NOT NULL
    AND dh.result IS NOT NULL
    AND EXISTS (SELECT 1 FROM exhibition_data ed WHERE ed.race_id = dh.race_id AND ed.source_type = 'official_historical')
    AND EXISTS (SELECT 1 FROM race_equipment re WHERE re.race_id = dh.race_id AND re.source_type = 'official_historical')
  LEFT JOIN (
    SELECT race_id, selection, SUM(CASE WHEN selected_start_residual > 0 THEN 1 ELSE 0 END) AS selected_st_positive_count
    FROM selected_start_residuals
    GROUP BY race_id, selection
  ) st ON st.race_id = dh.race_id AND st.selection = dh.selection
  LEFT JOIN (
    SELECT race_id, selection,
           SUM(CASE WHEN ABS(COALESCE(tilt_angle, 0)) > 0.0001 THEN 1 ELSE 0 END) AS selected_tilt_non_zero_count,
           SUM(CASE WHEN COALESCE(parts_changed_count, 0) > 0 THEN 1 ELSE 0 END) AS selected_parts_changed_count
    FROM selected_equipment
    GROUP BY race_id, selection
  ) eq ON eq.race_id = dh.race_id AND eq.selection = dh.selection
), monthly AS (
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
  if (rows.length === 0) return { month: null, roi: null, months: 0 };
  return { month: rows[0].ym, roi: rows[0].roi == null ? null : Number(rows[0].roi), months: rows.length };
}

function classify(n: number, roi: number | null, roi2024: number | null, n2024: number, roi2025: number | null, n2025: number, worstMonthRoi: number | null): Row["category"] {
  if (n < 100) return "Cデータ不足";
  const bothYearsEnough = n2024 >= 30 && n2025 >= 30;
  const bothYearsBad = bothYearsEnough && roi2024 != null && roi2025 != null && roi2024 < 0.8 && roi2025 < 0.8;
  const allBad = roi != null && roi < 0.8;
  const monthNotContradicting = worstMonthRoi == null || worstMonthRoi < 1.0;
  if (allBad && bothYearsBad && monthNotContradicting) return "A削減候補";
  return "B保留";
}

function reasonFor(category: Row["category"], n: number, roi: number | null, roi2024: number | null, n2024: number, roi2025: number | null, n2025: number, worstMonthRoi: number | null): string {
  if (category === "Cデータ不足") return `n=${n} < 100 のため採用不可`;
  const parts = [`n=${n}`, `ROI=${fmt(roi)}`, `2024 n=${n2024} ROI=${fmt(roi2024)}`, `2025 n=${n2025} ROI=${fmt(roi2025)}`];
  if (worstMonthRoi != null) parts.push(`worstMonthROI=${fmt(worstMonthRoi)}`);
  if (category === "A削減候補") return `${parts.join(" / ")}。n>=100かつ両年ROI<0.8`;
  return `${parts.join(" / ")}。n>=100だが両年一貫ROI<0.8ではない、または月別確認が必要`;
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
    console.log("- 今回の採用基準では即時変更案なし。n>=100かつ両年一貫ROI<0.8の条件が出た場合のみ変更候補。");
  } else {
    for (const row of sections.A) {
      console.log(`- ${row.label}: ${row.settingsIdea ?? "BUY閾値を強める/検証候補からWATCHへ落とす"}`);
    }
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
  console.log("");
}

function printRows(rows: Row[]) {
  console.log("| 条件 | 軸 | n | hit | ROI | 2024 n/ROI | 2025 n/ROI | worst month | 判定理由 |");
  console.log("|---|---:|---:|---:|---:|---:|---:|---|---|");
  for (const row of rows) {
    console.log(`| ${row.label} | ${row.axes} | ${row.n} | ${row.hits} | ${fmt(row.roi)} | ${row.n2024}/${fmt(row.roi2024)} | ${row.n2025}/${fmt(row.roi2025)} | ${row.worstMonth ?? "-"} ${fmt(row.worstMonthRoi)} | ${row.reason} |`);
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
