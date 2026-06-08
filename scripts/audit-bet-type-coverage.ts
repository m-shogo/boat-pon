/**
 * audit-bet-type-coverage.ts — 読み取り専用
 *
 * 禁止:
 * - DB INSERT / UPDATE / DELETE / DROP
 * - app_settings 変更
 * - 本番 decision ロジック変更
 *
 * 目的: race_payouts の bet_type 実値を確認し、
 *       全7券種の coverage と分析可否を判定する。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/bet-type-coverage-audit.md";
const OUT_JSON = "reports/bet-type-coverage-audit.json";

if (!existsSync(DB_PATH)) {
  console.error(`[coverage-audit] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

// ─── bet_type 正規化マップ ───────────────────────────────────────────────────

const NORMALIZED: Record<string, string> = {
  trifecta: "3連単",
  trio: "3連複",
  exacta: "2連単",
  quinella: "2連複",
  wide: "拡連複",
  win: "単勝",
  place: "複勝",
};

const ALL_BET_TYPES = ["単勝", "複勝", "2連単", "2連複", "拡連複", "3連単", "3連複"] as const;

// ─── Types ──────────────────────────────────────────────────────────────────

type BetTypeStat = {
  rawBetType: string | null;
  normalizedBetType: string;
  payoutRaces: number;
  payoutRows: number;
  nullPayoutCount: number;
  returnedCount: number;
  combinationExample: string;
  combinationExample2: string;
  coverageRate: number;
  buyRacesJoinable: number;
  missingRate: number;
  verdict: "分析可能" | "coverage不足" | "要マッピング確認";
  notes: string;
};

type CoverageReport = {
  generatedAt: string;
  dbPath: string;
  totalBuyRaces: number;
  totalPayoutRaces: number;
  rawBetTypes: { bet_type: string; n: number }[];
  betTypeStats: BetTypeStat[];
  summary: string;
};

// ─── 集計 ────────────────────────────────────────────────────────────────────

const rawRows = db.prepare(`
  SELECT bet_type, COUNT(*) AS n
  FROM race_payouts
  GROUP BY bet_type
  ORDER BY n DESC
`).all() as { bet_type: string; n: number }[];

const totalPayoutRaces = (db.prepare(`
  SELECT COUNT(DISTINCT race_id) AS n FROM race_payouts
`).get() as { n: number }).n;

const totalBuyRaces = (db.prepare(`
  SELECT COUNT(DISTINCT race_id) AS n
  FROM decision_history
  WHERE decision='BUY' AND run_kind='historical-backfill' AND result IS NOT NULL AND result != ''
`).get() as { n: number }).n;

// raw bet_type ごとの詳細統計
const detailRows = db.prepare(`
  SELECT
    bet_type,
    COUNT(DISTINCT race_id) AS payout_races,
    COUNT(*) AS payout_rows,
    SUM(CASE WHEN payout_yen IS NULL THEN 1 ELSE 0 END) AS null_payout,
    SUM(CASE WHEN returned=1 THEN 1 ELSE 0 END) AS returned_count,
    MIN(combination) AS comb_min,
    MAX(combination) AS comb_max
  FROM race_payouts
  GROUP BY bet_type
`).all() as {
  bet_type: string;
  payout_races: number;
  payout_rows: number;
  null_payout: number;
  returned_count: number;
  comb_min: string;
  comb_max: string;
}[];

// BUY decision と各 bet_type の結合可能レース数
function buyRacesJoinable(betType: string): number {
  const r = db.prepare(`
    SELECT COUNT(DISTINCT dh.race_id) AS n
    FROM decision_history dh
    JOIN race_payouts rp ON rp.race_id = dh.race_id AND rp.bet_type = ?
    WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
      AND dh.result IS NOT NULL AND dh.result != ''
  `).get(betType) as { n: number };
  return r.n;
}

// ─── 全7券種の統計を生成 ─────────────────────────────────────────────────────

const betTypeStats: BetTypeStat[] = [];

for (const normalized of ALL_BET_TYPES) {
  // raw bet_type を逆引き
  const rawEntry = Object.entries(NORMALIZED).find(([, v]) => v === normalized);
  const rawBetType = rawEntry ? rawEntry[0] : null;

  if (!rawBetType) {
    // DB にない券種
    betTypeStats.push({
      rawBetType: null,
      normalizedBetType: normalized,
      payoutRaces: 0,
      payoutRows: 0,
      nullPayoutCount: 0,
      returnedCount: 0,
      combinationExample: "-",
      combinationExample2: "-",
      coverageRate: 0,
      buyRacesJoinable: 0,
      missingRate: 1,
      verdict: "coverage不足",
      notes: "race_payouts に該当 bet_type なし",
    });
    continue;
  }

  const detail = detailRows.find((r) => r.bet_type === rawBetType);
  if (!detail) {
    betTypeStats.push({
      rawBetType,
      normalizedBetType: normalized,
      payoutRaces: 0,
      payoutRows: 0,
      nullPayoutCount: 0,
      returnedCount: 0,
      combinationExample: "-",
      combinationExample2: "-",
      coverageRate: 0,
      buyRacesJoinable: 0,
      missingRate: 1,
      verdict: "coverage不足",
      notes: "race_payouts に行なし",
    });
    continue;
  }

  const joinable = buyRacesJoinable(rawBetType);
  const coverageRate = totalPayoutRaces > 0 ? detail.payout_races / totalPayoutRaces : 0;
  const missingRate = totalBuyRaces > 0 ? 1 - joinable / totalBuyRaces : 1;

  // wide は combination が複数行ある場合があるため注意
  let notes = "";
  if (normalized === "拡連複") {
    notes = "wide: 1レースあたり払戻行数が1〜3のレースが混在。払戻行は一部省略の可能性あり。";
  } else if (normalized === "単勝" || normalized === "複勝") {
    notes = "race_payouts に win/place が存在しない。coverage 0。";
  }

  let verdict: BetTypeStat["verdict"] = "分析可能";
  if (coverageRate < 0.5 || joinable < 100) {
    verdict = "coverage不足";
  }

  betTypeStats.push({
    rawBetType,
    normalizedBetType: normalized,
    payoutRaces: detail.payout_races,
    payoutRows: detail.payout_rows,
    nullPayoutCount: detail.null_payout,
    returnedCount: detail.returned_count,
    combinationExample: detail.comb_min,
    combinationExample2: detail.comb_max,
    coverageRate: Math.round(coverageRate * 10000) / 10000,
    buyRacesJoinable: joinable,
    missingRate: Math.round(missingRate * 10000) / 10000,
    verdict,
    notes,
  });
}

// ─── レポート生成 ─────────────────────────────────────────────────────────────

const report: CoverageReport = {
  generatedAt: new Date().toISOString(),
  dbPath: DB_PATH,
  totalBuyRaces,
  totalPayoutRaces,
  rawBetTypes: rawRows,
  betTypeStats,
  summary: betTypeStats
    .map((s) => `${s.normalizedBetType}: ${s.verdict} (joinable=${s.buyRacesJoinable})`)
    .join(", "),
};

// ─── Markdown ────────────────────────────────────────────────────────────────

function pct(v: number) {
  return (v * 100).toFixed(1) + "%";
}

const md = `# 全船券 Coverage Audit

生成日時: ${report.generatedAt}
DB: ${report.dbPath}

## 概要

- BUY レース数（historical-backfill, result あり）: **${totalBuyRaces.toLocaleString()}**
- race_payouts 総レース数: **${totalPayoutRaces.toLocaleString()}**

## race_payouts bet_type 実値

| bet_type (DB値) | 行数 |
|---|---|
${rawRows.map((r) => `| \`${r.bet_type}\` | ${r.n.toLocaleString()} |`).join("\n")}

> 単勝・複勝は race_payouts に存在しない（coverage 0）

## 全券種 Coverage 詳細

| 正規名 | DB値 | payout_races | payout_rows | null払戻 | returned | combination例 | coverage率 | BUY結合可能 | 欠損率 | 判定 |
|---|---|---|---|---|---|---|---|---|---|---|
${betTypeStats
  .map(
    (s) =>
      `| ${s.normalizedBetType} | \`${s.rawBetType ?? "-"}\` | ${s.payoutRaces.toLocaleString()} | ${s.payoutRows.toLocaleString()} | ${s.nullPayoutCount} | ${s.returnedCount.toLocaleString()} | \`${s.combinationExample}\` | ${pct(s.coverageRate)} | ${s.buyRacesJoinable.toLocaleString()} | ${pct(s.missingRate)} | **${s.verdict}** |`
  )
  .join("\n")}

## 判定サマリー

### 分析可能
${betTypeStats
  .filter((s) => s.verdict === "分析可能")
  .map((s) => `- **${s.normalizedBetType}** (\`${s.rawBetType}\`): BUY結合 ${s.buyRacesJoinable.toLocaleString()} レース、欠損率 ${pct(s.missingRate)}`)
  .join("\n")}

### coverage不足（分析不可）
${betTypeStats
  .filter((s) => s.verdict === "coverage不足")
  .map((s) => `- **${s.normalizedBetType}**: ${s.notes || "BUY結合 " + s.buyRacesJoinable + " レース"}`)
  .join("\n")}

## 注意事項

- 単勝・複勝は race_payouts に存在しないため、本分析では「coverage不足」として扱い、ROI計算対象外とする。
- 拡連複(wide)は1レースあたり払戻行数が1〜3件混在。本分析では BUY 買い目との exact match で判定。
- returned=1 の行は払戻レースのため ROI 計算で除外する。
`;

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");
writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), "utf-8");

console.log(`[coverage-audit] 完了`);
console.log(`  MD:   ${OUT_MD}`);
console.log(`  JSON: ${OUT_JSON}`);
console.log(`  BUY レース: ${totalBuyRaces}`);
for (const s of betTypeStats) {
  console.log(`  ${s.normalizedBetType}: ${s.verdict} (joinable=${s.buyRacesJoinable})`);
}
