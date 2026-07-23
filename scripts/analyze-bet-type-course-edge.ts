/**
 * analyze-bet-type-course-edge.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 *
 * 目的: racer_course_stats を使い、選手のコース適性が
 *       どの券種・条件で効いているかを確認する。
 *       racer_course_stats に実データが注入されているか null 率も確認する。
 * 注意: racer_course_stats は registration_no+course の現在スナップショットで、
 *       snapshot_date がない。過去ROIの証明・本番候補の根拠には使わない。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/bet-type-course-edge.md";
const OUT_JSON = "reports/bet-type-course-edge.json";
const STAKE = 100;

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

// ─── racer_course_stats の null 率確認 ──────────────────────────────────────

type NullCheck = { total: number; top3_null: number; avg_st_null: number; win_rate_null: number; start_order_null: number };
const nullCheck = db.prepare(`
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN top3_rate IS NULL THEN 1 ELSE 0 END) as top3_null,
    SUM(CASE WHEN avg_st IS NULL THEN 1 ELSE 0 END) as avg_st_null,
    SUM(CASE WHEN win_rate IS NULL THEN 1 ELSE 0 END) as win_rate_null,
    SUM(CASE WHEN start_order IS NULL THEN 1 ELSE 0 END) as start_order_null
  FROM racer_course_stats
`).get() as NullCheck;

const nullRates = {
  top3Rate: nullCheck.top3_null / nullCheck.total,
  avgSt: nullCheck.avg_st_null / nullCheck.total,
  winRate: nullCheck.win_rate_null / nullCheck.total,
  startOrder: nullCheck.start_order_null / nullCheck.total,
};

// ─── BUY データとコース適性のジョイン ────────────────────────────────────────

type BuyRow = {
  race_id: string; date: string; selection: string; result: string;
  boat1_racer: string | null; boat2_racer: string | null; boat3_racer: string | null;
  s1_course: number; s2_course: number; s3_course: number;
};

// BUY + race_entries で各選択艇の選手・コースを取得
const buyRows = db.prepare(`
  SELECT
    dh.race_id, dh.date, dh.selection, dh.result,
    e1.racer_reg as boat1_racer, e1.entry_course as s1_course,
    e2.racer_reg as boat2_racer, e2.entry_course as s2_course,
    e3.racer_reg as boat3_racer, e3.entry_course as s3_course
  FROM decision_history dh
  LEFT JOIN race_entries e1 ON e1.race_id=dh.race_id AND e1.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
  LEFT JOIN race_entries e2 ON e2.race_id=dh.race_id AND e2.boat=CAST(substr(dh.selection,3,1) AS INTEGER)
  LEFT JOIN race_entries e3 ON e3.race_id=dh.race_id AND e3.boat=CAST(substr(dh.selection,5,1) AS INTEGER)
  WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
    AND dh.result IS NOT NULL AND dh.result != ''
`).all() as BuyRow[];

// course_stats をメモリに展開
type CourseStatRow = { registration_no: string; course: number; top3_rate: number | null; avg_st: number | null; win_rate: number | null };
const courseStatsMap = new Map<string, CourseStatRow>();
for (const cs of db.prepare(`
  SELECT registration_no, course, top3_rate, avg_st, win_rate FROM racer_course_stats
`).all() as CourseStatRow[]) {
  courseStatsMap.set(`${cs.registration_no}|${cs.course}`, cs);
}

// payout index
const payoutIndex = new Map<string, number>();
const returnedSet = new Set<string>();
for (const p of db.prepare(`
  SELECT race_id, bet_type, combination, payout_yen, returned
  FROM race_payouts WHERE bet_type IN ('trifecta','trio','exacta','quinella','wide')
`).all() as { race_id: string; bet_type: string; combination: string; payout_yen: number | null; returned: number }[]) {
  const key = `${p.race_id}|${p.bet_type}|${p.combination}`;
  payoutIndex.set(key, p.payout_yen ?? 0);
  if (p.returned) returnedSet.add(key);
}

function getPayout(raceId: string, bt: string, comb: string) {
  const key = `${raceId}|${bt}|${comb}`;
  if (returnedSet.has(key)) return null;
  return payoutIndex.get(key) ?? 0;
}

function sp(a: number, b: number) { return a < b ? `${a}-${b}` : `${b}-${a}`; }
function st(a: number, b: number, c: number) { return [a,b,c].sort((x,y)=>x-y).join("-"); }

// ─── 特徴量グループ分け ──────────────────────────────────────────────────────

type CourseEdgeGroup = {
  label: string;
  trifectaROI: number; trioROI: number; exactaROI: number; quinellaROI: number;
  n: number; trifectaHits: number; trioHits: number;
};

function groupBy(predicate: (row: BuyRow) => boolean | null): CourseEdgeGroup {
  const matched = buyRows.filter(r => predicate(r));
  const n = matched.length;
  if (n === 0) return { label: "", n: 0, trifectaROI: 0, trioROI: 0, exactaROI: 0, quinellaROI: 0, trifectaHits: 0, trioHits: 0 };

  let trStake = 0, trReturn = 0, trHits = 0;
  let txStake = 0, txReturn = 0;
  let exStake = 0, exReturn = 0;
  let qnStake = 0, qnReturn = 0;

  for (const r of matched) {
    const [s1, s2, s3] = r.selection.split("-").map(Number);
    const raceId = r.race_id;

    const tfKey = `${raceId}|trifecta|${s1}-${s2}-${s3}`;
    if (!returnedSet.has(tfKey)) {
      trStake += STAKE;
      const p = payoutIndex.get(tfKey) ?? 0;
      trReturn += p;
      if (p > 0) trHits++;
    }

    const trioKey = `${raceId}|trio|${st(s1,s2,s3)}`;
    if (!returnedSet.has(trioKey)) {
      txStake += STAKE;
      txReturn += payoutIndex.get(trioKey) ?? 0;
    }

    const exKey = `${raceId}|exacta|${s1}-${s2}`;
    if (!returnedSet.has(exKey)) {
      exStake += STAKE;
      exReturn += payoutIndex.get(exKey) ?? 0;
    }

    const qnKey = `${raceId}|quinella|${sp(s1,s2)}`;
    if (!returnedSet.has(qnKey)) {
      qnStake += STAKE;
      qnReturn += payoutIndex.get(qnKey) ?? 0;
    }
  }

  const roi = (ret: number, stake: number) => stake > 0 ? Math.round(ret/stake*10000)/100 : 0;
  return {
    label: "",
    n,
    trifectaROI: roi(trReturn, trStake),
    trifectaHits: trHits,
    trioROI: roi(txReturn, txStake),
    trioHits: 0,
    exactaROI: roi(exReturn, exStake),
    quinellaROI: roi(qnReturn, qnStake),
  };
}

// top3_rate による分割（1着候補）
function getS1Top3Rate(row: BuyRow): number | null {
  const cs = courseStatsMap.get(`${row.boat1_racer}|${row.s1_course}`);
  return cs?.top3_rate ?? null;
}

function getAvg3Top3Rate(row: BuyRow): number | null {
  const r1 = courseStatsMap.get(`${row.boat1_racer}|${row.s1_course}`)?.top3_rate;
  const r2 = courseStatsMap.get(`${row.boat2_racer}|${row.s2_course}`)?.top3_rate;
  const r3 = courseStatsMap.get(`${row.boat3_racer}|${row.s3_course}`)?.top3_rate;
  if (r1 == null && r2 == null && r3 == null) return null;
  const vals = [r1,r2,r3].filter((v): v is number => v != null);
  return vals.reduce((s,v)=>s+v,0)/vals.length;
}

// null率確認
const withTop3Data = buyRows.filter(r => getS1Top3Rate(r) !== null).length;
const dataAvailRate = Math.round(withTop3Data / buyRows.length * 10000) / 100;

// 1着候補 top3_rate 帯別
const courseGroups: CourseEdgeGroup[] = [
  { ...groupBy(r => { const v = getS1Top3Rate(r); return v !== null && v >= 0.6; }), label: "1着候補 top3_rate≥0.6" },
  { ...groupBy(r => { const v = getS1Top3Rate(r); return v !== null && v >= 0.5 && v < 0.6; }), label: "1着候補 top3_rate 0.5-0.6" },
  { ...groupBy(r => { const v = getS1Top3Rate(r); return v !== null && v >= 0.4 && v < 0.5; }), label: "1着候補 top3_rate 0.4-0.5" },
  { ...groupBy(r => { const v = getS1Top3Rate(r); return v !== null && v < 0.4; }), label: "1着候補 top3_rate<0.4" },
  { ...groupBy(r => getS1Top3Rate(r) === null), label: "1着候補 top3_rate データなし" },
  // 3艇平均 top3_rate
  { ...groupBy(r => { const v = getAvg3Top3Rate(r); return v !== null && v >= 0.5; }), label: "3艇平均 top3_rate≥0.5 (安定)" },
  { ...groupBy(r => { const v = getAvg3Top3Rate(r); return v !== null && v < 0.4; }), label: "3艇平均 top3_rate<0.4 (不安定)" },
];

// ─── Markdown ────────────────────────────────────────────────────────────────

const pct = (v: number) => v.toFixed(1) + "%";
const roi = (v: number) => `**${v}%**`;

let md = `# コース適性 × 券種 ROI 分析

生成日時: ${new Date().toISOString()}
DB: ${DB_PATH}

> **時点整合性未達:** racer_course_stats に snapshot_date がないため、過去レース時点の値とは確認できない。以下は仮説生成専用で、本番接続・ROI証明には使わない。

## racer_course_stats データ品質確認

| フィールド | 総行数 | null件数 | null率 |
|---|---|---|---|
| top3_rate | ${nullCheck.total.toLocaleString()} | ${nullCheck.top3_null} | ${pct(nullRates.top3Rate*100)} |
| avg_st | ${nullCheck.total.toLocaleString()} | ${nullCheck.avg_st_null} | ${pct(nullRates.avgSt*100)} |
| win_rate | ${nullCheck.total.toLocaleString()} | ${nullCheck.win_rate_null} | ${pct(nullRates.winRate*100)} |
| start_order | ${nullCheck.total.toLocaleString()} | ${nullCheck.start_order_null} | ${pct(nullRates.startOrder*100)} |

- BUY レース中、1着候補の top3_rate が取得できた割合: **${pct(dataAvailRate)}** (${withTop3Data.toLocaleString()}/${buyRows.length.toLocaleString()})

${dataAvailRate < 50 ? `> **注意**: データ注入率が低い (${pct(dataAvailRate)})。コース適性分析は参考値として扱うこと。` : ""}

## コース適性帯別 ROI 比較

| 条件 | n | 3連単 ROI | 3連複 ROI | 2連単 ROI | 2連複 ROI |
|---|---|---|---|---|---|
${courseGroups.map(g =>
  `| ${g.label} | ${g.n} | ${roi(g.trifectaROI)} | ${roi(g.trioROI)} | ${roi(g.exactaROI)} | ${roi(g.quinellaROI)} |`
).join("\n")}

## 解釈ガイド（仮説生成専用）

- **top3_rate≥0.6 の1着候補**: 選手が実績あり。3連単でも順番が当たりやすい傾向か確認。
- **3艇平均 top3_rate が高い**: 3連複・2連複が機能しやすい可能性。
- **データなし群**: racer_course_stats に未注入のため、現在値で補完しない。
- top3_rate が 50% 以上でも、snapshot_date <= race_date の履歴が作られるまで本番候補には昇格しない。

## 判定

- 現在の分析は pointInTimeSafe=false。時点付きスナップショットを用意し、同じ期間分割で再計測するまで採用しない。
- dataAvailRate=${dataAvailRate}% はカバレッジであり、予測精度や利益性を意味しない。
`;

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");
writeFileSync(OUT_JSON, JSON.stringify({
  generatedAt: new Date().toISOString(),
  safety: { readOnly: true, pointInTimeSafe: false, productionConnected: false },
  nullRates, dataAvailRate, courseGroups,
}, null, 2), "utf-8");

console.log(`[course-edge] 完了 → ${OUT_MD}`);
console.log(`  top3_rate データ注入率: ${pct(dataAvailRate)}`);
for (const g of courseGroups) {
  console.log(`  ${g.label}: n=${g.n} trifecta=${g.trifectaROI}% trio=${g.trioROI}%`);
}
