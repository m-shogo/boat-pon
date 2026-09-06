/**
 * analyze-roi-mechanism-skip-filters.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 * BUY は検証候補、ROI は検証指標であり購入推奨ではない。
 * 主評価: race_payouts.payout_yen 実払戻ベース
 *
 * 見送りROI分析: forward期のBUY全体に対し「この条件を見送った場合に
 * forward ROI が改善するか」を切り口別に計測する。
 * 新規BUY候補探索ではない。除外効果の測定のみ。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/roi-mechanism-skip-filters.md";
const OUT_JSON = "reports/roi-mechanism-skip-filters.json";
const STAKE = 100;
const FORWARD_START = "2025-01-01";
const EXCL_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES  = [10, 11, 12];
const MIN_EXCL_N  = 5;   // 除外対象 n < MIN_EXCL_N → data-insufficient
const MIN_REMAIN_N = 30; // 残存 n < MIN_REMAIN_N → data-insufficient

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

function r2(v: number) { return Math.round(v * 100) / 100; }
function calcRoi(payout: number, n: number) { return n > 0 ? r2(payout / (n * STAKE) * 100) : 0; }

// ─── 直近3M基準日を動的取得 ─────────────────────────────────────────────────────

const dbMaxDate = (db.prepare(
  "SELECT MAX(date) as d FROM decision_history WHERE date >= ?"
).get(FORWARD_START) as { d: string }).d;
const recent3mCutoff = (() => {
  const [y, m, d] = dbMaxDate.split("-").map(Number);
  const dt = new Date(y, m - 4, d); // 3ヶ月前 (JS月は0始まり)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
})();

console.log(`[skip-filters] DB最新日(forward): ${dbMaxDate}, 直近3M基準: ${recent3mCutoff}〜`);

// ─── 全 forward BUY 行を1クエリで取得 ───────────────────────────────────────────

const WIND24 = `EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id
  AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)`;
const EXH1 = `EXISTS (SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=1
    AND ed.exhibition_time IS NOT NULL
    AND ed.exhibition_time = (SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2
      WHERE ed2.race_id=dh.race_id))`;

const excl_v = EXCL_VENUES.map(v => `'${v}'`).join(",");
const excl_r = EXCL_RACES.join(",");

type ForwardRow = {
  date: string;
  venue: string;
  race_no: number;
  current_odds: number;
  result: string;
  payout: number;
  is_condB: number;
};

console.log("[skip-filters] forward BUY 行を取得中...");
const allRows = db.prepare(`
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
    AND selection='1-2-3'
    AND date >= '${FORWARD_START}'
  ORDER BY date
`).all() as ForwardRow[];

console.log(`[skip-filters] 取得完了: n=${allRows.length}`);

// ─── ベースライン ────────────────────────────────────────────────────────────────

const totalN       = allRows.length;
const totalPayout  = allRows.reduce((a, r) => a + r.payout, 0);
const totalHits    = allRows.filter(r => r.result === "1-2-3").length;
const baselineRoi  = calcRoi(totalPayout, totalN);
const baselineHitRate = r2(totalHits / totalN * 100);

console.log(`[skip-filters] baseline: n=${totalN} hits=${totalHits}(${baselineHitRate}%) ROI=${baselineRoi}%`);

// ─── Skip 統計計算 ───────────────────────────────────────────────────────────────

type SkipStats = {
  excludedN: number;
  excludedPayout: number;
  excludedHits: number;
  excludedRoi: number;
  remainingN: number;
  remainingPayout: number;
  remainingHits: number;
  remainingRoi: number;
  delta: number;             // remainingRoi - baselineRoi (正 = 除外で改善)
  top1ExclRoi: number;       // 除外対象のうちtop1払戻を外したROI
  top2ExclRoi: number;
  top3ExclRoi: number;
  maxPayout: number;
  jackpotRatio: number;      // top1払戻 / 除外対象合計払戻 (%)
};

function computeSkip(excludedRows: ForwardRow[]): SkipStats {
  const excludedN       = excludedRows.length;
  const excludedPayout  = excludedRows.reduce((a, r) => a + r.payout, 0);
  const excludedHits    = excludedRows.filter(r => r.result === "1-2-3").length;
  const remainingN      = totalN - excludedN;
  const remainingPayout = totalPayout - excludedPayout;
  const remainingHits   = totalHits - excludedHits;

  const sorted   = [...excludedRows].sort((a, b) => b.payout - a.payout).map(r => r.payout);
  const top1sum  = sorted[0] ?? 0;
  const top2sum  = top1sum + (sorted[1] ?? 0);
  const top3sum  = top2sum + (sorted[2] ?? 0);

  const remRoi = calcRoi(remainingPayout, remainingN);
  return {
    excludedN,
    excludedPayout,
    excludedHits,
    excludedRoi: calcRoi(excludedPayout, excludedN),
    remainingN,
    remainingPayout,
    remainingHits,
    remainingRoi: remRoi,
    delta: r2(remRoi - baselineRoi),
    top1ExclRoi: calcRoi(excludedPayout - top1sum, excludedN),
    top2ExclRoi: calcRoi(excludedPayout - top2sum, excludedN),
    top3ExclRoi: calcRoi(excludedPayout - top3sum, excludedN),
    maxPayout: top1sum,
    jackpotRatio: excludedPayout > 0 ? r2(top1sum / excludedPayout * 100) : 0,
  };
}

type VerdictLabel =
  | "除外効果あり（高）"
  | "除外効果あり"
  | "要確認"
  | "除外効果なし"
  | "除外は逆効果"
  | "data-insufficient";

const VERDICT_ICON: Record<VerdictLabel, string> = {
  "除外効果あり（高）": "🟢",
  "除外効果あり":       "🔵",
  "要確認":             "🟡",
  "除外効果なし":       "⚪",
  "除外は逆効果":       "🔴",
  "data-insufficient":  "⚫",
};

function getVerdict(s: SkipStats): VerdictLabel {
  if (s.excludedN < MIN_EXCL_N || s.remainingN < MIN_REMAIN_N) return "data-insufficient";
  if (s.delta >= 5)  return "除外効果あり（高）";
  if (s.delta >= 2)  return "除外効果あり";
  if (s.delta >= 0.5) return "要確認";
  if (s.delta < -2)  return "除外は逆効果";
  return "除外効果なし";
}

function getNote(s: SkipStats): string {
  const notes: string[] = [];
  if (s.excludedHits === 0) notes.push("除外対象0hit");
  if (s.jackpotRatio > 70 && s.excludedN >= MIN_EXCL_N) notes.push(`高配当1件依存(${s.jackpotRatio}%)`);
  if (s.top2ExclRoi < 10 && s.excludedN >= 10) notes.push("top2除外で収益ほぼゼロ");
  if (s.excludedRoi < 30 && s.excludedN >= MIN_EXCL_N) notes.push("除外対象ROI極低");
  if (s.excludedRoi > 200) notes.push("除外対象ROI高(除外は逆効果リスク)");
  return notes.join(" / ") || "—";
}

// ─── フィルター定義 & 集計 ───────────────────────────────────────────────────────

type FilterResult = {
  group: string;
  id: string;
  name: string;
  stats: SkipStats;
  verdict: VerdictLabel;
  note: string;
};

const results: FilterResult[] = [];

function addFilter(
  group: string,
  id: string,
  name: string,
  predicate: (r: ForwardRow) => boolean
) {
  const excluded = allRows.filter(predicate);
  const stats = computeSkip(excluded);
  const verdict = getVerdict(stats);
  results.push({ group, id, name, stats, verdict, note: getNote(stats) });
}

// raceNo 別 (1R〜9R)
for (let rn = 1; rn <= 9; rn++) {
  addFilter("raceNo", `race_${rn}R`, `${rn}R`, r => r.race_no === rn);
}

// venue 別 (forward n >= MIN_EXCL_N の会場のみ)
const venues = [...new Set(allRows.map(r => r.venue))].sort();
for (const v of venues) {
  if (allRows.filter(r => r.venue === v).length >= MIN_EXCL_N) {
    addFilter("venue", `venue_${v}`, v, r => r.venue === v);
  }
}

// odds 帯別
const ODDS_BANDS = [
  { id: "odds_lt20",   name: "odds<20",   pred: (r: ForwardRow) => r.current_odds < 20 },
  { id: "odds_20_39",  name: "odds20〜39", pred: (r: ForwardRow) => r.current_odds >= 20 && r.current_odds < 40 },
  { id: "odds_40_79",  name: "odds40〜79", pred: (r: ForwardRow) => r.current_odds >= 40 && r.current_odds < 80 },
  { id: "odds_80plus", name: "odds80以上", pred: (r: ForwardRow) => r.current_odds >= 80 },
];
for (const b of ODDS_BANDS) {
  addFilter("odds", b.id, b.name, b.pred);
}

// 月別 (各月を単独で除外した場合)
const months = [...new Set(allRows.map(r => r.date.slice(0, 7)))].sort();
for (const m of months) {
  addFilter("month", `month_${m}`, m, r => r.date.startsWith(m));
}

// 直近3M
addFilter("recent", "recent_3m",
  `直近3M(${recent3mCutoff}〜)`,
  r => r.date >= recent3mCutoff
);

// 条件B 重複 / 非重複
addFilter("condB", "condB_yes", "条件B重複(風速2〜4×展示1位)", r => r.is_condB === 1);
addFilter("condB", "condB_no",  "条件B非重複",                  r => r.is_condB === 0);

// 払戻帯 (高配当依存チェック): 実データからパーセンタイル算出
const hitPayouts = allRows
  .filter(r => r.payout > 0)
  .map(r => r.payout)
  .sort((a, b) => a - b);
const maxPayout  = hitPayouts[hitPayouts.length - 1] ?? 0;
const p50Payout  = hitPayouts[Math.floor(hitPayouts.length * 0.5)] ?? 0;
const p75Payout  = hitPayouts[Math.floor(hitPayouts.length * 0.75)] ?? 0;
const p90Payout  = hitPayouts[Math.floor(hitPayouts.length * 0.9)] ?? 0;

addFilter("payout", "payout_zero",  "0hit(払戻=0)",           r => r.payout === 0);
addFilter("payout", "payout_gt_p50", `払戻>${p50Payout}円超(>p50)`,  r => r.payout > p50Payout);
addFilter("payout", "payout_gt_p75", `払戻>${p75Payout}円超(>p75)`,  r => r.payout > p75Payout);
addFilter("payout", "payout_gt_p90", `払戻>${p90Payout}円超(>p90)`,  r => r.payout > p90Payout);

// ─── 月別ROI 一覧（参考） ────────────────────────────────────────────────────────

const monthlyStats = months.map(m => {
  const mRows   = allRows.filter(r => r.date.startsWith(m));
  const mPayout = mRows.reduce((a, r) => a + r.payout, 0);
  const mHits   = mRows.filter(r => r.result === "1-2-3").length;
  return {
    month: m,
    n: mRows.length,
    hits: mHits,
    hitRate: mRows.length > 0 ? r2(mHits / mRows.length * 100) : 0,
    roi: calcRoi(mPayout, mRows.length),
    isRecent: m >= recent3mCutoff.slice(0, 7),
  };
});

// ─── 除外効果ランキング ───────────────────────────────────────────────────────────
// payout グループは事後情報（払戻額は事前不明）のため、ランキングから除外して参考扱い

const rankable = results
  .filter(r => r.verdict !== "data-insufficient" && r.group !== "payout")
  .sort((a, b) => b.stats.delta - a.stats.delta);

const topPositive = rankable.filter(r => r.stats.delta >= 0.5).slice(0, 15);
const topNegative = rankable.filter(r => r.stats.delta < -2).slice(0, 5);

// ─── Markdown 生成 ───────────────────────────────────────────────────────────────

const now = new Date().toISOString();

function fmtRoi(v: number) {
  const sign = v >= 0 ? "" : "";
  return `${sign}${v}%`;
}
function fmtDelta(v: number) {
  if (v >= 0.5) return `**+${v}pt**`;
  if (v <= -2)  return `**${v}pt**`;
  return `${v}pt`;
}

function tableRow(r: FilterResult) {
  const s = r.stats;
  return `| ${VERDICT_ICON[r.verdict]} ${r.verdict} | ${r.name} | ${s.excludedN} | ${fmtRoi(s.excludedRoi)} | ${s.remainingN} | ${fmtRoi(s.remainingRoi)} | ${fmtDelta(s.delta)} | ${r.note} |`;
}

const RANK_HEADER = `| 判定 | フィルター | 除外n | 除外ROI | 残存n | **残存ROI** | **delta** | 特記 |
|---|---|---|---|---|---|---|---|`;

function byGroup(group: string) {
  return results.filter(r => r.group === group).sort((a, b) => b.stats.delta - a.stats.delta);
}

// 月別ROI表
const monthTable = monthlyStats.map(m => {
  const flag = m.roi === 0 ? "⚠️ 0hit" : m.roi >= 100 ? "✅ 黒字" : m.isRecent ? "🔶 直近" : "—";
  return `| ${m.isRecent ? "**" + m.month + "**" : m.month} | ${m.n} | ${m.hits} | ${m.hitRate}% | **${m.roi}%** | ${flag} |`;
}).join("\n");

// 条件B分析
const condBYes = results.find(r => r.id === "condB_yes");
const condBNo  = results.find(r => r.id === "condB_no");

let md = `# 見送りROI分析 (skip-filter)

生成日時: ${now}
DB: ${DB_PATH}
forward期間: ${FORWARD_START}〜${dbMaxDate}
直近3M基準: ${recent3mCutoff}〜

> **読み取り専用。BUY は検証候補、ROI は検証指標。購入指示ではない。app_settings / 本番 decision 変更禁止。**
> **新規BUY探索ではない。既存BUYの「見送り効果」測定のみ。**
> ROI基準: race_payouts.payout_yen 実払戻

---

## ベースライン

| 項目 | 値 |
|---|---|
| forward 全件 n | **${totalN}** |
| 的中数 | ${totalHits} (${baselineHitRate}%) |
| **ベースライン ROI** | **${baselineRoi}%** |
| ベースライン 賭け金 | ${(totalN * STAKE).toLocaleString()}円 |
| 払戻合計 | ${totalPayout.toLocaleString()}円 |

> delta = 残存ROI − ベースライン (正 = 除外で改善、負 = 除外で悪化)

---

## 除外効果ランキング（delta 降順 top15）

> delta >= +2pt: 除外効果あり / delta >= +0.5pt: 要確認 / delta < -2pt: 逆効果

${RANK_HEADER}
${topPositive.map(tableRow).join("\n")}

${topNegative.length > 0 ? `### 除外は逆効果 (delta < -2pt)

${RANK_HEADER}
${topNegative.map(tableRow).join("\n")}` : ""}

---

## raceNo 別

${RANK_HEADER}
${byGroup("raceNo").map(tableRow).join("\n")}

---

## venue 別

${RANK_HEADER}
${byGroup("venue").map(tableRow).join("\n")}

---

## odds 帯別

${RANK_HEADER}
${byGroup("odds").map(tableRow).join("\n")}

---

## 月別 forward ROI（各月を単独除外）

${RANK_HEADER}
${byGroup("month").map(tableRow).join("\n")}

### 月別ROI 一覧（参考）

| 月 | n | 的中 | 的中率 | **ROI** | 判定 |
|---|---|---|---|---|---|
${monthTable}

> ※ **太字月** = 直近3M (${recent3mCutoff}〜)

---

## 直近3M 分析

${(() => {
  const r3m = results.find(r => r.id === "recent_3m");
  if (!r3m) return "（データなし）";
  const s = r3m.stats;
  const recentMonths = monthlyStats.filter(m => m.isRecent);
  const zeroCount = recentMonths.filter(m => m.roi === 0).length;
  return `| 項目 | 値 |
|---|---|
| 直近3M 期間 | ${recent3mCutoff}〜${dbMaxDate} |
| 直近3M n | ${s.excludedN} |
| 直近3M ROI | ${s.excludedRoi}% |
| 直近3M 的中数 | ${s.excludedHits} |
| 直近3M 0hit 月数 | ${zeroCount}ヶ月 / ${recentMonths.length}ヶ月 |
| 直近3M 除外後 残存ROI | ${s.remainingRoi}% |
| delta | ${fmtDelta(s.delta)} |
| 判定 | ${VERDICT_ICON[r3m.verdict]} ${r3m.verdict} |

${s.excludedHits === 0 ? "> ⚠️ **直近3M が 0hit** — forward後半の失速は実データで確認済み" : ""}
${zeroCount >= 2 ? `> ⚠️ 直近${zeroCount}ヶ月で0hit継続中` : ""}`;
})()}

---

## 条件B 重複分析

> 条件B = 風速2〜4m/s × 1号艇展示1位（3連単1-3-2 forward急伸候補）

| 項目 | 条件B重複 | 条件B非重複 |
|---|---|---|
| n | ${condBYes?.stats.excludedN ?? "—"} | ${condBNo?.stats.excludedN ?? "—"} |
| 除外対象 ROI | ${condBYes?.stats.excludedRoi ?? "—"}% | ${condBNo?.stats.excludedRoi ?? "—"}% |
| 除外後 残存ROI | ${condBYes?.stats.remainingRoi ?? "—"}% | ${condBNo?.stats.remainingRoi ?? "—"}% |
| delta | ${condBYes ? fmtDelta(condBYes.stats.delta) : "—"} | ${condBNo ? fmtDelta(condBNo.stats.delta) : "—"} |
| 判定 | ${condBYes ? VERDICT_ICON[condBYes.verdict] + " " + condBYes.verdict : "—"} | ${condBNo ? VERDICT_ICON[condBNo.verdict] + " " + condBNo.verdict : "—"} |

> 注意: 条件B自体は 1-3-2 (switch) での評価。ここでは 1-2-3 ROI への影響を見ている。

---

## 払戻帯 分析（高配当依存チェック・参考）

> ⚠️ **この切り口は事後情報（払戻額は事前不明）** — ランキングには含めない。高配当依存度の確認のみ。

${RANK_HEADER}
${byGroup("payout").map(tableRow).join("\n")}

${(() => {
  const gt20k = results.find(r => r.id === "payout_gt20k");
  const gt50k = results.find(r => r.id === "payout_gt50k");
  const gt100k = results.find(r => r.id === "payout_gt100k");

  const allSorted = [...allRows].sort((a, b) => b.payout - a.payout).slice(0, 10);
  const topHitsTable = allSorted
    .filter(r => r.payout > 0)
    .map(r => `| ${r.date} | ${r.venue} | ${r.race_no}R | ${r.current_odds} | ${r.payout.toLocaleString()}円 |`)
    .join("\n");

  const rGtp50  = results.find(r => r.id === "payout_gt_p50");
  const rGtp75  = results.find(r => r.id === "payout_gt_p75");
  const rGtp90  = results.find(r => r.id === "payout_gt_p90");
  return `### 高配当 top10（forward期）

| date | 会場 | R | current_odds | 実払戻 |
|---|---|---|---|---|
${topHitsTable}

> 最大実払戻: **${maxPayout.toLocaleString()}円** (3連単1-2-3は本命買い目 — 単一ジャックポット依存は低い)
> p50(中央値): ${p50Payout.toLocaleString()}円 / p75: ${p75Payout.toLocaleString()}円 / p90: ${p90Payout.toLocaleString()}円 / max: ${maxPayout.toLocaleString()}円
> 払戻>p50(${p50Payout}円): ${rGtp50?.stats.excludedN ?? 0}件 / 払戻>p75(${p75Payout}円): ${rGtp75?.stats.excludedN ?? 0}件 / 払戻>p90(${p90Payout}円): ${rGtp90?.stats.excludedN ?? 0}件`;
})()}

---

## 結論

### 除外効果が高いフィルター（delta >= +2pt）

${topPositive.filter(r => r.stats.delta >= 2).length === 0
  ? "> 現時点で delta >= +2pt のフィルターなし。基準を見直すか追加データ蓄積を待つ。"
  : topPositive
    .filter(r => r.stats.delta >= 2)
    .map(r => `- **${r.name}** (delta=+${r.stats.delta}pt, 残存ROI=${r.stats.remainingRoi}%) — ${r.note}`)
    .join("\n")
}

### 現フェーズでの扱い

- 🔍 **monitor-only** フェーズ — 結果は参考情報のみ
- 除外効果が確認されても、 **app_settings / 本番 decision ロジックは変更しない**
- delta >= +5pt かつ 残存n >= 30 を満たすフィルターが出た場合、次回 roi-governor で評価する

### 次の確認タイミング

forward データが蓄積（条件B n=167→200 到達）したタイミングで再実行。

---
*生成: analyze-roi-mechanism-skip-filters.ts*
`;

// ─── JSON 出力 ───────────────────────────────────────────────────────────────────

const jsonOut = {
  generatedAt: now,
  forwardStart: FORWARD_START,
  forwardEnd: dbMaxDate,
  recent3mCutoff,
  baseline: { n: totalN, hits: totalHits, hitRate: baselineHitRate, roi: baselineRoi },
  filters: results.map(r => ({
    group: r.group,
    id: r.id,
    name: r.name,
    verdict: r.verdict,
    note: r.note,
    ...r.stats,
  })),
  monthly: monthlyStats,
  topPositive: topPositive.map(r => ({ id: r.id, name: r.name, delta: r.stats.delta, remainingRoi: r.stats.remainingRoi, verdict: r.verdict })),
};

// ─── 書き出し ────────────────────────────────────────────────────────────────────

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD,   md,                       "utf-8");
writeFileSync(OUT_JSON, JSON.stringify(jsonOut, null, 2), "utf-8");

console.log(`\n[skip-filters] 完了 → ${OUT_MD}`);
console.log(`  baseline ROI: ${baselineRoi}%  (n=${totalN})`);
if (topPositive.length > 0) {
  console.log(`  除外効果あり (delta>+0.5pt): ${topPositive.length}件`);
  topPositive.slice(0, 5).forEach(r =>
    console.log(`    ${r.name}: delta=+${r.stats.delta}pt → 残存ROI=${r.stats.remainingRoi}%`)
  );
} else {
  console.log("  除外効果あり(delta>+0.5pt): 0件");
}
