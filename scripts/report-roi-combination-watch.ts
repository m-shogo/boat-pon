/**
 * ROI条件組み合わせ監視レポート
 *
 * paper_roi_candidates (current_odds基準) を使い、isBase / wind5 の中で
 * 2条件・3条件の組み合わせROIを検証する。
 *
 * 判定ラベルは historical データ上の傾向を示すだけで、BUY設定採用可否ではない。
 * - n<30: insufficient data
 * - n>=30, ROI>=150%, hits>=3: strong historical pattern
 * - n>=30, ROI<100%: weak historical pattern
 * - それ以外: watch
 *
 * 読み取り専用。DB書き込みなし。
 *
 * usage:
 *   pnpm report:roi-combination-watch
 */

import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = "data/boat.sqlite";
const FORWARD_START = "2025-08-09";
const REPORT_MD = "reports/roi-combination-watch.md";
const REPORT_JSON = "reports/roi-combination-watch.json";

const COND_ISBASE = "seasonal_parts0_month_4_6_8_12";
const COND_WIND5 = "seasonal_parts0_month_4_6_8_12_wind5";

const N_MIN_JUDGE = 30;
const N_MIN_SHOW_MD = 10;    // markdown に出す最低 n (historical)
const ROI_STRONG = 150;
const ROI_WEAK = 100;
const HITS_MIN_STRONG = 3;

// ── 型定義 ────────────────────────────────────────────────────────────────

type DimName = "month" | "raceNoBand" | "windBand" | "oddsBand" | "exStBand";
type Pattern =
  | "strong historical pattern"
  | "watch"
  | "weak historical pattern"
  | "insufficient data";

type RawRecord = {
  date: string;
  hit: number;
  current_odds: number;
  month: string;
  raceNoBand: string;
  windBand: string;
  oddsBand: string;
  exStBand: string;
};

type ComboStat = {
  condition: string;
  dims: string;
  dimCount: 2 | 3;
  n: number;
  hits: number;
  hitRate: number;
  avgOdds: number;
  roi: number;
  maxConsecLosses: number;
  maxHitGap: number;
  historicalN: number;
  historicalHits: number;
  historicalRoi: number;
  forwardN: number;
  forwardHits: number;
  forwardRoi: number;
  pattern: Pattern;
};

type Report = {
  generatedAt: string;
  forwardStart: string;
  note: string;
  isBase: {
    twoDim: ComboStat[];
    threeDim: ComboStat[];
  };
  wind5: {
    twoDim: ComboStat[];
    threeDim: ComboStat[];
  };
};

// ── 次元定義 ──────────────────────────────────────────────────────────────

const DIMS: DimName[] = ["month", "raceNoBand", "windBand", "oddsBand", "exStBand"];

const DIM_DISPLAY: Record<DimName, string> = {
  month: "月",
  raceNoBand: "race_no",
  windBand: "wind",
  oddsBand: "odds",
  exStBand: "ex_st",
};

const DIM_VALUES: Record<DimName, string[]> = {
  month: ["04月", "06月", "08月", "12月"],
  raceNoBand: ["R1-3", "R4-6", "R7-9"],
  windBand: ["3.0-4.9m", "5.0-6.9m", ">=7.0m"],
  oddsBand: ["<30", "30-40", "40-50", "50-60", ">=60"],
  exStBand: ["<0.10", ">=0.15"],
};

function getDimVal(r: RawRecord, dim: DimName): string {
  return r[dim === "raceNoBand" ? "raceNoBand" : dim];
}

// ── DB読み込み ─────────────────────────────────────────────────────────────

function loadRecords(db: DatabaseSync, condName: string): RawRecord[] {
  return db
    .prepare(
      `
    SELECT
      date, hit, current_odds,
      CASE strftime('%m', date)
        WHEN '04' THEN '04月'
        WHEN '06' THEN '06月'
        WHEN '08' THEN '08月'
        WHEN '12' THEN '12月'
        ELSE 'other'
      END AS month,
      CASE
        WHEN race_no BETWEEN 1 AND 3 THEN 'R1-3'
        WHEN race_no BETWEEN 4 AND 6 THEN 'R4-6'
        ELSE 'R7-9'
      END AS raceNoBand,
      CASE
        WHEN wind_mps < 5.0 THEN '3.0-4.9m'
        WHEN wind_mps < 7.0 THEN '5.0-6.9m'
        ELSE '>=7.0m'
      END AS windBand,
      CASE
        WHEN current_odds < 30 THEN '<30'
        WHEN current_odds < 40 THEN '30-40'
        WHEN current_odds < 50 THEN '40-50'
        WHEN current_odds < 60 THEN '50-60'
        ELSE '>=60'
      END AS oddsBand,
      CASE
        WHEN ex_st < 0.10 THEN '<0.10'
        ELSE '>=0.15'
      END AS exStBand
    FROM paper_roi_candidates
    WHERE condition_name = ?
    ORDER BY date
  `
    )
    .all(condName) as RawRecord[];
}

// ── 統計計算 ──────────────────────────────────────────────────────────────

function roi(sumOdds: number, n: number): number {
  if (n === 0) return 0;
  return Math.round((sumOdds / n) * 100 * 10) / 10;
}

function maxConsecLosses(records: RawRecord[]): number {
  let max = 0,
    cur = 0;
  for (const r of records) {
    if (r.hit === 0) {
      cur++;
      if (cur > max) max = cur;
    } else {
      cur = 0;
    }
  }
  return max;
}

function maxHitGap(records: RawRecord[]): number {
  if (records.length === 0) return 0;
  const hitIdx: number[] = [];
  records.forEach((r, i) => {
    if (r.hit === 1) hitIdx.push(i);
  });
  if (hitIdx.length === 0) return records.length;
  let max = hitIdx[0]; // gap before first hit
  for (let i = 1; i < hitIdx.length; i++) {
    const gap = hitIdx[i] - hitIdx[i - 1] - 1;
    if (gap > max) max = gap;
  }
  const tailGap = records.length - 1 - hitIdx[hitIdx.length - 1];
  if (tailGap > max) max = tailGap;
  return max;
}

function classifyPattern(historicalN: number, historicalHits: number, historicalRoi: number): Pattern {
  if (historicalN < N_MIN_JUDGE) return "insufficient data";
  if (historicalRoi < ROI_WEAK) return "weak historical pattern";
  if (historicalRoi >= ROI_STRONG && historicalHits >= HITS_MIN_STRONG) return "strong historical pattern";
  return "watch";
}

function computeCombo(
  allRecords: RawRecord[],
  condLabel: string,
  dimNames: DimName[],
  dimValues: string[]
): ComboStat {
  const filtered = allRecords.filter((r) =>
    dimNames.every((d, i) => getDimVal(r, d) === dimValues[i])
  );
  const hist = filtered.filter((r) => r.date < FORWARD_START);
  const fwd = filtered.filter((r) => r.date >= FORWARD_START);

  const n = filtered.length;
  const hits = filtered.reduce((s, r) => s + r.hit, 0);
  const sumOddsAll = filtered.reduce((s, r) => s + r.hit * r.current_odds, 0);

  const histN = hist.length;
  const histHits = hist.reduce((s, r) => s + r.hit, 0);
  const histSumOdds = hist.reduce((s, r) => s + r.hit * r.current_odds, 0);

  const fwdN = fwd.length;
  const fwdHits = fwd.reduce((s, r) => s + r.hit, 0);
  const fwdSumOdds = fwd.reduce((s, r) => s + r.hit * r.current_odds, 0);

  const histRoi = roi(histSumOdds, histN);
  const fwdRoi = roi(fwdSumOdds, fwdN);
  const roiAll = roi(sumOddsAll, n);

  const avgOdds =
    n > 0
      ? Math.round((filtered.reduce((s, r) => s + r.current_odds, 0) / n) * 10) / 10
      : 0;

  const dimsLabel = dimValues.join(" × ");

  return {
    condition: condLabel,
    dims: dimsLabel,
    dimCount: dimNames.length as 2 | 3,
    n,
    hits,
    hitRate: n > 0 ? Math.round((hits / n) * 100 * 10) / 10 : 0,
    avgOdds,
    roi: roiAll,
    maxConsecLosses: maxConsecLosses(hist),
    maxHitGap: maxHitGap(hist),
    historicalN: histN,
    historicalHits: histHits,
    historicalRoi: histRoi,
    forwardN: fwdN,
    forwardHits: fwdHits,
    forwardRoi: fwdRoi,
    pattern: classifyPattern(histN, histHits, histRoi),
  };
}

// ── 組み合わせ生成 ────────────────────────────────────────────────────────

function generateCombos(
  records: RawRecord[],
  condLabel: string,
  ncols: 2 | 3
): ComboStat[] {
  const results: ComboStat[] = [];

  if (ncols === 2) {
    for (let i = 0; i < DIMS.length; i++) {
      for (let j = i + 1; j < DIMS.length; j++) {
        const dA = DIMS[i],
          dB = DIMS[j];
        for (const vA of DIM_VALUES[dA]) {
          for (const vB of DIM_VALUES[dB]) {
            const stat = computeCombo(records, condLabel, [dA, dB], [vA, vB]);
            if (stat.historicalN >= 1) results.push(stat);
          }
        }
      }
    }
  } else {
    for (let i = 0; i < DIMS.length; i++) {
      for (let j = i + 1; j < DIMS.length; j++) {
        for (let k = j + 1; k < DIMS.length; k++) {
          const dA = DIMS[i],
            dB = DIMS[j],
            dC = DIMS[k];
          for (const vA of DIM_VALUES[dA]) {
            for (const vB of DIM_VALUES[dB]) {
              for (const vC of DIM_VALUES[dC]) {
                const stat = computeCombo(records, condLabel, [dA, dB, dC], [vA, vB, vC]);
                if (stat.historicalN >= 1) results.push(stat);
              }
            }
          }
        }
      }
    }
  }

  return results.sort((a, b) => {
    // sort: strong first, then by historicalRoi desc
    const po: Record<Pattern, number> = {
      "strong historical pattern": 0,
      watch: 1,
      "weak historical pattern": 2,
      "insufficient data": 3,
    };
    const pd = po[a.pattern] - po[b.pattern];
    if (pd !== 0) return pd;
    return b.historicalRoi - a.historicalRoi;
  });
}

// ── メイン ────────────────────────────────────────────────────────────────

function run(): Report {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  db.exec("PRAGMA busy_timeout = 5000");

  try {
    const isBaseRecords = loadRecords(db, COND_ISBASE);
    const wind5Records = loadRecords(db, COND_WIND5);
    db.close();

    return {
      generatedAt: new Date().toISOString(),
      forwardStart: FORWARD_START,
      note:
        "判定ラベルは historical データ上の傾向を示すだけで BUY設定採用可否ではない。" +
        "forward n が小さいため forward ROI は参考値。",
      isBase: {
        twoDim: generateCombos(isBaseRecords, "isBase", 2),
        threeDim: generateCombos(isBaseRecords, "isBase", 3),
      },
      wind5: {
        twoDim: generateCombos(wind5Records, "wind5", 2),
        threeDim: generateCombos(wind5Records, "wind5", 3),
      },
    };
  } catch (e) {
    db.close();
    throw e;
  }
}

// ── Markdown生成 ──────────────────────────────────────────────────────────

const PATTERN_ICON: Record<Pattern, string> = {
  "strong historical pattern": "🟢",
  watch: "🟡",
  "weak historical pattern": "🔴",
  "insufficient data": "⚪",
};

function f1(n: number): string {
  return n.toFixed(1);
}

function comboTableRows(combos: ComboStat[], minN: number): string[] {
  const visible = combos.filter((c) => c.historicalN >= minN);
  if (visible.length === 0) return ["該当なし (n>=10 のものなし)"];

  const lines: string[] = [
    "| 組み合わせ | hist_n | hist_hit | hist_ROI | fwd_n | fwd_hit | fwd_ROI | avgOdds | maxStreak | maxGap | 判定 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  ];

  for (const c of visible) {
    const icon = PATTERN_ICON[c.pattern];
    const fwdNote = c.forwardN < 5 ? "*(n小)*" : "";
    lines.push(
      `| ${c.dims} | ${c.historicalN} | ${c.historicalHits} | ${f1(c.historicalRoi)}% | ${c.forwardN} | ${c.forwardHits} | ${f1(c.forwardRoi)}%${fwdNote} | ${f1(c.avgOdds)} | ${c.maxConsecLosses} | ${c.maxHitGap} | ${icon} ${c.pattern} |`
    );
  }
  return lines;
}

function patternSection(combos: ComboStat[], pattern: Pattern, minN: number): string[] {
  const filtered = combos.filter((c) => c.pattern === pattern && c.historicalN >= minN);
  const lines: string[] = [
    `### ${PATTERN_ICON[pattern]} ${pattern} (n>=${minN})`,
    "",
  ];
  if (filtered.length === 0) {
    lines.push("該当なし");
    lines.push("");
    return lines;
  }
  lines.push(
    "| 組み合わせ | hist_n | hist_hit | hist_ROI | fwd_n | fwd_hit | fwd_ROI | avgOdds | maxStreak | maxGap |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
  );
  for (const c of filtered) {
    const fwdNote = c.forwardN > 0 && c.forwardN < 5 ? "*(n小)*" : "";
    lines.push(
      `| ${c.dims} | ${c.historicalN} | ${c.historicalHits} | ${f1(c.historicalRoi)}% | ${c.forwardN} | ${c.forwardHits} | ${f1(c.forwardRoi)}%${fwdNote} | ${f1(c.avgOdds)} | ${c.maxConsecLosses} | ${c.maxHitGap} |`
    );
  }
  lines.push("");
  return lines;
}

function condSection(
  condLabel: string,
  twoDim: ComboStat[],
  threeDim: ComboStat[]
): string[] {
  const lines: string[] = [`## ${condLabel}`, ""];

  const judgeNote =
    "> ⚠️ 判定ラベルは historical 傾向のみ。BUY採用には forward n>=30 の蓄積と追加検証が必要。\n" +
    "> maxStreak: historical 最大連敗数。maxGap: historical hit間の最大レース間隔。";
  lines.push(judgeNote, "");

  for (const ncols of [2, 3] as const) {
    const combos = ncols === 2 ? twoDim : threeDim;
    const minN = ncols === 2 ? N_MIN_SHOW_MD : N_MIN_SHOW_MD;

    lines.push(`### ${condLabel} / ${ncols}条件組み合わせ`, "");

    const total = combos.length;
    const judgeCount = combos.filter((c) => c.historicalN >= N_MIN_JUDGE).length;
    const strongCount = combos.filter((c) => c.pattern === "strong historical pattern").length;
    const weakCount = combos.filter((c) => c.pattern === "weak historical pattern").length;

    lines.push(
      `組み合わせ総数: ${total}  /  判定可能(n>=${N_MIN_JUDGE}): ${judgeCount}  /  strong: ${strongCount}  /  weak: ${weakCount}`,
      ""
    );

    for (const p of [
      "strong historical pattern",
      "watch",
      "weak historical pattern",
    ] as Pattern[]) {
      lines.push(...patternSection(combos, p, minN));
    }

    // insufficient data summary (count only)
    const insuf = combos.filter(
      (c) => c.pattern === "insufficient data" && c.historicalN >= minN
    ).length;
    if (insuf > 0) {
      lines.push(
        `> ⚪ insufficient data (n>=${minN}) : ${insuf} 件 — n<${N_MIN_JUDGE} のため判断不可`,
        ""
      );
    }
  }

  return lines;
}

function generateMarkdown(r: Report): string {
  const lines: string[] = [
    "# ROI条件組み合わせ監視レポート",
    "",
    `生成日時: ${r.generatedAt}`,
    `forward期間: ${r.forwardStart} 以降`,
    "",
    "> ROIはすべて current_odds 基準。",
    "> **判定ラベルは historical データ上の傾向を示すだけで BUY設定採用可否ではない。**",
    "> forward n が小さい場合は参考扱い。n<30 は insufficient data。",
    "",
  ];

  lines.push(...condSection("isBase", r.isBase.twoDim, r.isBase.threeDim));
  lines.push(...condSection("wind5", r.wind5.twoDim, r.wind5.threeDim));

  return lines.join("\n");
}

// ── 実行 ─────────────────────────────────────────────────────────────────

const report = run();
const md = generateMarkdown(report);
writeFileSync(REPORT_MD, md, "utf8");
writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");

console.log(md);
console.log(`\n→ ${REPORT_MD}`);
console.log(`→ ${REPORT_JSON}`);
