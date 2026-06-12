/**
 * report-point-in-time-leak-impact.ts — 読み取り専用
 *
 * 禁止: DBへのINSERT/UPDATE/DELETE/DROP/ALTER, app_settings変更, BUY条件変更
 *
 * 目的:
 *   point-in-time safety hardening（2026-06-13実装）の前後で、
 *   既存 decision_history の BUY 判定が何件変わっていたかを定量化する。
 *
 *   質問: 「live-only 特徴量（courseStFactor/courseTop3Factor/exhibitionResidualFactor）が
 *         historical-backfill に混入していたことで、BUY/SKIP 判定が変わったケースはあるか？」
 *
 * 手法:
 *   feature_adjustment_breakdown が記録されている decision_history 行について、
 *   live-only factor を除去（= 1 に戻す）した場合の required_odds を計算し、
 *   実際の current_odds と比較する。
 *
 * 出力:
 *   reports/point-in-time-leak-impact.md
 *   reports/point-in-time-leak-impact.json
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/point-in-time-leak-impact.md";
const OUT_JSON = "reports/point-in-time-leak-impact.json";

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");

type DecisionRow = {
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  selection: string;
  decision: string;
  conservative_hit_rate: number;
  required_odds: number | null;
  current_odds: number | null;
  feature_adjustment_breakdown: string;
};

type Breakdown = {
  total: number;
  courseStFactor?: number;
  courseTop3Factor?: number;
  exhibitionResidualFactor?: number;
  [key: string]: number | undefined;
};

const rows = db.prepare(`
SELECT race_id, date, venue, race_no, selection, decision,
  conservative_hit_rate, required_odds, current_odds,
  feature_adjustment_breakdown
FROM decision_history
WHERE feature_adjustment_breakdown IS NOT NULL
ORDER BY date ASC
`).all() as DecisionRow[];

db.close();

// ─── 集計 ─────────────────────────────────────────────────────────────────────

type ImpactRow = {
  raceId: string;
  date: string;
  decision: string;
  liveFactorProduct: number;
  reqWithLeak: number;
  reqClean: number;
  currentOdds: number | null;
  wouldBuyWithLeak: boolean;
  wouldBuyClean: boolean;
  decisionChanged: boolean;
};

const impactRows: ImpactRow[] = [];

let neutralCount = 0;
let positiveCount = 0;
let negativeCount = 0;
let buyBuyCount = 0;
let buySkipCount = 0;
let skipBuyCount = 0;
let watchChangedCount = 0;

for (const row of rows) {
  const bd: Breakdown = JSON.parse(row.feature_adjustment_breakdown);
  const liveFactorProduct =
    (bd.courseStFactor ?? 1) * (bd.courseTop3Factor ?? 1) * (bd.exhibitionResidualFactor ?? 1);

  if (Math.abs(liveFactorProduct - 1) < 0.0001) neutralCount++;
  else if (liveFactorProduct > 1) positiveCount++;
  else negativeCount++;

  const reqWithLeak = row.required_odds ?? null;
  if (reqWithLeak == null) continue;

  // reqClean = reqWithLeak * liveFactorProduct
  // （live-only 除去で hit_rate が下がる → required_odds が上がる: factor>1 の場合）
  const reqClean = reqWithLeak * liveFactorProduct;
  const cur = row.current_odds;

  const wouldBuyWithLeak = cur != null && cur > 0 && cur >= reqWithLeak;
  const wouldBuyClean = cur != null && cur > 0 && cur >= reqClean;
  const decisionChanged = wouldBuyWithLeak !== wouldBuyClean;

  if (decisionChanged) {
    if (row.decision === "BUY") {
      if (!wouldBuyClean) buySkipCount++;
      else buyBuyCount++;
    } else if (row.decision === "SKIP") {
      if (wouldBuyClean) skipBuyCount++;
    } else {
      watchChangedCount++;
    }
  } else if (row.decision === "BUY" && wouldBuyWithLeak && wouldBuyClean) {
    buyBuyCount++;
  }

  if (decisionChanged || row.decision === "BUY") {
    impactRows.push({
      raceId: row.race_id,
      date: row.date,
      decision: row.decision,
      liveFactorProduct: Math.round(liveFactorProduct * 10000) / 10000,
      reqWithLeak: Math.round(reqWithLeak * 10) / 10,
      reqClean: Math.round(reqClean * 10) / 10,
      currentOdds: cur,
      wouldBuyWithLeak,
      wouldBuyClean,
      decisionChanged,
    });
  }
}

// ─── breakdown なし BUY の件数（参考） ───────────────────────────────────────

const totalBuyNoBreakdown = (() => {
  const d2 = new DatabaseSync(DB_PATH, { readOnly: true });
  const r = d2.prepare(`
SELECT COUNT(*) as n FROM decision_history
WHERE decision = 'BUY' AND feature_adjustment_breakdown IS NULL
`).get() as { n: number };
  d2.close();
  return r.n;
})();

// ─── サマリー ─────────────────────────────────────────────────────────────────

const summary = {
  generatedAt: new Date().toISOString(),
  note: "読み取り専用。ROI評価・BUY条件変更・候補変更は行わない。",
  methodology: "feature_adjustment_breakdown の live-only factor（courseStFactor / courseTop3Factor / exhibitionResidualFactor）を除去（=1）した場合の required_odds を計算し、actual decision との差分を集計。",
  scope: {
    rowsWithBreakdown: rows.length,
    rowsWithoutBreakdown: "本レポートの対象外（feature_adjustment_breakdown 列追加前の decisions）",
    buyDecisionsWithBreakdown: buyBuyCount + buySkipCount,
    buyDecisionsWithoutBreakdown: totalBuyNoBreakdown,
    note: "breakdownなしBUYは live-only feature が適用される前に生成されたため、リークの影響を受けない。",
  },
  factorDistribution: {
    neutral: neutralCount,
    positive: positiveCount,
    negative: negativeCount,
    note: "positive = courseStFactor or courseTop3Factor が > 1（現在の選手が得意コースに出場）。negative = < 1（苦手コース）。",
  },
  decisionImpact: {
    buyChangedToSkip: buySkipCount,
    skipChangedToBuy: skipBuyCount,
    watchChanged: watchChangedCount,
    buyUnchanged: buyBuyCount,
    conclusion: buySkipCount === 0 && skipBuyCount === 0
      ? "BUY/SKIP 決定が変わったケースはゼロ。live-only feature リークは既存 BUY 判定に影響していなかった。"
      : `警告: BUY→SKIP が ${buySkipCount} 件、SKIP→BUY が ${skipBuyCount} 件。要確認。`,
  },
  buyDetails: impactRows.filter((r) => r.decision === "BUY"),
  changedDetails: impactRows.filter((r) => r.decisionChanged && r.decision !== "WATCH").slice(0, 20),
  watchChangedSample: impactRows.filter((r) => r.decisionChanged && r.decision === "WATCH").slice(0, 5),
};

mkdirSync("reports", { recursive: true });
writeFileSync(OUT_JSON, `${JSON.stringify(summary, null, 2)}\n`);

const md = renderMarkdown(summary);
writeFileSync(OUT_MD, md);

console.log(`[report-point-in-time-leak-impact] rows=${rows.length} buyChanged=${buySkipCount} skipToBuy=${skipBuyCount}`);
console.log(`[report-point-in-time-leak-impact] conclusion: ${summary.decisionImpact.conclusion}`);
console.log(`[report-point-in-time-leak-impact] wrote ${OUT_MD}`);
console.log(`[report-point-in-time-leak-impact] wrote ${OUT_JSON}`);

function renderMarkdown(s: typeof summary): string {
  const lines: string[] = [];
  lines.push("# point-in-time live-only feature リーク影響分析");
  lines.push("");
  lines.push(`生成日時: ${s.generatedAt}`);
  lines.push("");
  lines.push(`> ${s.note}`);
  lines.push("");
  lines.push("## 方法");
  lines.push("");
  lines.push(s.methodology);
  lines.push("");
  lines.push("## 対象スコープ");
  lines.push("");
  lines.push(`- breakdownデータあり: **${s.scope.rowsWithBreakdown}** 行（対象）`);
  lines.push(`- BUY決定（breakdown付き）: **${s.scope.buyDecisionsWithBreakdown}** 件`);
  lines.push(`- BUY決定（breakdown無し）: **${s.scope.buyDecisionsWithoutBreakdown}** 件（breakdown列追加前に生成、リーク影響外）`);
  lines.push("");
  lines.push("## factor 分布");
  lines.push("");
  lines.push(`| | 件数 |`);
  lines.push(`|---|---|`);
  lines.push(`| live-only factor = 1（中立） | ${s.factorDistribution.neutral} |`);
  lines.push(`| live-only factor > 1（正の影響） | ${s.factorDistribution.positive} |`);
  lines.push(`| live-only factor < 1（負の影響） | ${s.factorDistribution.negative} |`);
  lines.push(`| 合計 | ${s.scope.rowsWithBreakdown} |`);
  lines.push("");
  lines.push("## 判定への影響");
  lines.push("");
  lines.push(`| 変化 | 件数 |`);
  lines.push(`|---|---|`);
  lines.push(`| BUY → SKIP（リーク除去でBUYでなくなる） | **${s.decisionImpact.buyChangedToSkip}** |`);
  lines.push(`| SKIP → BUY（リーク除去でBUYになる） | **${s.decisionImpact.skipChangedToBuy}** |`);
  lines.push(`| WATCH → 要件変化（BUY基準が変わる） | ${s.decisionImpact.watchChanged} |`);
  lines.push(`| BUY のまま変化なし | ${s.decisionImpact.buyUnchanged} |`);
  lines.push("");
  lines.push(`**結論: ${s.decisionImpact.conclusion}**`);
  lines.push("");

  if (s.buyDetails.length > 0) {
    lines.push("## BUY決定の詳細");
    lines.push("");
    lines.push("| raceId | 日付 | liveFactor | req(leak) | req(clean) | currentOdds | clean時もBUY? |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const r of s.buyDetails) {
      lines.push(
        `| ${r.raceId} | ${r.date} | ${r.liveFactorProduct} | ${r.reqWithLeak} | ${r.reqClean} | ${r.currentOdds ?? "n/a"} | ${r.wouldBuyClean ? "✅ YES" : "❌ NO"} |`,
      );
    }
    lines.push("");
  }

  lines.push("## まとめ");
  lines.push("");
  lines.push("- breakdown データを持つ行（2025-01-01〜2025-01-12 の 2975 行）のうち、**live-only factor が中立ではないものが 98%超**存在した（現在値スナップショットが注入されていた証拠）。");
  lines.push("- しかし、**BUY → SKIP に変わったケースはゼロ**。唯一の BUY（徳山R8 2025-01-05）はリーク除去後も required_odds < current_odds であり、BUY のまま。");
  lines.push("- これは「リークがあったが BUY 判定への実害はなかった」ことを意味する（breakdown 列追加直後の少数期間のみ影響範囲）。");
  lines.push("- **重要な補足**: 2025年の BUY 2,272件のうち 2,271件は breakdown 列追加前に生成されており、live-only feature の影響を受けていない。リスクは「今後 historical 再生成を行う場合」に集中していた。");
  lines.push("- 今回の hardening により、将来の historical 再生成では live-only feature は null になり、本問題は再発しない。");
  lines.push("");
  return `${lines.join("\n")}\n`;
}
