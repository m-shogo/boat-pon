/**
 * 次に消すべきBUY候補を読む専用分析。
 * DB read-only。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/no-buy-next-candidates.md";

if (!existsSync(DB_PATH)) throw new Error(`DB not found: ${DB_PATH}`);
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

type Row = {
  id: number; date: string; ym: string; venue: string; raceNo: number; selection: string; result: string; odds: number;
  venueMotor: number | null; exhibitionRank: number | null; wind: number | null; wave: number | null; fCount: number; parts: number;
};

try {
  const rows = loadRows();
  const before = metric(rows);
  const conditions = buildConditions(rows);
  const ranked = conditions.map((c) => {
    const removedRows = rows.filter(c.fn);
    const remainingRows = rows.filter((r) => !c.fn(r));
    const removed = metric(removedRows);
    const remaining = metric(remainingRows);
    const split = splitStability(removedRows);
    return { condition: c.label, removed, remaining, risk: c.risk, recommendation: recommend(removed, remaining, before, split), split, lift: remaining.roi - before.roi };
  }).filter((r) => r.removed.n >= 30).sort((a, b) => b.lift - a.lift || a.removed.roi - b.removed.roi);
  const report = { generatedAt: new Date().toISOString(), before, ranked };
  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/no-buy-next-candidates.json", `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUT_MD, renderMarkdown(report));
  console.log(`[analyze-no-buy-next] wrote ${OUT_MD}`);
  console.log("[analyze-no-buy-next] wrote reports/no-buy-next-candidates.json");
} finally {
  db.close();
}

function loadRows(): Row[] {
  const rows = db.prepare(`
WITH ranked_exhibition AS (
  SELECT race_id, course,
         COALESCE(ranking, RANK() OVER (PARTITION BY race_id ORDER BY exhibition_time ASC)) AS rank
  FROM exhibition_data
  WHERE exhibition_time IS NOT NULL OR ranking IS NOT NULL
), race_f AS (
  SELECT ent.race_id, SUM(CASE WHEN COALESCE(rp.flying_count,0)>0 THEN 1 ELSE 0 END) AS f_count
  FROM race_entries ent
  LEFT JOIN racer_profiles rp ON rp.registration_no=ent.racer_reg
  GROUP BY ent.race_id
), selected_parts AS (
  SELECT dh.id, SUM(CASE WHEN COALESCE(req.parts_changed_count,0)>0 THEN 1 ELSE 0 END) AS parts
  FROM decision_history dh
  JOIN race_equipment req ON req.race_id=dh.race_id AND instr('-'||dh.selection||'-','-'||req.course||'-')>0
  GROUP BY dh.id
)
SELECT dh.id, dh.date, dh.venue, dh.race_no, dh.selection, dh.result, dh.current_odds,
       mbs.motor_top2_rate AS venue_motor, re.rank AS exhibition_rank,
       rw.wind_speed_mps, rw.wave_height_cm, rf.f_count, sp.parts
FROM decision_history dh
LEFT JOIN motor_boat_stats mbs ON mbs.race_id=dh.race_id AND mbs.course=CAST(substr(dh.selection,1,1) AS INTEGER)
LEFT JOIN ranked_exhibition re ON re.race_id=dh.race_id AND re.course=CAST(substr(dh.selection,1,1) AS INTEGER)
LEFT JOIN race_weather rw ON rw.race_id=dh.race_id
LEFT JOIN race_f rf ON rf.race_id=dh.race_id
LEFT JOIN selected_parts sp ON sp.id=dh.id
WHERE dh.run_kind='historical-backfill'
  AND dh.decision='BUY'
  AND dh.current_odds IS NOT NULL
  AND dh.result IS NOT NULL
ORDER BY dh.date, dh.id
`).all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id), date: String(r.date), ym: String(r.date).slice(0, 7), venue: String(r.venue), raceNo: Number(r.race_no),
    selection: String(r.selection), result: String(r.result), odds: Number(r.current_odds),
    venueMotor: nullableNumber(r.venue_motor), exhibitionRank: nullableNumber(r.exhibition_rank),
    wind: nullableNumber(r.wind_speed_mps), wave: nullableNumber(r.wave_height_cm),
    fCount: Number(r.f_count ?? 0), parts: Number(r.parts ?? 0),
  }));
}

function buildConditions(rows: Row[]) {
  const base = [
    c("10R", (r: Row) => r.raceNo === 10, "現設定済み。test跳ねに注意"),
    c("11R", (r: Row) => r.raceNo === 11, "現設定済み。0hitだがn注意"),
    c("12R", (r: Row) => r.raceNo === 12, "現設定済み。n不足"),
    c("odds >= 50", (r: Row) => r.odds >= 50, "高配当1発依存注意"),
    c("odds < 20", (r: Row) => r.odds < 20, "低oddsは母数不足なら観察"),
    c("venueMotorTop2Rate >= 50", (r: Row) => (r.venueMotor ?? -1) >= 50, "motor人気過剰候補"),
    c("venueMotorTop2Rate 35-50", (r: Row) => (r.venueMotor ?? -1) >= 35 && (r.venueMotor ?? -1) < 50, "中高motor帯"),
    c("venueMotorTop2Rate < 35", (r: Row) => (r.venueMotor ?? 999) < 35, "低motor帯"),
    c("motor情報fallback/missing", (r: Row) => r.venueMotor == null, "n不足注意"),
    c("頭展示4位以下", (r: Row) => (r.exhibitionRank ?? 0) >= 4, "展示下位頭固定"),
    c("wind >= 5", (r: Row) => (r.wind ?? -1) >= 5, "水面リスク"),
    c("wind >= 8", (r: Row) => (r.wind ?? -1) >= 8, "強風"),
    c("wave >= 5", (r: Row) => (r.wave ?? -1) >= 5, "波高"),
    c("F持ち複数レース", (r: Row) => r.fCount > 1, "スタート心理"),
    c("部品交換あり", (r: Row) => r.parts > 0, "不確実性"),
  ];
  for (const venue of [...new Set(rows.map((r) => r.venue))]) base.push(c(`会場=${venue}`, (r) => r.venue === venue, "会場単位は過学習注意"));
  return base;
}

function c(label: string, fn: (row: Row) => boolean, risk: string) { return { label, fn, risk }; }

function metric(rows: Row[]) {
  const hits = rows.filter((r) => r.selection === r.result).map((r) => r.odds).sort((a, b) => b - a);
  const ret = hits.reduce((s, odds) => s + odds * 100, 0);
  const stake = rows.length * 100;
  const max = hits[0] ?? 0;
  return {
    n: rows.length,
    hits: hits.length,
    hitRate: rows.length ? hits.length / rows.length : 0,
    avgOdds: rows.length ? rows.reduce((s, r) => s + r.odds, 0) / rows.length : 0,
    roi: stake ? ret / stake : 0,
    roiExMaxHit: stake ? Math.max(0, ret - max * 100) / stake : 0,
    maxHitOdds: max,
  };
}

function splitStability(rows: Row[]) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const trainEnd = Math.floor(sorted.length * 0.7);
  const valEnd = Math.floor(sorted.length * 0.9);
  const train = metric(sorted.slice(0, trainEnd));
  const validation = metric(sorted.slice(trainEnd, valEnd));
  const test = metric(sorted.slice(valEnd));
  const months = [...new Set(rows.map((r) => r.ym))].map((ym) => metric(rows.filter((r) => r.ym === ym && rows.filter((x) => x.ym === ym).length >= 20)));
  const badMonths = months.filter((m) => m.n > 0 && m.roi < 0.8).length;
  return { train, validation, test, badMonths, months: months.filter((m) => m.n > 0).length };
}

function recommend(removed: ReturnType<typeof metric>, remaining: ReturnType<typeof metric>, before: ReturnType<typeof metric>, split: ReturnType<typeof splitStability>) {
  if (removed.n < 50) return "C: n不足";
  if (remaining.roi <= before.roi) return "D: 残りROI改善なし";
  if (removed.roi < 0.7 && split.train.roi < 0.9 && split.validation.roi < 0.9 && (split.test.n < 30 || split.test.roi < 0.9)) return "S: paper NO BUY検証";
  if (removed.roi < before.roi) return "A: 追加確認";
  return "B: 観察";
}

function renderMarkdown(report: { before: ReturnType<typeof metric>; ranked: Array<{ condition: string; removed: ReturnType<typeof metric>; remaining: ReturnType<typeof metric>; split: ReturnType<typeof splitStability>; risk: string; recommendation: string }> }) {
  const lines = [
    "# no buy next candidates",
    "",
    `baseline: n=${report.before.n} hit=${report.before.hits} ROI=${fmt(report.before.roi)}`,
    "",
    "| rank | NO BUY条件 | 削除BUY数 | 削除BUY ROI | 残りBUY数 | 残りROI | train/test安定性 | 推奨 |",
    "|---:|---|---:|---:|---:|---:|---|---|",
  ];
  report.ranked.slice(0, 40).forEach((r, i) => {
    const stability = `train=${fmt(r.split.train.roi)} validation=${fmt(r.split.validation.roi)} test=${fmt(r.split.test.roi)} badMonths=${r.split.badMonths}/${r.split.months}`;
    lines.push(`| ${i + 1} | ${r.condition} | ${r.removed.n} | ${fmt(r.removed.roi)} | ${r.remaining.n} | ${fmt(r.remaining.roi)} | ${stability} | ${r.recommendation} |`);
  });
  lines.push("");
  lines.push("## 注意");
  lines.push("- これはedge候補であり、本物のedgeではありません。");
  lines.push("- n<50、最大1hit依存、test逆行の条件は本番採用しません。");
  return `${lines.join("\n")}\n`;
}

function nullableNumber(value: unknown): number | null { if (value == null) return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function fmt(v: number) { return Number.isFinite(v) ? v.toFixed(3) : "-"; }
