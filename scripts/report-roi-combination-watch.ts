/**
 * ROI条件組み合わせ監視レポート
 *
 * paper_roi_candidates (current_odds基準) を使い、isBase / wind5 の中で
 * 2条件・3条件の組み合わせROIを検証する。
 *
 * 判定ラベルは historical データ上の傾向を示すだけで、BUY設定採用可否ではない。
 * - insufficient data: historicalN < 30
 * - strong historical pattern: historicalN >= 50, hits >= 5, ROI >= 150%
 * - risk-adjusted watch: strong 判定だがリスク要因あり (maxStreak>50, maxGapDays>180,
 *     forwardN>0かつ<30, 3条件かつn<100 のいずれか)
 * - weak historical pattern: historicalN >= 30, ROI < 100%
 * - watch: それ以外 (n>=30)
 *
 * 3条件組み合わせは探索数が多く過剰適合リスクが高い。
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

const N_MIN_JUDGE = 30;       // insufficient data 判定下限
const N_MIN_STRONG = 50;      // strong pattern 最低 n
const N_STRONG_CAUTION = 100; // 3条件 strong でのリスク注意 n 閾値
const N_MIN_SHOW_MD = 10;     // markdown 表示最低 n (historical)
const ROI_STRONG = 150;
const ROI_WEAK = 100;
const HITS_MIN_STRONG = 5;
const RISK_MAX_STREAK = 50;       // これを超えると riskNote
const RISK_MAX_GAP_DAYS = 180;    // これを超えると riskNote

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
  histAvgOdds: number;
  fwdAvgOdds: number;
  roi: number;
  maxConsecLosses: number;
  maxHitGapRaces: number;     // hit間の最大外れ数 (filtered records内)
  maxCalendarGapDays: number; // hit間の最大日数
  historicalN: number;
  historicalHits: number;
  historicalRoi: number;
  forwardN: number;
  forwardHits: number;
  forwardRoi: number;
  pattern: Pattern;
  riskNote: string; // strong かつリスク要因ありの場合、理由を列挙
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

const DIM_VALUES: Record<DimName, string[]> = {
  month: ["04月", "06月", "08月", "12月"],
  raceNoBand: ["R1-3", "R4-6", "R7-9"],
  windBand: ["3.0-4.9m", "5.0-6.9m", ">=7.0m"],
  oddsBand: ["<30", "30-40", "40-50", "50-60", ">=60"],
  exStBand: ["<0.10", ">=0.15"],
};

function getDimVal(r: RawRecord, dim: DimName): string {
  return r[dim];
}

// ── DB読み込み ────────────────────────────────────────────────────────────

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
    ORDER BY date, race_no, race_id
  `
    )
    .all(condName) as RawRecord[];
}

// ── 統計計算 ──────────────────────────────────────────────────────────────

function roiCalc(sumOdds: number, n: number): number {
  if (n === 0) return 0;
  return Math.round((sumOdds / n) * 100 * 10) / 10;
}

function avgOddsCalc(records: RawRecord[]): number {
  if (records.length === 0) return 0;
  return Math.round((records.reduce((s, r) => s + r.current_odds, 0) / records.length) * 10) / 10;
}

function computeMaxConsecLosses(records: RawRecord[]): number {
  let max = 0, cur = 0;
  for (const r of records) {
    if (r.hit === 0) { cur++; if (cur > max) max = cur; }
    else cur = 0;
  }
  return max;
}

// hit間の最大外れ数 (filtered records 内)
function computeMaxHitGapRaces(records: RawRecord[]): number {
  if (records.length === 0) return 0;
  const hitIdx: number[] = [];
  records.forEach((r, i) => { if (r.hit === 1) hitIdx.push(i); });
  if (hitIdx.length === 0) return records.length;
  let max = hitIdx[0];
  for (let i = 1; i < hitIdx.length; i++) {
    const gap = hitIdx[i] - hitIdx[i - 1] - 1;
    if (gap > max) max = gap;
  }
  const tail = records.length - 1 - hitIdx[hitIdx.length - 1];
  if (tail > max) max = tail;
  return max;
}

// 連続するhit間の最大日数
function computeMaxCalendarGapDays(records: RawRecord[]): number {
  const hitDates = records
    .filter((r) => r.hit === 1)
    .map((r) => new Date(r.date).getTime());
  if (hitDates.length < 2) return -1;
  let max = 0;
  for (let i = 1; i < hitDates.length; i++) {
    const days = Math.round((hitDates[i] - hitDates[i - 1]) / 86400000);
    if (days > max) max = days;
  }
  return max;
}

function classifyPattern(
  historicalN: number,
  historicalHits: number,
  historicalRoi: number
): Pattern {
  if (historicalN < N_MIN_JUDGE) return "insufficient data";
  if (historicalRoi < ROI_WEAK) return "weak historical pattern";
  if (
    historicalRoi >= ROI_STRONG &&
    historicalN >= N_MIN_STRONG &&
    historicalHits >= HITS_MIN_STRONG
  )
    return "strong historical pattern";
  return "watch";
}

// strong に対してリスク要因を列挙する。non-strong は空文字を返す。
function computeRiskNote(
  pattern: Pattern,
  maxConsecLosses: number,
  maxCalendarGapDays: number,
  fwdN: number,
  dimCount: number,
  histN: number
): string {
  if (pattern !== "strong historical pattern") return "";
  const reasons: string[] = [];
  if (maxConsecLosses > RISK_MAX_STREAK) reasons.push(`maxStreak=${maxConsecLosses}`);
  if (maxCalendarGapDays > RISK_MAX_GAP_DAYS) reasons.push(`maxGapDays=${maxCalendarGapDays}`);
  if (fwdN > 0 && fwdN < N_MIN_JUDGE) reasons.push(`fwd n=${fwdN}`);
  if (dimCount === 3 && histN < N_STRONG_CAUTION) reasons.push(`3条件n=${histN}<${N_STRONG_CAUTION}`);
  return reasons.join(", ");
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

  const histRoi = roiCalc(histSumOdds, histN);
  const fwdRoi = roiCalc(fwdSumOdds, fwdN);
  const roiAll = roiCalc(sumOddsAll, n);

  const maxConsecLossesVal = computeMaxConsecLosses(hist);
  const maxHitGapRacesVal = computeMaxHitGapRaces(hist);
  const maxCalendarGapDaysVal = computeMaxCalendarGapDays(hist);

  const pattern = classifyPattern(histN, histHits, histRoi);
  const riskNote = computeRiskNote(
    pattern,
    maxConsecLossesVal,
    maxCalendarGapDaysVal,
    fwdN,
    dimNames.length,
    histN
  );

  return {
    condition: condLabel,
    dims: dimValues.join(" × "),
    dimCount: dimNames.length as 2 | 3,
    n,
    hits,
    hitRate: n > 0 ? Math.round((hits / n) * 100 * 10) / 10 : 0,
    histAvgOdds: avgOddsCalc(hist),
    fwdAvgOdds: avgOddsCalc(fwd),
    roi: roiAll,
    maxConsecLosses: maxConsecLossesVal,
    maxHitGapRaces: maxHitGapRacesVal,
    maxCalendarGapDays: maxCalendarGapDaysVal,
    historicalN: histN,
    historicalHits: histHits,
    historicalRoi: histRoi,
    forwardN: fwdN,
    forwardHits: fwdHits,
    forwardRoi: fwdRoi,
    pattern,
    riskNote,
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
        const dA = DIMS[i], dB = DIMS[j];
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
          const dA = DIMS[i], dB = DIMS[j], dC = DIMS[k];
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
        "判定ラベルは historical データ上の傾向のみ。BUY設定採用可否ではない。" +
        "3条件組み合わせは探索数が多く過剰適合リスクが高い。" +
        "forward n<30 は参考値。",
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

function f1(n: number): string {
  return n.toFixed(1);
}

function fwdRoiCell(c: ComboStat): string {
  const note = c.forwardN > 0 && c.forwardN < N_MIN_JUDGE ? "*(n小)*" : "";
  return `${f1(c.forwardRoi)}%${note}`;
}

const TABLE_HEADER = [
  "| 組み合わせ | hist_n | hist_hit | hist_ROI | fwd_n | fwd_hit | fwd_ROI | hist_avg | fwd_avg | maxStreak | maxGapDays | 備考 |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
];

function tableRow(c: ComboStat, remarkOverride?: string): string {
  const gapDays = c.maxCalendarGapDays < 0 ? "—" : String(c.maxCalendarGapDays);
  const fwdAvg = c.forwardN > 0 ? f1(c.fwdAvgOdds) : "—";
  const remark = remarkOverride ?? "";
  return (
    `| ${c.dims} | ${c.historicalN} | ${c.historicalHits} | ${f1(c.historicalRoi)}% | ` +
    `${c.forwardN} | ${c.forwardHits} | ${fwdRoiCell(c)} | ` +
    `${f1(c.histAvgOdds)} | ${fwdAvg} | ${c.maxConsecLosses} | ${gapDays} | ${remark} |`
  );
}

// strong パターンのうち riskNote なし (真の strong)
function strongSection(combos: ComboStat[], minN: number): string[] {
  const filtered = combos.filter(
    (c) => c.pattern === "strong historical pattern" && c.historicalN >= minN && c.riskNote === ""
  );
  const lines: string[] = [
    `### 🟢 strong historical pattern (strong判定: hist n>=${N_MIN_STRONG}, hits>=${HITS_MIN_STRONG}, ROI>=${ROI_STRONG}% / 表示: hist n>=${minN})`,
    "",
  ];
  if (filtered.length === 0) {
    lines.push("該当なし");
    lines.push("");
    return lines;
  }
  lines.push(...TABLE_HEADER);
  for (const c of filtered) {
    lines.push(tableRow(c));
  }
  lines.push("");
  return lines;
}

// strong パターンのうち riskNote あり
function riskAdjustedSection(combos: ComboStat[], minN: number): string[] {
  const filtered = combos.filter(
    (c) => c.pattern === "strong historical pattern" && c.historicalN >= minN && c.riskNote !== ""
  );
  const lines: string[] = [
    `### 🟠 risk-adjusted watch (strong 判定・リスク要因あり / 表示: hist n>=${minN})`,
    "",
    `> リスク要因: maxStreak>${RISK_MAX_STREAK}, maxGapDays>${RISK_MAX_GAP_DAYS}, fwd n<${N_MIN_JUDGE}(かつ>0), 3条件かつn<${N_STRONG_CAUTION} のいずれか。`,
    "",
  ];
  if (filtered.length === 0) {
    lines.push("該当なし");
    lines.push("");
    return lines;
  }
  lines.push(...TABLE_HEADER);
  for (const c of filtered) {
    lines.push(tableRow(c, c.riskNote));
  }
  lines.push("");
  return lines;
}

function patternSection(combos: ComboStat[], pattern: "watch" | "weak historical pattern", minN: number): string[] {
  const icon = pattern === "watch" ? "🟡" : "🔴";
  const filtered = combos.filter((c) => c.pattern === pattern && c.historicalN >= minN);
  const lines: string[] = [
    `### ${icon} ${pattern} (表示条件: hist n>=${minN})`,
    "",
  ];
  if (filtered.length === 0) {
    lines.push("該当なし");
    lines.push("");
    return lines;
  }
  lines.push(...TABLE_HEADER);
  for (const c of filtered) {
    lines.push(tableRow(c));
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

  lines.push(
    "> ⚠️ 判定ラベルは historical 傾向のみ。BUY採用には forward n>=30 の蓄積と追加検証が必要。",
    "> hist_avg: historical平均オッズ。fwd_avg: forward平均オッズ (forward n=0 は —)。",
    "> maxStreak: historical最大連敗数。maxGapDays: historical 連続hit間の最大日数 (hit<2は —)。",
    ""
  );

  for (const ncols of [2, 3] as const) {
    const combos = ncols === 2 ? twoDim : threeDim;

    lines.push(`### ${condLabel} / ${ncols}条件組み合わせ`, "");

    const total = combos.length;
    const judgeCount = combos.filter((c) => c.historicalN >= N_MIN_JUDGE).length;
    const strongAll = combos.filter((c) => c.pattern === "strong historical pattern");
    const strongClean = strongAll.filter((c) => c.riskNote === "");
    const riskAdj = strongAll.filter((c) => c.riskNote !== "");
    const weakCount = combos.filter((c) => c.pattern === "weak historical pattern").length;

    lines.push(
      `組み合わせ総数: ${total}  /  判定可能(n>=${N_MIN_JUDGE}): ${judgeCount}  /  strong: ${strongClean.length}  /  risk-adjusted: ${riskAdj.length}  /  weak: ${weakCount}`,
      ""
    );

    if (ncols === 3) {
      lines.push(
        "> ⚠️ **3条件は探索数が多く過剰適合リスクが高い。** strong でも n<100 は risk-adjusted watch に分類。判断には forward の蓄積が必要。",
        ""
      );
    }

    lines.push(...strongSection(combos, N_MIN_SHOW_MD));
    lines.push(...riskAdjustedSection(combos, N_MIN_SHOW_MD));
    lines.push(...patternSection(combos, "watch", N_MIN_SHOW_MD));
    lines.push(...patternSection(combos, "weak historical pattern", N_MIN_SHOW_MD));

    const insuf = combos.filter(
      (c) => c.pattern === "insufficient data" && c.historicalN >= N_MIN_SHOW_MD
    ).length;
    if (insuf > 0) {
      lines.push(
        `> ⚪ insufficient data (表示条件: hist n>=${N_MIN_SHOW_MD}) : ${insuf} 件 — hist n<${N_MIN_JUDGE} のため判断不可`,
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
    `> strong: hist n>=${N_MIN_STRONG}, hits>=${HITS_MIN_STRONG}, ROI>=${ROI_STRONG}%。3条件は過剰探索リスク高。`,
    `> risk-adjusted watch: strong 判定だがリスク要因 (maxStreak>${RISK_MAX_STREAK} / maxGapDays>${RISK_MAX_GAP_DAYS} / fwd n<${N_MIN_JUDGE}(>0) / 3条件n<${N_STRONG_CAUTION}) あり。`,
    "> forward n<30 は *(n小)* 表示で参考値扱い。",
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
