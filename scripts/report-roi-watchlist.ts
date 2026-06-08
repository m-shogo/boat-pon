/**
 * ROI監視候補 watchlist レポート
 *
 * reports/roi-combination-watch.json を入力として、
 * 4カテゴリの監視候補を抽出する。
 *
 * これは BUY設定採用リストではない。
 * forward n<30 は参考値。
 * clean strong でも forward未検証なら採用不可。
 * 目的は今後の監視対象を固定すること。
 *
 * 読み取り専用。DB書き込みなし。
 *
 * usage:
 *   pnpm report:roi-watchlist
 */

import { readFileSync, writeFileSync } from "node:fs";

const INPUT_JSON = "reports/roi-combination-watch.json";
const REPORT_MD = "reports/roi-watchlist.md";
const REPORT_JSON = "reports/roi-watchlist.json";

const N_MIN_SHOW = 50;
const ROI_STRONG = 150;
const HITS_MIN_STRONG = 5;
const ROI_WATCH_MIN = 100;
const FWD_N_MAX = 30;    // forward 確認待ちの上限
const FWD_N_HIGH = 10;   // HIGH priority の forwardN 閾値
const FWD_N_MID = 5;     // MID priority の forwardN 閾値
const N_BOOST = 100;     // priority を1段上げる historicalN 閾値
const MAX_RISK_ROWS = 20;
const MAX_WEAK_ROWS = 20;

// ── 型定義 ────────────────────────────────────────────────────────────────

type Pattern =
  | "strong historical pattern"
  | "watch"
  | "weak historical pattern"
  | "insufficient data";

type Priority = "HIGH" | "MID" | "LOW";

type ComboStat = {
  condition: string;
  dims: string;
  dimCount: number;
  n: number;
  hits: number;
  hitRate: number;
  histAvgOdds: number;
  fwdAvgOdds: number;
  roi: number;
  maxConsecLosses: number;
  maxHitGapRaces: number;
  maxCalendarGapDays: number;
  historicalN: number;
  historicalHits: number;
  historicalRoi: number;
  forwardN: number;
  forwardHits: number;
  forwardRoi: number;
  pattern: Pattern;
  riskNote: string;
};

type CombinationReport = {
  generatedAt: string;
  forwardStart: string;
  note: string;
  isBase: { twoDim: ComboStat[]; threeDim: ComboStat[] };
  wind5: { twoDim: ComboStat[]; threeDim: ComboStat[] };
};

type WatchEntry = ComboStat & {
  sourceFile: string;
  duplicateNote: string; // "重複: isBase/wind5" or ""
  priority: Priority;    // catD でのみ意味を持つ
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

// ── 重複検出 ──────────────────────────────────────────────────────────────

// isBase と wind5 の両方に同じ dims が存在するものを重複とみなす
function buildDuplicateDimsSet(src: CombinationReport): Set<string> {
  const isBaseDims = new Set([
    ...src.isBase.twoDim.map((c) => c.dims),
    ...src.isBase.threeDim.map((c) => c.dims),
  ]);
  const wind5Dims = new Set([
    ...src.wind5.twoDim.map((c) => c.dims),
    ...src.wind5.threeDim.map((c) => c.dims),
  ]);
  const dup = new Set<string>();
  for (const d of isBaseDims) {
    if (wind5Dims.has(d)) dup.add(d);
  }
  return dup;
}

// ── priority 計算 ─────────────────────────────────────────────────────────

function computePriority(entry: ComboStat): Priority {
  const base: Priority =
    entry.forwardN >= FWD_N_HIGH ? "HIGH" :
    entry.forwardN >= FWD_N_MID  ? "MID"  : "LOW";
  if (base === "HIGH") return "HIGH";
  // historicalN >= 100 または riskNote あり → 1段上げ
  const boost = entry.historicalN >= N_BOOST || entry.riskNote !== "";
  if (boost) return base === "LOW" ? "MID" : "HIGH";
  return base;
}

// ── データ収集 ────────────────────────────────────────────────────────────

function allEntries(src: CombinationReport): WatchEntry[] {
  const dupSet = buildDuplicateDimsSet(src);
  const groups: ComboStat[][] = [
    src.isBase.twoDim,
    src.isBase.threeDim,
    src.wind5.twoDim,
    src.wind5.threeDim,
  ];
  return groups.flatMap((arr) =>
    arr.map((c) => ({
      ...c,
      sourceFile: INPUT_JSON,
      duplicateNote: dupSet.has(c.dims) ? "重複: isBase/wind5" : "",
      priority: computePriority(c),
    }))
  );
}

// ── カテゴリ抽出 ──────────────────────────────────────────────────────────

function buildCatA(entries: WatchEntry[]): WatchEntry[] {
  return entries
    .filter(
      (c) =>
        c.pattern === "strong historical pattern" &&
        c.riskNote === "" &&
        c.historicalN >= N_MIN_SHOW &&
        c.historicalHits >= HITS_MIN_STRONG &&
        c.historicalRoi >= ROI_STRONG
    )
    .sort((a, b) => b.historicalRoi - a.historicalRoi);
}

function buildCatB(entries: WatchEntry[]): WatchEntry[] {
  return entries
    .filter(
      (c) =>
        c.pattern === "strong historical pattern" &&
        c.riskNote !== ""
    )
    .sort((a, b) => b.historicalRoi - a.historicalRoi)
    .slice(0, MAX_RISK_ROWS);
}

function buildCatC(entries: WatchEntry[]): WatchEntry[] {
  return entries
    .filter(
      (c) =>
        c.pattern === "weak historical pattern" &&
        c.historicalN >= N_MIN_SHOW &&
        c.historicalRoi < ROI_WATCH_MIN
    )
    .sort((a, b) => {
      const riskA = Math.max(a.maxConsecLosses, a.maxCalendarGapDays < 0 ? 0 : a.maxCalendarGapDays);
      const riskB = Math.max(b.maxConsecLosses, b.maxCalendarGapDays < 0 ? 0 : b.maxCalendarGapDays);
      return riskB - riskA;
    })
    .slice(0, MAX_WEAK_ROWS);
}

function catDSort(entries: WatchEntry[]): WatchEntry[] {
  return [...entries].sort(
    (a, b) => b.forwardN - a.forwardN || b.historicalRoi - a.historicalRoi
  );
}

function buildCatD(entries: WatchEntry[]): {
  high: WatchEntry[];
  mid: WatchEntry[];
  low: WatchEntry[];
} {
  const pool = entries.filter(
    (c) =>
      c.forwardN > 0 &&
      c.forwardN < FWD_N_MAX &&
      c.historicalN >= N_MIN_SHOW &&
      c.historicalRoi >= ROI_WATCH_MIN
  );
  return {
    high: catDSort(pool.filter((c) => c.priority === "HIGH")),
    mid:  catDSort(pool.filter((c) => c.priority === "MID")),
    low:  catDSort(pool.filter((c) => c.priority === "LOW")),
  };
}

// ── Markdown生成 ──────────────────────────────────────────────────────────

function f1(n: number): string {
  return n.toFixed(1);
}

function fwdRoiCell(c: WatchEntry): string {
  const note = c.forwardN > 0 && c.forwardN < FWD_N_MAX ? "*(n小)*" : "";
  return `${f1(c.forwardRoi)}%${note}`;
}

function gapDaysStr(c: WatchEntry): string {
  return c.maxCalendarGapDays < 0 ? "—" : String(c.maxCalendarGapDays);
}

function fwdAvgStr(c: WatchEntry): string {
  return c.forwardN > 0 ? f1(c.fwdAvgOdds) : "—";
}

// ROI差 (参考): forwardN小のため強く見えすぎないよう "(参考)" 付き列名を使う
function roiDiffStr(c: WatchEntry): string {
  if (c.forwardN === 0) return "—";
  const diff = c.forwardRoi - c.historicalRoi;
  return (diff >= 0 ? "+" : "") + f1(diff) + "%";
}

// 標準テーブルヘッダー (Cat A/B 用)
const STD_HEADER = [
  "| 条件 | 組み合わせ | hist_n | hist_hit | hist_ROI | fwd_n | fwd_hit | fwd_ROI | hist_avg | fwd_avg | maxStreak | maxGapDays | riskNote | 重複 |",
  "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|",
];

function stdRow(c: WatchEntry): string {
  return (
    `| ${c.condition} | ${c.dims} | ${c.historicalN} | ${c.historicalHits} | ` +
    `${f1(c.historicalRoi)}% | ${c.forwardN} | ${c.forwardHits} | ${fwdRoiCell(c)} | ` +
    `${f1(c.histAvgOdds)} | ${fwdAvgStr(c)} | ${c.maxConsecLosses} | ${gapDaysStr(c)} | ${c.riskNote} | ${c.duplicateNote} |`
  );
}

// Cat D テーブルヘッダー (priority列 + ROI差(参考) 付き)
const CATD_HEADER = [
  "| 条件 | 組み合わせ | hist_n | hist_ROI | fwd_n | fwd_ROI | ROI差(参考) | hist_avg | fwd_avg | riskNote | 重複 |",
  "|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|",
];

function catDRow(c: WatchEntry): string {
  return (
    `| ${c.condition} | ${c.dims} | ${c.historicalN} | ${f1(c.historicalRoi)}% | ` +
    `${c.forwardN} | ${fwdRoiCell(c)} | ${roiDiffStr(c)} | ` +
    `${f1(c.histAvgOdds)} | ${fwdAvgStr(c)} | ${c.riskNote} | ${c.duplicateNote} |`
  );
}

function catDSection(label: string, entries: WatchEntry[]): string[] {
  const lines: string[] = [`### ${label}`, ""];
  if (entries.length === 0) {
    lines.push("該当なし", "");
    return lines;
  }
  lines.push(...CATD_HEADER);
  for (const c of entries) lines.push(catDRow(c));
  lines.push("");
  return lines;
}

function generateMarkdown(r: WatchlistReport, src: CombinationReport): string {
  const lines: string[] = [
    "# ROI監視候補 watchlist",
    "",
    `生成日時: ${r.generatedAt}`,
    `入力レポート生成日時: ${r.sourceGeneratedAt}`,
    `forward期間: ${r.forwardStart} 以降`,
    "",
    "> ⚠️ **これはBUY設定採用リストではない。**",
    "> forward n<30 は参考値であり、判断の根拠にならない。",
    "> clean strong でも forward未検証 (forwardN=0) なら採用不可。",
    "> 目的は今後の監視対象を固定することで、実績が積まれたときに見返すリスト。",
    "> forward確認待ち (D) は優先度順 (HIGH→MID→LOW) に並べている。",
    "> priority は採用判断ではなく、次回確認する順番。",
    "> 重複列: 同じ組み合わせが isBase/wind5 の両方で検出されている場合に表示。",
    "> ROIはすべて current_odds 基準。",
    "",
  ];

  // ── Cat A ──────────────────────────────────────────────────────────────
  lines.push(
    "## A. clean historical strong",
    "",
    `> pattern=strong, riskNote なし, hist n>=${N_MIN_SHOW}, hits>=${HITS_MIN_STRONG}, ROI>=${ROI_STRONG}%。`,
    "> リスク要因が検出されなかった strong のみ。それでも forward 未蓄積は参考扱い。",
    ""
  );
  if (r.catA.length === 0) {
    lines.push("該当なし", "");
  } else {
    lines.push(...STD_HEADER);
    for (const c of r.catA) lines.push(stdRow(c));
    lines.push("");
  }

  // ── Cat B ──────────────────────────────────────────────────────────────
  lines.push(
    "## B. risk-adjusted watch 上位",
    "",
    `> pattern=strong かつ riskNote あり。hist ROI 降順 上位${MAX_RISK_ROWS}件。`,
    "> riskNote 列にリスク要因を表示。forward 蓄積まで採用不可。",
    ""
  );
  if (r.catB.length === 0) {
    lines.push("該当なし", "");
  } else {
    lines.push(...STD_HEADER);
    for (const c of r.catB) lines.push(stdRow(c));
    lines.push("");
  }

  // ── Cat C ──────────────────────────────────────────────────────────────
  lines.push(
    "## C. weak historical pattern 上位 (高リスク確認用)",
    "",
    `> pattern=weak, hist n>=${N_MIN_SHOW}, hist ROI<${ROI_WATCH_MIN}%。`,
    "> maxStreak / maxGapDays が大きい順 (採用除外根拠の確認用)。",
    ""
  );
  if (r.catC.length === 0) {
    lines.push("該当なし", "");
  } else {
    lines.push(
      "| 条件 | 組み合わせ | hist_n | hist_ROI | maxStreak | maxGapDays | fwd_n | fwd_ROI | 重複 |",
      "|---|---|---:|---:|---:|---:|---:|---:|---|"
    );
    for (const c of r.catC) {
      lines.push(
        `| ${c.condition} | ${c.dims} | ${c.historicalN} | ${f1(c.historicalRoi)}% | ` +
        `${c.maxConsecLosses} | ${gapDaysStr(c)} | ${c.forwardN} | ${fwdRoiCell(c)} | ${c.duplicateNote} |`
      );
    }
    lines.push("");
  }

  // ── Cat D ──────────────────────────────────────────────────────────────
  const totalD = r.catDHigh.length + r.catDMid.length + r.catDLow.length;
  lines.push(
    "## D. forward確認待ち",
    "",
    `> forwardN 1–${FWD_N_MAX - 1}, hist n>=${N_MIN_SHOW}, hist ROI>=${ROI_WATCH_MIN}%。計${totalD}件。`,
    `> priority: HIGH (fwd n>=${FWD_N_HIGH} または n>=${N_BOOST}/riskNoteあり) → MID (fwd n>=${FWD_N_MID}) → LOW。`,
    "> ROI差(参考) = forwardROI − historicalROI。forward n<30 のため強く見えすぎる場合あり。",
    ""
  );

  lines.push(...catDSection(`D1. forward確認待ち HIGH (${r.catDHigh.length}件)`, r.catDHigh));
  lines.push(...catDSection(`D2. forward確認待ち MID (${r.catDMid.length}件)`, r.catDMid));
  lines.push(...catDSection(`D3. forward確認待ち LOW (${r.catDLow.length}件)`, r.catDLow));

  // ── フッター ───────────────────────────────────────────────────────────
  lines.push(
    "---",
    "",
    `入力: ${INPUT_JSON} (生成: ${src.generatedAt})`,
    `isBase 2dim: ${src.isBase.twoDim.length}件 / 3dim: ${src.isBase.threeDim.length}件`,
    `wind5 2dim: ${src.wind5.twoDim.length}件 / 3dim: ${src.wind5.threeDim.length}件`,
    ""
  );

  return lines.join("\n");
}

// ── 実行 ─────────────────────────────────────────────────────────────────

const src: CombinationReport = JSON.parse(readFileSync(INPUT_JSON, "utf8"));
const entries = allEntries(src);

const catA = buildCatA(entries);
const catB = buildCatB(entries);
const catC = buildCatC(entries);
const { high: catDHigh, mid: catDMid, low: catDLow } = buildCatD(entries);

const report: WatchlistReport = {
  generatedAt: new Date().toISOString(),
  sourceGeneratedAt: src.generatedAt,
  forwardStart: src.forwardStart,
  catA,
  catB,
  catC,
  catDHigh,
  catDMid,
  catDLow,
};

const md = generateMarkdown(report, src);
writeFileSync(REPORT_MD, md, "utf8");
writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");

console.log(md);
console.log(`\n→ ${REPORT_MD}`);
console.log(`→ ${REPORT_JSON}`);
