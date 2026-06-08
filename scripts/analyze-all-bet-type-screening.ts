/**
 * analyze-all-bet-type-screening.ts — 読み取り専用
 *
 * 禁止:
 * - DB INSERT / UPDATE / DELETE / DROP
 * - app_settings 変更
 * - 本番 decision ロジック変更
 *
 * 目的: 全5券種（exacta/quinella/wide/trifecta/trio）の一次ROIを浅く比較し、
 *       深掘り候補を絞る。単勝・複勝は coverage=0 のため除外。
 *
 * 各戦略:
 *   C. 2連単 (exacta):  selection S1-S2-S3 → buy exacta S1-S2
 *   D. 2連複 (quinella): → buy quinella min(S1,S2)-max(S1,S2)
 *   E. 拡連複 (wide):    → buy wide min(S1,S2)-max(S1,S2)
 *   F. 3連単 (trifecta): → buy trifecta S1-S2-S3 (現行)
 *   G. 3連複 (trio):     → buy trio sorted(S1,S2,S3)
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/all-bet-type-screening.md";
const OUT_JSON = "reports/all-bet-type-screening.json";
const STAKE = 100;

if (!existsSync(DB_PATH)) {
  console.error(`[screening] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

// ─── Types ──────────────────────────────────────────────────────────────────

type RawRow = {
  race_id: string;
  date: string;
  selection: string;
  result: string;
  current_odds: number | null;
  returned: number;
};

type PayoutRow = {
  race_id: string;
  bet_type: string;
  combination: string;
  payout_yen: number | null;
  returned: number;
};

type StrategyResult = {
  betType: string;
  strategyName: string;
  nRaces: number;
  totalTickets: number;
  avgTicketsPerRace: number;
  totalStake: number;
  hits: number;
  hitRate: number;
  avgPayoutOdds: number;
  medianPayoutOdds: number;
  maxHitOdds: number;
  totalReturn: number;
  ROI: number;
  roiExMaxHit: number;
  roiExMax3Hits: number;
  roiExMax5Hits: number;
  coverageRate: number;         // joinableRaces / totalBuyRaces（payout行が存在したレース率）
  missingCoverageCount: number; // payout行が一切存在しなかったレース数
  missingCoverageNote: string;  // 欠損の扱い（外れ扱い or 除外）
  missingPayoutCount: number;
  returnedCount: number;
  trainROI: number;
  validationROI: number;
  testROI: number;
  year2024ROI: number;
  year2025ROI: number;
  year2026ROI: number;
  worstMonthROI: number;
  goodMonths: number;
  badMonths: number;
  warnings: string[];
  verdict: "今すぐ有望" | "追加検証候補" | "危険/過学習" | "coverage不足" | "本番投入はまだ早い";
};

type ScreeningReport = {
  generatedAt: string;
  dbPath: string;
  totalBuyRaces: number;
  strategies: StrategyResult[];
  ranking: { rank: number; strategyName: string; ROI: number; verdict: string }[];
  deepDiveCandidates: string[];
  summary: string;
};

// ─── データ取得 ──────────────────────────────────────────────────────────────

const rows = db.prepare(`
  SELECT race_id, date, selection, result, current_odds, returned
  FROM decision_history
  WHERE decision='BUY' AND run_kind='historical-backfill'
    AND result IS NOT NULL AND result != ''
  ORDER BY date
`).all() as RawRow[];

// race_payouts を全件ロード（インデックスとして使う）
const payoutIndex = new Map<string, number>(); // key: "race_id|bet_type|combination"
const payoutReturnedSet = new Set<string>();
// bet_type ごとに「そのレースのpayoutが存在するか」を確認するセット
const payoutRaceByType = new Map<string, Set<string>>(); // betType -> Set<race_id>

const payoutRows = db.prepare(`
  SELECT race_id, bet_type, combination, payout_yen, returned
  FROM race_payouts
  WHERE bet_type IN ('exacta','quinella','wide','trifecta','trio')
`).all() as PayoutRow[];

for (const p of payoutRows) {
  const key = `${p.race_id}|${p.bet_type}|${p.combination}`;
  payoutIndex.set(key, p.payout_yen ?? 0);
  if (p.returned === 1) payoutReturnedSet.add(key);
  if (!payoutRaceByType.has(p.bet_type)) payoutRaceByType.set(p.bet_type, new Set());
  payoutRaceByType.get(p.bet_type)!.add(p.race_id);
}

// ─── ユーティリティ ──────────────────────────────────────────────────────────

function parseSelection(sel: string): [number, number, number] {
  const parts = sel.split("-").map(Number);
  return [parts[0], parts[1], parts[2]] as [number, number, number];
}

function sortedPair(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function sortedTrio(a: number, b: number, c: number): string {
  const sorted = [a, b, c].sort((x, y) => x - y);
  return sorted.join("-");
}

function payout(raceId: string, betType: string, combination: string): number | null {
  const key = `${raceId}|${betType}|${combination}`;
  if (payoutReturnedSet.has(key)) return null; // 返還
  if (payoutIndex.has(key)) return payoutIndex.get(key)!;
  return undefined as unknown as null; // 払戻なし（外れ or データなし）
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function calcROI(hits: { payout: number }[], totalStake: number): number {
  if (totalStake === 0) return 0;
  const totalReturn = hits.reduce((s, h) => s + h.payout, 0);
  return Math.round((totalReturn / totalStake) * 10000) / 100;
}

// ─── 戦略定義 ────────────────────────────────────────────────────────────────

type Strategy = {
  betType: string;
  name: string;
  getBetCombination: (sel: [number, number, number]) => string;
  dbBetType: string;
};

const STRATEGIES: Strategy[] = [
  {
    betType: "3連単",
    name: "3連単: selection そのまま",
    getBetCombination: ([s1, s2, s3]) => `${s1}-${s2}-${s3}`,
    dbBetType: "trifecta",
  },
  {
    betType: "3連複",
    name: "3連複: selection 3艇 trio",
    getBetCombination: ([s1, s2, s3]) => sortedTrio(s1, s2, s3),
    dbBetType: "trio",
  },
  {
    betType: "2連単",
    name: "2連単: 上位2艇 exacta",
    getBetCombination: ([s1, s2]) => `${s1}-${s2}`,
    dbBetType: "exacta",
  },
  {
    betType: "2連複",
    name: "2連複: 上位2艇 quinella",
    getBetCombination: ([s1, s2]) => sortedPair(s1, s2),
    dbBetType: "quinella",
  },
  {
    betType: "拡連複",
    name: "拡連複: 上位2艇 wide",
    getBetCombination: ([s1, s2]) => sortedPair(s1, s2),
    dbBetType: "wide",
  },
];

// ─── 各戦略を評価 ─────────────────────────────────────────────────────────────

function evaluate(strategy: Strategy): StrategyResult {
  type HitRecord = { payout: number; odds: number; date: string; ym: string };

  const hitsByDate: HitRecord[] = [];
  let missingCount = 0;
  let missingCoverageCount = 0; // payout テーブルにそのレース自体が存在しない
  let returnedCount = 0;
  let validRaces = 0;

  const raceSetForType = payoutRaceByType.get(strategy.dbBetType) ?? new Set<string>();

  // 年月別 stake / return
  const ymStake = new Map<string, number>();
  const ymReturn = new Map<string, number>();

  for (const row of rows) {
    const sel = parseSelection(row.selection);
    const combination = strategy.getBetCombination(sel);
    const raceId = row.race_id;
    const betTypeDb = strategy.dbBetType;
    const ym = row.date.slice(0, 7);

    const key = `${raceId}|${betTypeDb}|${combination}`;
    const isReturned = payoutReturnedSet.has(key);

    if (isReturned) {
      returnedCount++;
      continue;
    }

    // そのレース自体が race_payouts に存在するか確認
    const hasPayoutForRace = raceSetForType.has(raceId);
    if (!hasPayoutForRace) {
      missingCoverageCount++;
      // coverage 欠損レースは「外れ扱い」としてROI計算に含む（除外しない）
      validRaces++;
      ymStake.set(ym, (ymStake.get(ym) ?? 0) + STAKE);
      ymReturn.set(ym, ymReturn.get(ym) ?? 0);
      continue;
    }

    validRaces++;
    ymStake.set(ym, (ymStake.get(ym) ?? 0) + STAKE);

    const p = payout(raceId, betTypeDb, combination);
    if (p === null) {
      // returned 処理済み（上で continue 済み）
    } else if (p > 0) {
      const odds = p / 100;
      hitsByDate.push({ payout: p, odds, date: row.date, ym });
      ymReturn.set(ym, (ymReturn.get(ym) ?? 0) + p);
    }
    // p === 0: 外れ（stake は積んでいる）
  }

  const hits = hitsByDate.length;
  const totalStake = validRaces * STAKE;
  const totalReturn = hitsByDate.reduce((s, h) => s + h.payout, 0);
  const ROI = totalStake > 0 ? Math.round((totalReturn / totalStake) * 10000) / 100 : 0;

  // ExMaxHit 系
  const sortedHits = [...hitsByDate].sort((a, b) => b.payout - a.payout);
  const returnExMax1 = totalReturn - (sortedHits[0]?.payout ?? 0);
  const returnExMax3 = totalReturn - sortedHits.slice(0, 3).reduce((s, h) => s + h.payout, 0);
  const returnExMax5 = totalReturn - sortedHits.slice(0, 5).reduce((s, h) => s + h.payout, 0);
  const stakeExMax1 = totalStake - STAKE;
  const stakeExMax3 = totalStake - 3 * STAKE;
  const stakeExMax5 = totalStake - 5 * STAKE;

  const roiExMaxHit = stakeExMax1 > 0 ? Math.round((returnExMax1 / stakeExMax1) * 10000) / 100 : 0;
  const roiExMax3Hits = stakeExMax3 > 0 ? Math.round((returnExMax3 / stakeExMax3) * 10000) / 100 : 0;
  const roiExMax5Hits = stakeExMax5 > 0 ? Math.round((returnExMax5 / stakeExMax5) * 10000) / 100 : 0;

  // オッズ統計
  const hitOdds = hitsByDate.map((h) => h.odds);
  const avgPayoutOdds = hits > 0 ? hitOdds.reduce((s, o) => s + o, 0) / hits : 0;
  const medianPayoutOdds = median(hitOdds);
  const maxHitOdds = hits > 0 ? Math.max(...hitOdds) : 0;

  // 期間分割: 2024-01〜2024-08 train / 2024-09〜2024-12 validation / 2025-01〜 test
  const trainYms = [...ymStake.keys()].filter((ym) => ym >= "2024-01" && ym <= "2024-08");
  const valYms = [...ymStake.keys()].filter((ym) => ym >= "2024-09" && ym <= "2024-12");
  const testYms = [...ymStake.keys()].filter((ym) => ym >= "2025-01");

  function periodROI(yms: string[]): number {
    const stake = yms.reduce((s, ym) => s + (ymStake.get(ym) ?? 0), 0);
    const ret = yms.reduce((s, ym) => s + (ymReturn.get(ym) ?? 0), 0);
    return stake > 0 ? Math.round((ret / stake) * 10000) / 100 : 0;
  }

  function yearROI(year: string): number {
    const yms = [...ymStake.keys()].filter((ym) => ym.startsWith(year));
    return periodROI(yms);
  }

  const trainROI = periodROI(trainYms);
  const validationROI = periodROI(valYms);
  const testROI = periodROI(testYms);

  // 月別 ROI
  const monthROIs: number[] = [];
  for (const [ym, stake] of ymStake) {
    const ret = ymReturn.get(ym) ?? 0;
    if (stake > 0) monthROIs.push(Math.round((ret / stake) * 10000) / 100);
  }
  const worstMonthROI = monthROIs.length > 0 ? Math.min(...monthROIs) : 0;
  const goodMonths = monthROIs.filter((r) => r >= 100).length;
  const badMonths = monthROIs.filter((r) => r < 80).length;

  const hitRate = validRaces > 0 ? Math.round((hits / validRaces) * 10000) / 100 : 0;
  // coverageRate: race_payouts にpayout行が存在したレース / 全BUYレース
  const joinableRaces = validRaces - missingCoverageCount;
  const coverageRate = rows.length > 0 ? Math.round((joinableRaces / rows.length) * 10000) / 100 : 0;

  // 警告
  const warnings: string[] = [];
  if (hits < 5) warnings.push("的中数 < 5: 参考扱い");
  if (hits < 3) warnings.push("的中数 < 3: 統計的に無意味");
  if (ROI > 110 && roiExMaxHit < 90) warnings.push("最大的中依存が高い: ExMaxHit が大幅低下");
  if (trainROI > 105 && validationROI < 95 && testROI < 95) warnings.push("train過学習の可能性");
  if (strategy.betType === "拡連複" && ROI < 105) warnings.push("低オッズ券種: ROI105未満は弱い");
  if (strategy.betType === "2連複" && ROI < 103) warnings.push("低オッズ券種: ROI103未満は弱い");

  // 判定
  let verdict: StrategyResult["verdict"];
  if (hits < 5 || validRaces < 100) {
    verdict = "coverage不足";
  } else if (
    ROI >= 108 &&
    roiExMaxHit >= 95 &&
    testROI >= 95 &&
    validationROI >= 95 &&
    hits >= 10
  ) {
    verdict = "今すぐ有望";
  } else if (
    ROI >= 103 &&
    roiExMaxHit >= 90 &&
    hits >= 5 &&
    !(trainROI > 110 && validationROI < 90 && testROI < 90)
  ) {
    verdict = "追加検証候補";
  } else if (trainROI > 110 && (validationROI < 85 || testROI < 85)) {
    verdict = "危険/過学習";
  } else {
    verdict = "本番投入はまだ早い";
  }

  return {
    betType: strategy.betType,
    strategyName: strategy.name,
    nRaces: validRaces,
    totalTickets: validRaces,
    avgTicketsPerRace: 1,
    totalStake,
    hits,
    hitRate,
    avgPayoutOdds: Math.round(avgPayoutOdds * 100) / 100,
    medianPayoutOdds: Math.round(medianPayoutOdds * 100) / 100,
    maxHitOdds: Math.round(maxHitOdds * 100) / 100,
    totalReturn,
    ROI,
    roiExMaxHit,
    roiExMax3Hits,
    roiExMax5Hits,
    coverageRate,
    missingCoverageCount,
    missingCoverageNote: "coverage欠損レースは外れ扱い（ステークに含む、回収ゼロ）でROI計算に含む",
    missingPayoutCount: missingCount,
    returnedCount,
    trainROI,
    validationROI,
    testROI,
    year2024ROI: yearROI("2024"),
    year2025ROI: yearROI("2025"),
    year2026ROI: yearROI("2026"),
    worstMonthROI,
    goodMonths,
    badMonths,
    warnings,
    verdict,
  };
}

// ─── 全戦略評価 ───────────────────────────────────────────────────────────────

const results: StrategyResult[] = STRATEGIES.map(evaluate);

// ランキング（ROI降順）
const ranking = [...results]
  .sort((a, b) => b.ROI - a.ROI)
  .map((r, i) => ({
    rank: i + 1,
    strategyName: r.strategyName,
    ROI: r.ROI,
    verdict: r.verdict,
  }));

const deepDiveCandidates = results
  .filter(
    (r) =>
      r.nRaces >= 100 &&
      r.hits >= 5 &&
      r.ROI >= 100 &&
      r.verdict !== "危険/過学習" &&
      r.verdict !== "coverage不足"
  )
  .sort((a, b) => b.ROI - a.ROI)
  .map((r) => r.betType);

const report: ScreeningReport = {
  generatedAt: new Date().toISOString(),
  dbPath: DB_PATH,
  totalBuyRaces: rows.length,
  strategies: results,
  ranking,
  deepDiveCandidates,
  summary: `深掘り候補: ${deepDiveCandidates.join(", ") || "なし"}`,
};

// ─── Markdown ────────────────────────────────────────────────────────────────

function pct(v: number) { return v.toFixed(1) + "%"; }
function yen(v: number) { return v.toLocaleString() + "円"; }
function r2(v: number) { return v.toFixed(2); }

const md = `# 全船券 一次ROI スクリーニング

生成日時: ${report.generatedAt}
DB: ${report.dbPath}

## 対象

- run_kind='historical-backfill', decision='BUY', result あり
- BUY レース数: **${rows.length.toLocaleString()}**
- 単勝・複勝: race_payouts に存在しないため除外

## ROI ランキング

| rank | 戦略 | ROI | ExMaxHit ROI | hits | hitRate | 判定 |
|---|---|---|---|---|---|---|
${ranking
  .map(
    (r) => {
      const s = results.find((x) => x.strategyName === r.strategyName)!;
      return `| ${r.rank} | ${r.strategyName} | **${r.ROI}%** | ${s.roiExMaxHit}% | ${s.hits} | ${pct(s.hitRate)} | ${r.verdict} |`;
    }
  )
  .join("\n")}

## 戦略別 詳細

${results
  .map(
    (s) => `### ${s.strategyName}

| 指標 | 値 |
|---|---|
| レース数 | ${s.nRaces.toLocaleString()} |
| 総ステーク | ${yen(s.totalStake)} |
| 的中数 | ${s.hits} |
| 的中率 | ${pct(s.hitRate)} |
| 総回収 | ${yen(s.totalReturn)} |
| **ROI** | **${s.ROI}%** |
| ExMaxHit ROI | ${s.roiExMaxHit}% |
| ExMax3Hit ROI | ${s.roiExMax3Hits}% |
| ExMax5Hit ROI | ${s.roiExMax5Hits}% |
| 平均的中オッズ | ${r2(s.avgPayoutOdds)}x |
| 中央的中オッズ | ${r2(s.medianPayoutOdds)}x |
| 最大的中オッズ | ${r2(s.maxHitOdds)}x |
| train ROI (2024-01〜08) | ${s.trainROI}% |
| validation ROI (2024-09〜12) | ${s.validationROI}% |
| test ROI (2025-01〜) | ${s.testROI}% |
| 2024 ROI | ${s.year2024ROI}% |
| 2025 ROI | ${s.year2025ROI}% |
| 2026 ROI | ${s.year2026ROI}% |
| 最悪月 ROI | ${s.worstMonthROI}% |
| 良好月数(≥100%) | ${s.goodMonths} |
| 不調月数(<80%) | ${s.badMonths} |
| payout coverage率 | ${pct(s.coverageRate)} (${s.missingCoverageCount}件欠損) |
| coverage欠損の扱い | 外れ扱い（ROI計算に含む・回収ゼロ） |
| returned 除外 | ${s.returnedCount} |
| **判定** | **${s.verdict}** |

${s.warnings.length > 0 ? `**警告:** ${s.warnings.join(" / ")}` : "警告なし"}
`
  )
  .join("\n")}

## 深掘り候補

${deepDiveCandidates.length > 0
  ? deepDiveCandidates.map((c) => `- **${c}**`).join("\n")
  : "- 有望候補なし（全券種 ROI < 100 または hit < 5）"}

## 注意事項

- 1点100円で統一。1戦略1点/レース。
- ROI は検証指標であり購入推奨ではない。
- ExMaxHit ROI = 最大的中1件を除いた ROI。この値が低い場合は外れ値依存が高い。
- train/validation/test 分割: 2024-01〜08 / 2024-09〜12 / 2025-01〜
- 単勝・複勝は race_payouts に存在しないため分析対象外。
`;

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");
writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), "utf-8");

console.log(`[screening] 完了`);
console.log(`  MD:   ${OUT_MD}`);
console.log(`  BUY レース: ${rows.length}`);
console.log(`\n  ROI ランキング:`);
for (const r of ranking) {
  const s = results.find((x) => x.strategyName === r.strategyName)!;
  console.log(`  ${r.rank}. ${r.strategyName}: ROI=${r.ROI}% hits=${s.hits} → ${r.verdict}`);
}
console.log(`\n  深掘り候補: ${deepDiveCandidates.join(", ") || "なし"}`);
