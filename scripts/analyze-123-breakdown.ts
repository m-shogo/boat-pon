/**
 * analyze-123-breakdown.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 *
 * 目的: BUYの97.7%を占める selection=1-2-3 (n=4,301 / ROI=100.12%) を多軸で分解し、
 *       「勝てる1-2-3」と「負けている1-2-3」を分ける条件を特定する。
 *       selectionを変えることが目的ではなく、1-2-3をやめる条件を見つけることが目的。
 *
 * ベースライン（現行除外後）: n=4,401 / ROI=100.79%
 * 1-2-3 全体: n=4,301 / ROI=100.12%
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD  = "reports/123-breakdown.md";
const OUT_JSON = "reports/123-breakdown.json";
const STAKE = 100;

const EXCLUDED_VENUES  = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACE_NOS = [10, 11, 12];

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

// ─── 型・ヘルパー ─────────────────────────────────────────────────────────────

type Stat = { label: string; n: number; hits: number; hitRate: number; roi: number; warning: string };

const BASE_WHERE = `
  decision='BUY' AND run_kind='historical-backfill'
  AND result IS NOT NULL AND result != ''
  AND venue NOT IN (${EXCLUDED_VENUES.map(v => `'${v}'`).join(",")})
  AND race_no NOT IN (${EXCLUDED_RACE_NOS.join(",")})
`;

function query123(extraWhere: string): { n: number; hits: number; totalReturn: number } {
  const r = db.prepare(`
    SELECT COUNT(*) as n,
      SUM(CASE WHEN result=selection THEN 1 ELSE 0 END) as hits,
      SUM(CASE WHEN result=selection THEN current_odds*${STAKE} ELSE 0 END) as total_return
    FROM decision_history dh
    WHERE ${BASE_WHERE}
    AND selection = '1-2-3'
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

function stat(label: string, where: string, warn = ""): Stat {
  return toStat(label, query123(where), warn);
}

// 判定ロジック（住之江分解と同じ基準）
function classify(s: Stat): "paper-forward候補" | "要追加確認" | "採用しない" {
  if (s.n < 20) return "採用しない";
  if (s.roi < 80 && s.n >= 30) return "paper-forward候補";
  if (s.roi < 90 && s.n >= 20) return "要追加確認";
  return "採用しない";
}

// ─── ベースライン ─────────────────────────────────────────────────────────────

const baselineRow = db.prepare(`
  SELECT COUNT(*) as n,
    SUM(CASE WHEN result=selection THEN 1 ELSE 0 END) as hits,
    SUM(CASE WHEN result=selection THEN current_odds*${STAKE} ELSE 0 END) as total_return
  FROM decision_history dh WHERE ${BASE_WHERE}
`).get() as { n: number; hits: number; total_return: number };
const baseline = toStat("全体（除外後・全selection）", {
  n: baselineRow.n, hits: baselineRow.hits, totalReturn: baselineRow.total_return,
});

const base123 = toStat("1-2-3 全体", query123(""));

// ─── A. オッズ帯別 ───────────────────────────────────────────────────────────

const oddsBands: Stat[] = [
  stat("1-2-3 odds 25〜39",  "current_odds >= 25 AND current_odds < 40"),
  stat("1-2-3 odds 40〜49",  "current_odds >= 40 AND current_odds < 50"),
  stat("1-2-3 odds 50〜59",  "current_odds >= 50 AND current_odds < 60"),
  stat("1-2-3 odds 60〜69",  "current_odds >= 60 AND current_odds < 70"),
  stat("1-2-3 odds 70〜79",  "current_odds >= 70 AND current_odds < 80"),
  stat("1-2-3 odds 80以上",  "current_odds >= 80"),
];

// ─── B. 1号艇の展示タイム順位（1着候補 = boat 1） ────────────────────────────

// selection=1-2-3 なので 1着候補は必ず boat 1
const exhBoat1: Stat[] = [
  stat("1-2-3 1号艇展示データなし",
    `NOT EXISTS (SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=1 AND ed.exhibition_time IS NOT NULL)`),
  stat("1-2-3 1号艇 展示タイム1位（最速）",
    `EXISTS (SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=1 AND ed.exhibition_time IS NOT NULL
        AND ed.exhibition_time = (
          SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2 WHERE ed2.race_id=dh.race_id
        ))`),
  stat("1-2-3 1号艇 展示タイム2〜3位",
    `EXISTS (
      SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=1 AND ed.exhibition_time IS NOT NULL
        AND (SELECT COUNT(*) FROM exhibition_data ed2
              WHERE ed2.race_id=dh.race_id AND ed2.exhibition_time IS NOT NULL
                AND ed2.exhibition_time < ed.exhibition_time) BETWEEN 1 AND 2
    )`),
  stat("1-2-3 1号艇 展示タイム4位以下",
    `EXISTS (
      SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=1 AND ed.exhibition_time IS NOT NULL
        AND (SELECT COUNT(*) FROM exhibition_data ed2
              WHERE ed2.race_id=dh.race_id AND ed2.exhibition_time IS NOT NULL
                AND ed2.exhibition_time < ed.exhibition_time) >= 3
    )`),
];

// ─── C. 1号艇の展示ST ────────────────────────────────────────────────────────

const stBoat1: Stat[] = [
  stat("1-2-3 1号艇 ST < 0.15（早い）",
    `EXISTS (SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=1
        AND ed.start_timing IS NOT NULL AND ed.start_timing < 0.15)`),
  stat("1-2-3 1号艇 ST 0.15〜0.20",
    `EXISTS (SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=1
        AND ed.start_timing IS NOT NULL AND ed.start_timing >= 0.15 AND ed.start_timing < 0.20)`),
  stat("1-2-3 1号艇 ST 0.20以上（遅い）",
    `EXISTS (SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=1
        AND ed.start_timing IS NOT NULL AND ed.start_timing >= 0.20)`),
  stat("1-2-3 1号艇 STデータなし",
    `NOT EXISTS (SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=1 AND ed.start_timing IS NOT NULL)`),
];

// ─── D. 2号艇 vs 3号艇 展示タイム比較（1-2-3 の 2着・3着の有利不利） ─────────
// 2号艇の時間 < 3号艇の時間 → 2着が2号艇になりやすい → 1-2-3有利
// 3号艇の時間 < 2号艇の時間 → 3着前に2号艇が来やすい → 1-3-2に流れる可能性

const boat23Cmp: Stat[] = [
  stat("1-2-3 2号艇展示速い（2号艇<3号艇）— 1-2-3有利",
    `EXISTS (
      SELECT 1 FROM race_entries re2
      JOIN exhibition_data ed2 ON ed2.race_id=re2.race_id AND ed2.course=re2.entry_course
      JOIN race_entries re3 ON re3.race_id=re2.race_id AND re3.boat=3
      JOIN exhibition_data ed3 ON ed3.race_id=re3.race_id AND ed3.course=re3.entry_course
      WHERE re2.race_id=dh.race_id AND re2.boat=2
        AND ed2.exhibition_time IS NOT NULL AND ed3.exhibition_time IS NOT NULL
        AND ed2.exhibition_time < ed3.exhibition_time
    )`),
  stat("1-2-3 3号艇展示速い（3号艇<2号艇）— 1-3-2に流れやすい",
    `EXISTS (
      SELECT 1 FROM race_entries re2
      JOIN exhibition_data ed2 ON ed2.race_id=re2.race_id AND ed2.course=re2.entry_course
      JOIN race_entries re3 ON re3.race_id=re2.race_id AND re3.boat=3
      JOIN exhibition_data ed3 ON ed3.race_id=re3.race_id AND ed3.course=re3.entry_course
      WHERE re2.race_id=dh.race_id AND re2.boat=2
        AND ed2.exhibition_time IS NOT NULL AND ed3.exhibition_time IS NOT NULL
        AND ed3.exhibition_time < ed2.exhibition_time
    )`),
  stat("1-2-3 2号艇・3号艇 展示データ欠損",
    `NOT EXISTS (
      SELECT 1 FROM race_entries re2
      JOIN exhibition_data ed2 ON ed2.race_id=re2.race_id AND ed2.course=re2.entry_course
      JOIN race_entries re3 ON re3.race_id=re2.race_id AND re3.boat=3
      JOIN exhibition_data ed3 ON ed3.race_id=re3.race_id AND ed3.course=re3.entry_course
      WHERE re2.race_id=dh.race_id AND re2.boat=2
        AND ed2.exhibition_time IS NOT NULL AND ed3.exhibition_time IS NOT NULL
    )`),
];

// ─── E. race_no 別 ───────────────────────────────────────────────────────────

const raceNoStats: Stat[] = [];
for (let rn = 1; rn <= 9; rn++) {
  raceNoStats.push(stat(`1-2-3 ${rn}R`, `race_no = ${rn}`));
}

// ─── F. 風速・安定板別 ───────────────────────────────────────────────────────

const windGroups: Stat[] = [
  stat("1-2-3 風速データなし",    "NOT EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id)"),
  stat("1-2-3 風速 0〜2m/s",     "EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id AND rw.wind_speed_mps < 2)"),
  stat("1-2-3 風速 2〜4m/s",     "EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)"),
  stat("1-2-3 風速 4m/s以上",     "EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id AND rw.wind_speed_mps >= 4)"),
  stat("1-2-3 安定板あり",         "EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id AND rw.stable_plate = 1)"),
  stat("1-2-3 安定板なし",         "EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id AND rw.stable_plate = 0)"),
];

// ─── G. 会場別 ───────────────────────────────────────────────────────────────

const venueRows = db.prepare(`
  SELECT venue,
    COUNT(*) as n,
    SUM(CASE WHEN result=selection THEN 1 ELSE 0 END) as hits,
    SUM(CASE WHEN result=selection THEN current_odds*${STAKE} ELSE 0 END) as total_return
  FROM decision_history
  WHERE ${BASE_WHERE} AND selection='1-2-3'
  GROUP BY venue ORDER BY SUM(CASE WHEN result=selection THEN current_odds*${STAKE} ELSE 0 END)/(COUNT(*)*${STAKE})*100
`).all() as { venue: string; n: number; hits: number; total_return: number }[];

const venueStats = venueRows.map(r => ({
  venue: r.venue, n: r.n, hits: r.hits,
  hitRate: r.n > 0 ? Math.round(r.hits / r.n * 10000) / 100 : 0,
  roi: r.n > 0 ? Math.round(r.total_return / (r.n * STAKE) * 10000) / 100 : 0,
  judgment: r.n < 30 ? "採用しない" : r.total_return / (r.n * STAKE) < 0.8 ? "paper-forward候補" :
    r.total_return / (r.n * STAKE) < 0.9 ? "要追加確認" : "採用しない",
}));

// ─── H. 複合条件（重要クロス） ────────────────────────────────────────────────

const crossStats: Stat[] = [
  // 1号艇展示最速 × odds帯
  stat("1-2-3 × 1号艇展示1位 × odds<60",
    `current_odds < 60 AND EXISTS (SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=1 AND ed.exhibition_time IS NOT NULL
        AND ed.exhibition_time = (SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2 WHERE ed2.race_id=dh.race_id))`),
  stat("1-2-3 × 1号艇展示1位 × odds>=60",
    `current_odds >= 60 AND EXISTS (SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=1 AND ed.exhibition_time IS NOT NULL
        AND ed.exhibition_time = (SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2 WHERE ed2.race_id=dh.race_id))`),
  // 1号艇展示最速 × 2号艇<3号艇（ダブル有利）
  stat("1-2-3 × 1号艇展示1位 × 2号艇展示速い（ダブル有利）",
    `EXISTS (SELECT 1 FROM race_entries re
        JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
        WHERE re.race_id=dh.race_id AND re.boat=1 AND ed.exhibition_time IS NOT NULL
          AND ed.exhibition_time = (SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2 WHERE ed2.race_id=dh.race_id))
      AND EXISTS (
        SELECT 1 FROM race_entries re2
        JOIN exhibition_data ed2 ON ed2.race_id=re2.race_id AND ed2.course=re2.entry_course
        JOIN race_entries re3 ON re3.race_id=re2.race_id AND re3.boat=3
        JOIN exhibition_data ed3 ON ed3.race_id=re3.race_id AND ed3.course=re3.entry_course
        WHERE re2.race_id=dh.race_id AND re2.boat=2
          AND ed2.exhibition_time IS NOT NULL AND ed3.exhibition_time IS NOT NULL
          AND ed2.exhibition_time < ed3.exhibition_time
      )`),
  // 1号艇展示1位 × 3号艇<2号艇（逆張り）
  stat("1-2-3 × 1号艇展示1位 × 3号艇展示速い（1-3-2リスク）",
    `EXISTS (SELECT 1 FROM race_entries re
        JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
        WHERE re.race_id=dh.race_id AND re.boat=1 AND ed.exhibition_time IS NOT NULL
          AND ed.exhibition_time = (SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2 WHERE ed2.race_id=dh.race_id))
      AND EXISTS (
        SELECT 1 FROM race_entries re2
        JOIN exhibition_data ed2 ON ed2.race_id=re2.race_id AND ed2.course=re2.entry_course
        JOIN race_entries re3 ON re3.race_id=re2.race_id AND re3.boat=3
        JOIN exhibition_data ed3 ON ed3.race_id=re3.race_id AND ed3.course=re3.entry_course
        WHERE re2.race_id=dh.race_id AND re2.boat=2
          AND ed2.exhibition_time IS NOT NULL AND ed3.exhibition_time IS NOT NULL
          AND ed3.exhibition_time < ed2.exhibition_time
      )`),
  // 風速 × 1号艇展示
  stat("1-2-3 × 風速2〜4 × 1号艇展示1位",
    `EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)
      AND EXISTS (SELECT 1 FROM race_entries re
        JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
        WHERE re.race_id=dh.race_id AND re.boat=1 AND ed.exhibition_time IS NOT NULL
          AND ed.exhibition_time = (SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2 WHERE ed2.race_id=dh.race_id))`),
  // odds × race_no
  stat("1-2-3 × odds 40〜49 × 1〜3R",   "current_odds >= 40 AND current_odds < 50 AND race_no BETWEEN 1 AND 3"),
  stat("1-2-3 × odds 40〜49 × 4〜9R",   "current_odds >= 40 AND current_odds < 50 AND race_no BETWEEN 4 AND 9"),
  // 住之江 × odds < 40（残すべき条件の検証）
  stat("1-2-3 × 住之江 × odds<40",      "venue='住之江' AND current_odds < 40"),
  stat("1-2-3 × 住之江 × odds 40〜49",  "venue='住之江' AND current_odds >= 40 AND current_odds < 50"),
];

// ─── 除外時残存ROI計算（主要 paper-forward 候補） ───────────────────────────

function residualStat(label: string, excludeWhere: string): {
  label: string; excluded: Stat; residual: Stat; roiDelta: number;
} {
  const excluded = toStat(label, query123(excludeWhere));
  const residual = toStat(label + "（除外後）", query123(`NOT (${excludeWhere})`));
  return { label, excluded, residual, roiDelta: Math.round((residual.roi - base123.roi) * 100) / 100 };
}

const residuals = [
  residualStat("1号艇展示タイム1位",
    `EXISTS (SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=1 AND ed.exhibition_time IS NOT NULL
        AND ed.exhibition_time = (
          SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2 WHERE ed2.race_id=dh.race_id
        ))`),
  residualStat("5R", "race_no = 5"),
  residualStat("odds 80以上", "current_odds >= 80"),
  residualStat("1号艇展示タイム1位 AND 5R",
    `race_no = 5 AND EXISTS (SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=1 AND ed.exhibition_time IS NOT NULL
        AND ed.exhibition_time = (
          SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2 WHERE ed2.race_id=dh.race_id
        ))`),
];

// ─── まとめ集計 ───────────────────────────────────────────────────────────────

const allStats: (Stat & { group: string })[] = [
  ...oddsBands.map(s => ({ ...s, group: "オッズ帯" })),
  ...exhBoat1.map(s => ({ ...s, group: "1号艇展示タイム" })),
  ...stBoat1.map(s => ({ ...s, group: "1号艇ST" })),
  ...boat23Cmp.map(s => ({ ...s, group: "2vs3号艇展示" })),
  ...raceNoStats.map(s => ({ ...s, group: "race_no" })),
  ...windGroups.map(s => ({ ...s, group: "風速" })),
];

const paperForward = allStats.filter(s => classify(s) === "paper-forward候補");
const needsCheck   = allStats.filter(s => classify(s) === "要追加確認");
const goodConds    = allStats.filter(s => s.n >= 20 && s.roi >= 115);

// ─── Markdown 生成 ────────────────────────────────────────────────────────────

const pct = (v: number) => v.toFixed(1) + "%";

let md = `# 1-2-3 勝ち負け分解レポート

生成日時: ${new Date().toISOString()}
DB: ${DB_PATH}

> 現行除外条件（5会場 + race_no 10,11,12）適用後のデータを対象とする。
> このレポートは読み取り専用分析。本番ロジック変更は含まない。

## ベースライン

| 指標 | 値 |
|---|---|
| 全体（除外後・全selection）| n=${baseline.n.toLocaleString()} / ROI=${baseline.roi}% |
| **1-2-3 全体** | **n=${base123.n.toLocaleString()} / hits=${base123.hits} / ROI=${base123.roi}%** |
| 1-2-3 のシェア | ${Math.round(base123.n / baseline.n * 10000) / 100}% |

---

## A. オッズ帯別

| オッズ帯 | n | hits | 的中率 | ROI | 判定 |
|---|---|---|---|---|---|
${oddsBands.map(s => `| ${s.label} | ${s.n} | ${s.hits} | ${pct(s.hitRate)} | **${s.roi}%** | ${classify(s)} |`).join("\n")}

---

## B. 1号艇（1着候補）の展示タイム順位

> exhibition_data.ranking は全NULL。exhibition_time（小さい＝速い）で再計算。

| 条件 | n | hits | 的中率 | ROI | 判定 |
|---|---|---|---|---|---|
${exhBoat1.map(s => `| ${s.label} | ${s.n} | ${s.hits} | ${pct(s.hitRate)} | **${s.roi}%** | ${classify(s)} |`).join("\n")}

---

## C. 1号艇の展示ST

| 条件 | n | hits | 的中率 | ROI | 判定 |
|---|---|---|---|---|---|
${stBoat1.map(s => `| ${s.label} | ${s.n} | ${s.hits} | ${pct(s.hitRate)} | **${s.roi}%** | ${classify(s)} |`).join("\n")}

---

## D. 2号艇 vs 3号艇 展示タイム比較（2着・3着の有利不利）

> 2号艇の展示タイム < 3号艇の展示タイム → 2号艇が2着に入りやすい → 1-2-3 有利
> 3号艇の展示タイム < 2号艇の展示タイム → 3号艇が前に出やすい → 1-3-2 に流れるリスク

| 条件 | n | hits | 的中率 | ROI | 判定 |
|---|---|---|---|---|---|
${boat23Cmp.map(s => `| ${s.label} | ${s.n} | ${s.hits} | ${pct(s.hitRate)} | **${s.roi}%** | ${classify(s)} |`).join("\n")}

---

## E. race_no 別

| race_no | n | hits | 的中率 | ROI | 判定 |
|---|---|---|---|---|---|
${raceNoStats.map(s => `| ${s.label} | ${s.n} | ${s.hits} | ${pct(s.hitRate)} | **${s.roi}%** | ${classify(s)} |`).join("\n")}

---

## F. 風速・安定板別

| 条件 | n | hits | 的中率 | ROI | 判定 |
|---|---|---|---|---|---|
${windGroups.map(s => `| ${s.label} | ${s.n} | ${s.hits} | ${pct(s.hitRate)} | **${s.roi}%** | ${classify(s)} |`).join("\n")}

---

## G. 会場別（ROI昇順）

| 会場 | n | hits | 的中率 | ROI | 判定 |
|---|---|---|---|---|---|
${venueStats.map(s => `| ${s.venue} | ${s.n} | ${s.hits} | ${pct(s.hitRate)} | **${s.roi}%** | ${s.judgment} |`).join("\n")}

---

## H. 複合条件クロス

| 条件 | n | hits | 的中率 | ROI | 判定 |
|---|---|---|---|---|---|
${crossStats.map(s => `| ${s.label} | ${s.n} | ${s.hits} | ${pct(s.hitRate)} | **${s.roi}%** | ${classify(s)} |`).join("\n")}

---

## 判定まとめ

### paper-forward候補（n>=30 かつ ROI<80）

${paperForward.length > 0
  ? paperForward.map(s => `- **[${s.group}] ${s.label}**: n=${s.n} / hits=${s.hits} / ROI=${s.roi}%`).join("\n")
  : "- なし（ROI<80 かつ n>=30 の条件なし）"}

### 要追加確認（n>=20 かつ ROI<90）

${needsCheck.length > 0
  ? needsCheck.map(s => `- [${s.group}] ${s.label}: n=${s.n} / hits=${s.hits} / ROI=${s.roi}%`).join("\n")
  : "- なし"}

### 特に良い条件（n>=20 かつ ROI>=115）

${goodConds.length > 0
  ? goodConds.map(s => `- **[${s.group}] ${s.label}**: n=${s.n} / ROI=${s.roi}%`).join("\n")
  : "- なし（ROI>=115 の突出した条件なし）"}

---

## 結論

### 1-2-3 をやめるべき条件（paper-forward候補上位）

${paperForward.slice(0, 5).map((s, i) =>
  `${i + 1}. **${s.label}**: ROI=${s.roi}% (n=${s.n}) — 残存ROI改善見込み`
).join("\n") || "現時点で明確な除外候補なし"}

### 2号艇・3号艇の展示タイム比較の有効性

| 条件 | ROI | 解釈 |
|---|---|---|
| 2号艇 < 3号艇（1-2-3有利） | **${boat23Cmp[0]?.roi ?? "-"}%** | 2号艇が展示速い場合 |
| 3号艇 < 2号艇（1-3-2リスク） | **${boat23Cmp[1]?.roi ?? "-"}%** | 3号艇が展示速い場合 |
| 差 | **${Math.abs((boat23Cmp[0]?.roi ?? 0) - (boat23Cmp[1]?.roi ?? 0)).toFixed(1)}pt** | 有意差の有無 |

### 主要 paper-forward 候補の除外時残存ROI試算

| 除外条件 | 除外n | 除外ROI | 残存n | 残存ROI | 改善幅 |
|---|---|---|---|---|---|
${residuals.map(r =>
  `| ${r.label} | ${r.excluded.n} | ${r.excluded.roi}% | ${r.residual.n} | **${r.residual.roi}%** | **+${r.roiDelta}pt** |`
).join("\n")}

> ※ 残存ROI改善幅はバックテスト値。forward での再現性要確認。

### 次アクション

> **注意**: app_settings 変更はしない。paper-forward 候補として記録し forward 観察。

1. **最優先**: 「1号艇展示タイム1位」の除外 (n=1,031) → 残存ROI改善幅 ${residuals[0]?.roiDelta ?? "-"}pt が最大
2. **次点**: 「5R 除外」(n=503) → 残存ROI改善幅 ${residuals[1]?.roiDelta ?? "-"}pt
3. 2号艇 vs 3号艇 展示タイム比較（ROI差 ${Math.abs((boat23Cmp[0]?.roi ?? 0) - (boat23Cmp[1]?.roi ?? 0)).toFixed(1)}pt）が有効なら、3号艇が速い場合に 1-3-2 への変更を検討
`;

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");
writeFileSync(OUT_JSON, JSON.stringify({
  generatedAt: new Date().toISOString(),
  baseline: { n: baseline.n, roi: baseline.roi },
  base123,
  oddsBands, exhBoat1, stBoat1, boat23Cmp,
  raceNoStats, windGroups, venueStats, crossStats,
  paperForward, needsCheck, goodConds,
}, null, 2), "utf-8");

console.log(`[123-breakdown] 完了 → ${OUT_MD}`);
console.log(`\n1-2-3全体: n=${base123.n} / hits=${base123.hits} / ROI=${base123.roi}%`);
console.log(`\n【paper-forward候補】`);
if (paperForward.length === 0) console.log("  なし");
else paperForward.forEach(s => console.log(`  [${s.group}] ${s.label}: ROI=${s.roi}% (n=${s.n})`));
console.log(`\n【特に良い条件 ROI>=115】`);
if (goodConds.length === 0) console.log("  なし");
else goodConds.forEach(s => console.log(`  [${s.group}] ${s.label}: ROI=${s.roi}% (n=${s.n})`));
console.log(`\n【2号艇 vs 3号艇 展示タイム比較】`);
console.log(`  2号艇<3号艇（1-2-3有利）: ROI=${boat23Cmp[0]?.roi ?? "-"}% (n=${boat23Cmp[0]?.n ?? "-"})`);
console.log(`  3号艇<2号艇（1-3-2リスク）: ROI=${boat23Cmp[1]?.roi ?? "-"}% (n=${boat23Cmp[1]?.n ?? "-"})`);
