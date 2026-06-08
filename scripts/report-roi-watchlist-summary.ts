/**
 * ROI watchlist サマリーレポート
 *
 * reports/roi-watchlist.json を入力として、
 * 日次/週次レビュー用の短い一覧を生成する。
 *
 * これは採用判断ではなくレビュー優先順位のまとめ。
 * forward n<30 は参考値。
 *
 * 読み取り専用。DB書き込みなし。
 *
 * usage:
 *   pnpm report:roi-watchlist-summary
 */

import { readFileSync, writeFileSync } from "node:fs";

const INPUT_JSON = "reports/roi-watchlist.json";
const REPORT_MD = "reports/roi-watchlist-summary.md";
const REPORT_JSON = "reports/roi-watchlist-summary.json";

const TOP_N = 5;
const FWD_N_WARN = 30; // forward n小 警告ライン

// ── 型定義 ────────────────────────────────────────────────────────────────

type WatchEntry = {
  condition: string;
  dims: string;
  dimCount: number;
  historicalN: number;
  historicalHits: number;
  historicalRoi: number;
  forwardN: number;
  forwardHits: number;
  forwardRoi: number;
  maxConsecLosses: number;
  maxCalendarGapDays: number;
  histAvgOdds: number;
  fwdAvgOdds: number;
  riskNote: string;
  duplicateNote: string;
  priority: string;
  pattern: string;
};

type WatchlistReport = {
  generatedAt: string;
  sourceGeneratedAt: string;
  forwardStart: string;
  catA: WatchEntry[];
  catB: WatchEntry[];
  catC: WatchEntry[];
  catDHigh: WatchEntry[];
  catDMid: WatchEntry[];
  catDLow: WatchEntry[];
};

type SummaryEntry = {
  condition: string;
  dims: string;
  historicalN: number;
  historicalRoi: number;
  forwardN: number;
  forwardRoi: number;
  roiDiff: number;
  maxConsecLosses: number;
  maxCalendarGapDays: number;
  riskNote: string;
  duplicateNote: string;
  note: string;
};

type SummaryReport = {
  generatedAt: string;
  sourceGeneratedAt: string;
  forwardStart: string;
  counts: {
    cleanStrong: number;
    riskAdjustedWatch: number;
    weakPattern: number;
    forwardHigh: number;
    forwardMid: number;
    forwardLow: number;
  };
  topForwardN: SummaryEntry[];       // forwardN が最も多い上位5件
  topRoiDrop: SummaryEntry[];        // forward ROI が historical ROI より悪化している上位5件
  topWeakStreak: SummaryEntry[];     // weak のうち maxStreak が大きい上位5件
};

// ── ヘルパー ──────────────────────────────────────────────────────────────

function f1(n: number): string {
  return n.toFixed(1);
}

function roiDiffLabel(diff: number, fwdN: number): string {
  const sign = diff >= 0 ? "+" : "";
  const small = fwdN < FWD_N_WARN ? "*(n小)*" : "";
  return `${sign}${f1(diff)}%${small}`;
}

function gapDaysStr(n: number): string {
  return n < 0 ? "—" : String(n);
}

function toSummary(e: WatchEntry, note = ""): SummaryEntry {
  return {
    condition: e.condition,
    dims: e.dims,
    historicalN: e.historicalN,
    historicalRoi: e.historicalRoi,
    forwardN: e.forwardN,
    forwardRoi: e.forwardRoi,
    roiDiff: e.forwardRoi - e.historicalRoi,
    maxConsecLosses: e.maxConsecLosses,
    maxCalendarGapDays: e.maxCalendarGapDays,
    riskNote: e.riskNote,
    duplicateNote: e.duplicateNote,
    note,
  };
}

// ── 集計 ─────────────────────────────────────────────────────────────────

function buildSummary(src: WatchlistReport): SummaryReport {
  const allD = [...src.catDHigh, ...src.catDMid, ...src.catDLow];

  // forwardN 上位
  const topForwardN = [...allD]
    .sort((a, b) => b.forwardN - a.forwardN || b.historicalRoi - a.historicalRoi)
    .slice(0, TOP_N)
    .map((e) => toSummary(e));

  // forward ROI 悪化上位 (roiDiff = forwardRoi - historicalRoi の最小順)
  // forwardN>0 のものだけ対象
  const topRoiDrop = [...allD]
    .filter((e) => e.forwardN > 0)
    .sort((a, b) => (a.forwardRoi - a.historicalRoi) - (b.forwardRoi - b.historicalRoi))
    .slice(0, TOP_N)
    .map((e) => toSummary(e));

  // weak 上位 (maxStreak 降順)
  const topWeakStreak = [...src.catC]
    .sort((a, b) => b.maxConsecLosses - a.maxConsecLosses)
    .slice(0, TOP_N)
    .map((e) => toSummary(e));

  return {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: src.generatedAt,
    forwardStart: src.forwardStart,
    counts: {
      cleanStrong: src.catA.length,
      riskAdjustedWatch: src.catB.length,
      weakPattern: src.catC.length,
      forwardHigh: src.catDHigh.length,
      forwardMid: src.catDMid.length,
      forwardLow: src.catDLow.length,
    },
    topForwardN,
    topRoiDrop,
    topWeakStreak,
  };
}

// ── Markdown生成 ──────────────────────────────────────────────────────────

function generateMarkdown(r: SummaryReport): string {
  const lines: string[] = [
    "# ROI watchlist サマリー",
    "",
    `生成日時: ${r.generatedAt}`,
    `入力レポート生成日時: ${r.sourceGeneratedAt}`,
    `forward期間: ${r.forwardStart} 以降`,
    "",
    "> ⚠️ **これは採用判断ではなくレビュー優先順位のまとめ。**",
    "> forward n<30 は参考値であり、判断の根拠にならない。",
    "> 各件数はフル watchlist (`reports/roi-watchlist.md`) を参照。",
    "",
  ];

  // ── カウント ──────────────────────────────────────────────────────────
  const c = r.counts;
  const totalD = c.forwardHigh + c.forwardMid + c.forwardLow;
  lines.push(
    "## 件数サマリー",
    "",
    "| カテゴリ | 件数 |",
    "|---|---:|",
    `| A. clean historical strong | ${c.cleanStrong} |`,
    `| B. risk-adjusted watch | ${c.riskAdjustedWatch} |`,
    `| C. weak historical pattern | ${c.weakPattern} |`,
    `| D. forward確認待ち (計) | ${totalD} |`,
    `|   うち HIGH | ${c.forwardHigh} |`,
    `|   うち MID | ${c.forwardMid} |`,
    `|   うち LOW | ${c.forwardLow} |`,
    ""
  );

  // ── forward進捗上位 ────────────────────────────────────────────────────
  lines.push(
    "## 1. forwardN 上位 (最も実績が積まれている)",
    "",
    "> forward n<30 のため、まだ判断不可。蓄積状況の確認用。",
    "",
    "| 条件 | 組み合わせ | hist_n | hist_ROI | fwd_n | fwd_ROI | ROI差(参考) | riskNote |",
    "|---|---|---:|---:|---:|---:|---:|---|",
  );
  for (const e of r.topForwardN) {
    const diff = roiDiffLabel(e.roiDiff, e.forwardN);
    const fwdRoi = `${f1(e.forwardRoi)}%${e.forwardN < FWD_N_WARN ? "*(n小)*" : ""}`;
    lines.push(
      `| ${e.condition} | ${e.dims} | ${e.historicalN} | ${f1(e.historicalRoi)}% | ${e.forwardN} | ${fwdRoi} | ${diff} | ${e.riskNote} |`
    );
  }
  lines.push("");

  // ── ROI悪化上位 ────────────────────────────────────────────────────────
  lines.push(
    "## 2. forward ROI 悪化上位 (historicalと比べ最も下がっている)",
    "",
    "> ROI差(参考) = forwardROI − historicalROI。forward n小で不安定。",
    "",
    "| 条件 | 組み合わせ | hist_n | hist_ROI | fwd_n | fwd_ROI | ROI差(参考) | riskNote |",
    "|---|---|---:|---:|---:|---:|---:|---|",
  );
  for (const e of r.topRoiDrop) {
    const diff = roiDiffLabel(e.roiDiff, e.forwardN);
    const fwdRoi = `${f1(e.forwardRoi)}%${e.forwardN < FWD_N_WARN ? "*(n小)*" : ""}`;
    lines.push(
      `| ${e.condition} | ${e.dims} | ${e.historicalN} | ${f1(e.historicalRoi)}% | ${e.forwardN} | ${fwdRoi} | ${diff} | ${e.riskNote} |`
    );
  }
  lines.push("");

  // ── weak 高リスク上位 ─────────────────────────────────────────────────
  lines.push(
    "## 3. weak historical pattern 高連敗上位 (除外根拠確認用)",
    "",
    "> historical ROI<100%。maxStreak が大きいほど長期連敗リスクが高い。",
    "",
    "| 条件 | 組み合わせ | hist_n | hist_ROI | maxStreak | maxGapDays | fwd_n | fwd_ROI |",
    "|---|---|---:|---:|---:|---:|---:|---:|",
  );
  for (const e of r.topWeakStreak) {
    const fwdRoi = `${f1(e.forwardRoi)}%${e.forwardN > 0 && e.forwardN < FWD_N_WARN ? "*(n小)*" : ""}`;
    lines.push(
      `| ${e.condition} | ${e.dims} | ${e.historicalN} | ${f1(e.historicalRoi)}% | ${e.maxConsecLosses} | ${gapDaysStr(e.maxCalendarGapDays)} | ${e.forwardN} | ${fwdRoi} |`
    );
  }
  lines.push("");

  lines.push(
    "---",
    "",
    `詳細: [roi-watchlist.md](roi-watchlist.md)`,
    ""
  );

  return lines.join("\n");
}

// ── 実行 ─────────────────────────────────────────────────────────────────

const src: WatchlistReport = JSON.parse(readFileSync(INPUT_JSON, "utf8"));
const summary = buildSummary(src);
const md = generateMarkdown(summary);

writeFileSync(REPORT_MD, md, "utf8");
writeFileSync(REPORT_JSON, JSON.stringify(summary, null, 2), "utf8");

console.log(md);
console.log(`\n→ ${REPORT_MD}`);
console.log(`→ ${REPORT_JSON}`);
