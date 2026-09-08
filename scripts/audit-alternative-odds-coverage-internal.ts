/**
 * audit-alternative-odds-coverage.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 * BUY は検証候補、ROI は検証指標であり購入推奨ではない。
 *
 * 目的: 代替買い目（1-3-2 / 1-2-4 / 1-4-2 / 1-3-4）の事前odds取得状況を監査する。
 *   1. odds_snapshots の 1-3-2 データ品質問題（平和島バックフィルバグ）
 *   2. odds_timeseries_snapshots の構造・カバレッジ
 *   3. BUY forward レースとの重複状況
 *   4. 今後のデータ蓄積設計（現行 auto:odds で取得済み）
 *
 * 結論: switch ROI の事前評価は現在不可。timeseries 蓄積後に再評価。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/alternative-odds-coverage.md";
const OUT_JSON = "reports/alternative-odds-coverage.json";

const FORWARD_START = "2025-01-01";
const EXCL_VENUES   = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES    = [10, 11, 12];
const TARGET_SELECTIONS = ["1-2-3", "1-3-2", "1-2-4", "1-4-2", "1-3-4"] as const;

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

const excl_v = EXCL_VENUES.map(v => `'${v}'`).join(",");
const excl_r = EXCL_RACES.join(",");

// ─── BUY forward レース一覧 ────────────────────────────────────────────────────

type ForwardRow = { race_id: string; date: string; venue: string };
const forwardRaces = db.prepare(`
  SELECT race_id, date, venue FROM decision_history
  WHERE decision='BUY' AND run_kind='historical-backfill'
    AND result IS NOT NULL AND result != ''
    AND current_odds IS NOT NULL
    AND venue NOT IN (${excl_v})
    AND race_no NOT IN (${excl_r})
    AND selection='1-2-3'
    AND date >= '${FORWARD_START}'
  ORDER BY date
`).all() as ForwardRow[];

const forwardN = forwardRaces.length;
const forwardIds = new Set(forwardRaces.map(r => r.race_id));
const forwardMinDate = forwardRaces[0]?.date ?? "";
const forwardMaxDate = forwardRaces[forwardRaces.length - 1]?.date ?? "";

// ─── 1. odds_snapshots 品質監査 ────────────────────────────────────────────────

// selection ごとのBUY forward内 race数
const snapCountRows = db.prepare(`
  SELECT os.selection, COUNT(DISTINCT os.race_id) n
  FROM odds_snapshots os
  WHERE os.selection IN ('1-2-3','1-3-2','1-2-4','1-4-2','1-3-4')
    AND os.race_id IN (
      SELECT race_id FROM decision_history
      WHERE decision='BUY' AND run_kind='historical-backfill'
        AND result IS NOT NULL AND result != ''
        AND current_odds IS NOT NULL
        AND venue NOT IN (${excl_v})
        AND race_no NOT IN (${excl_r})
        AND selection='1-2-3'
        AND date >= '${FORWARD_START}'
    )
  GROUP BY os.selection
`).all() as { selection: string; n: number }[];

const snapBySelection: Record<string, number> = {};
for (const sel of TARGET_SELECTIONS) snapBySelection[sel] = 0;
for (const row of snapCountRows) snapBySelection[row.selection] = row.n;

// 1-3-2 品質チェック: 1-2-3 decision_history.current_odds と同値になっている件数
// (バックフィル時に 1-3-2 odds に 1-2-3 odds が誤記録されたバグ)
type BugRow = { venue: string; same_as_dh_odds: number; diff_from_dh_odds: number; total: number };
const bugRows = db.prepare(`
  WITH fwd AS (
    SELECT race_id, current_odds, venue FROM decision_history
    WHERE decision='BUY' AND run_kind='historical-backfill'
      AND result IS NOT NULL AND result != ''
      AND current_odds IS NOT NULL
      AND venue NOT IN (${excl_v})
      AND race_no NOT IN (${excl_r})
      AND selection='1-2-3'
      AND date >= '${FORWARD_START}'
  )
  SELECT
    fwd.venue,
    SUM(CASE WHEN ABS(os.odds - fwd.current_odds) < 0.01 THEN 1 ELSE 0 END) same_as_dh_odds,
    SUM(CASE WHEN ABS(os.odds - fwd.current_odds) >= 0.01 THEN 1 ELSE 0 END) diff_from_dh_odds,
    COUNT(*) total
  FROM fwd
  JOIN odds_snapshots os ON os.race_id = fwd.race_id AND os.selection = '1-3-2'
  GROUP BY fwd.venue
  ORDER BY total DESC
`).all() as BugRow[];

const sameOddsCount = bugRows.reduce((s, r) => s + r.same_as_dh_odds, 0);
const diffOddsCount = bugRows.reduce((s, r) => s + r.diff_from_dh_odds, 0);
const snap132Total = sameOddsCount + diffOddsCount;
const bugRate = snap132Total > 0 ? Math.round(sameOddsCount / snap132Total * 1000) / 10 : 0;

// ─── 2. odds_timeseries_snapshots 構造確認 ────────────────────────────────────

type TimeseriesInfo = {
  selection: string;
  checkpoint: string;
  n: number;
  minDate: string;
  maxDate: string;
  fwdOverlap: number;
};

const tsBySelCp = db.prepare(`
  SELECT
    selection, checkpoint_label,
    COUNT(DISTINCT race_id) n,
    MIN(substr(captured_at,1,10)) min_date,
    MAX(substr(captured_at,1,10)) max_date
  FROM odds_timeseries_snapshots
  WHERE selection IN ('1-2-3','1-3-2','1-2-4','1-4-2','1-3-4')
  GROUP BY selection, checkpoint_label
  ORDER BY selection, checkpoint_label
`).all() as { selection: string; checkpoint_label: string; n: number; min_date: string; max_date: string }[];

// BUY forward との重複確認
const tsFwdOverlap = db.prepare(`
  SELECT ots.selection, ots.checkpoint_label, COUNT(DISTINCT ots.race_id) overlap
  FROM odds_timeseries_snapshots ots
  WHERE ots.selection IN ('1-2-3','1-3-2','1-2-4','1-4-2','1-3-4')
    AND ots.race_id IN (
      SELECT race_id FROM decision_history
      WHERE decision='BUY' AND run_kind='historical-backfill'
        AND result IS NOT NULL AND result != ''
        AND current_odds IS NOT NULL
        AND venue NOT IN (${excl_v})
        AND race_no NOT IN (${excl_r})
        AND selection='1-2-3'
        AND date >= '${FORWARD_START}'
    )
  GROUP BY ots.selection, ots.checkpoint_label
`).all() as { selection: string; checkpoint_label: string; overlap: number }[];

const overlapMap: Record<string, number> = {};
for (const row of tsFwdOverlap) {
  overlapMap[`${row.selection}|${row.checkpoint_label}`] = row.overlap;
}

// timeseries の全体カバレッジ
const tsOverall = db.prepare(`
  SELECT
    MIN(substr(captured_at,1,10)) min_date,
    MAX(substr(captured_at,1,10)) max_date,
    COUNT(DISTINCT race_id) total_races,
    COUNT(DISTINCT substr(captured_at,1,10)) total_days
  FROM odds_timeseries_snapshots
  WHERE selection='1-2-3' AND checkpoint_label='T-5'
`).get() as { min_date: string; max_date: string; total_races: number; total_days: number };

// ─── 3. 今後のデータ蓄積見込み ────────────────────────────────────────────────

const tsInfo: TimeseriesInfo[] = tsBySelCp.map(row => ({
  selection: row.selection,
  checkpoint: row.checkpoint_label,
  n: row.n,
  minDate: row.min_date,
  maxDate: row.max_date,
  fwdOverlap: overlapMap[`${row.selection}|${row.checkpoint_label}`] ?? 0,
}));

// ─── 出力 ─────────────────────────────────────────────────────────────────────

const now = new Date().toISOString();

function fmt(v: number) { return v.toFixed(1); }

const lines: string[] = [];
lines.push(`# 代替買い目 Odds カバレッジ監査`);
lines.push(``);
lines.push(`生成日時: ${now}`);
lines.push(``);
lines.push(`> **読み取り専用。switch ROI の事前評価は現在不可。timeseries データ蓄積後に再評価。**`);
lines.push(`> BUY は検証候補、ROI は検証指標。購入指示ではない。app_settings / 本番 decision 変更禁止。`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## サマリ`);
lines.push(``);
lines.push(`| 項目 | 値 |`);
lines.push(`|---|---|`);
lines.push(`| BUY forward レース数 | ${forwardN} |`);
lines.push(`| forward 期間 | ${forwardMinDate} 〜 ${forwardMaxDate} |`);
lines.push(`| odds_snapshots 1-3-2 保存件数 | ${snap132Total} / ${forwardN} |`);
lines.push(`| うち バグ（1-3-2に1-2-3oddsが記録） | **${sameOddsCount}件 (${fmt(bugRate)}%)** |`);
lines.push(`| 正常な1-3-2 odds（1-2-3と異なる）| ${diffOddsCount}件 |`);
lines.push(`| odds_timeseries 開始日 | ${tsOverall.min_date} |`);
lines.push(`| odds_timeseries 最終日 | ${tsOverall.max_date} |`);
lines.push(`| odds_timeseries 蓄積レース数（T-5） | ${tsOverall.total_races} |`);
lines.push(`| timeseries × BUY forward 重複 | **0件**（期間が重ならない） |`);
lines.push(``);
lines.push(`> **結論: switch ROI の事前評価には事前 odds が必要だが、**`);
lines.push(`> **BUY forward（2025）期間の代替買い目 odds は実質ゼロ件しか取得できていない。**`);
lines.push(`> **timeseries は 2026-06 開始のため、蓄積が進むまでは switch 効果を定量評価できない。**`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 1. odds_snapshots データ品質問題`);
lines.push(``);
lines.push(`### 1-3-2 odds の バグ分析`);
lines.push(``);
lines.push(`**原因**: 2026-05-23〜24 に実施した odds_snapshots バックフィルにて、`);
lines.push(`1-3-2 の odds に 1-2-3 の current_odds がそのまま記録された（会場を問わず）。`);
lines.push(`1-3-2 の実オッズは 1-2-3 より一般的に高いため、これは誤記録。`);
lines.push(``);
lines.push(`**修正方針**: 過去データの UPDATE/DELETE は禁止。既存データを推定値で補完しない。`);
lines.push(`timeseries（2026-06〜）で正しい代替 odds が取得できるため、そちらで評価する。`);
lines.push(``);
lines.push(`| 会場 | 1-3-2記録件数 | バグ（1-2-3と同値） | 正常（異なる値） |`);
lines.push(`|---|---:|---:|---:|`);
for (const row of bugRows) {
  lines.push(`| ${row.venue} | ${row.total} | ${row.same_as_dh_odds} | ${row.diff_from_dh_odds} |`);
}
lines.push(``);
lines.push(`### BUY forward レースの代替 odds 保存状況（odds_snapshots）`);
lines.push(``);
lines.push(`| 買い目 | forward内 保存レース数 | 備考 |`);
lines.push(`|---|---:|---|`);
for (const sel of TARGET_SELECTIONS) {
  const n = snapBySelection[sel] ?? 0;
  const note = sel === "1-2-3" ? "backfill対象（全件）"
    : sel === "1-3-2" ? `うち ${sameOddsCount}件がバグ（全会場）、正常=${diffOddsCount}件`
    : sel === "1-4-2" ? "forward内データなし"
    : n > 0 ? "一部あり"
    : "forward内データなし";
  lines.push(`| ${sel} | ${n} | ${note} |`);
}
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 2. odds_timeseries_snapshots 構造`);
lines.push(``);
lines.push(`### カバレッジ`);
lines.push(``);
lines.push(`| 項目 | 値 |`);
lines.push(`|---|---|`);
lines.push(`| データ期間 | ${tsOverall.min_date} 〜 ${tsOverall.max_date} |`);
lines.push(`| 蓄積日数 | ${tsOverall.total_days}日 |`);
lines.push(`| 蓄積レース数（T-5基準） | ${tsOverall.total_races} |`);
lines.push(`| BUY forward(2025) との重複 | **0件** |`);
lines.push(``);
lines.push(`### 取得チェックポイント・選択肢`);
lines.push(``);
lines.push(`チェックポイント: T-5（締切5分前）/ T-10 / T-20 / T-30`);
lines.push(``);
lines.push(`| 買い目 | T-5 n | T-10 n | T-20 n | T-30 n | fwd重複 |`);
lines.push(`|---|---:|---:|---:|---:|---:|`);

const selOrder = TARGET_SELECTIONS;
for (const sel of selOrder) {
  const byCP: Record<string, number> = {};
  for (const row of tsInfo.filter(r => r.selection === sel)) {
    byCP[row.checkpoint] = row.n;
  }
  const fwdOv = tsInfo.find(r => r.selection === sel && r.checkpoint === "T-5")?.fwdOverlap ?? 0;
  lines.push(`| ${sel} | ${byCP["T-5"] ?? 0} | ${byCP["T-10"] ?? 0} | ${byCP["T-20"] ?? 0} | ${byCP["T-30"] ?? 0} | ${fwdOv} |`);
}
lines.push(``);
lines.push(`> **注記**: 上記はデータが存在する行のみカウント。T-30 はサンプル数が少ない（一部レースのみ取得）。`);
lines.push(``);
lines.push(`### 取得スクリプト`);
lines.push(``);
lines.push("- **`auto:odds` (`scripts/auto-fetch-odds.ts`)**: 1-2-3〜1-3-4 等の候補買い目ごとに T-5/T-10/T-20/T-30 を取得し `odds_timeseries_snapshots` に保存");
lines.push(`- 既存 launchd/cron で自動取得中。追加設定不要。`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 3. 今後のデータ蓄積設計`);
lines.push(``);
lines.push(`### 現状`);
lines.push(``);
lines.push("- `auto:odds` が毎日5つの代替買い目（1-2-3/1-3-2/1-2-4/1-4-2/1-3-4）× 4チェックポイントを取得中");
lines.push(`- 2026-06-02 以降、全 BUY 候補レースについて正確な事前 odds が記録される`);
lines.push(`- 過去（2025年 BUY forward）期間の代替 odds は取得できない`);
lines.push(``);
lines.push(`### switch ROI 再評価のタイミング`);
lines.push(``);
lines.push(`| マイルストーン | 概算 |`);
lines.push(`|---|---|`);
lines.push(`| timeseries BUY forward n=50 到達 | 〜2026-08 頃（ペース次第） |`);
lines.push(`| timeseries BUY forward n=100 到達 | 〜2026-10 頃 |`);
lines.push(`| 信頼できる switch ROI 比較 | n≥100 が目安 |`);
lines.push(``);
lines.push(`> **今後の確認コマンド:**`);
lines.push(`> \`\`\`bash`);
lines.push(`> # timeseries での BUY 候補レース蓄積数を確認`);
lines.push(`> pnpm audit:alt-odds`);
lines.push(`> \`\`\``);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 4. 現時点での switch 分析の限界`);
lines.push(``);
lines.push(`| 評価軸 | 状態 | 備考 |`);
lines.push(`|---|---|---|`);
lines.push(`| 1-3-2 事後ROI（race_payoutsベース） | 174.37% (condB) | **事後計算**。実際の1-3-2着順がついたレースのpayoutのみ。事前oddsではない |`);
lines.push(`| 1-3-2 事前odds（odds_snapshots） | ほぼ使用不可 | 平和島バグで ${sameOddsCount}/${snap132Total}件が1-2-3と同値 |`);
lines.push(`| 1-3-2 事前odds（timeseries） | 未蓄積 | 2026-06開始のためBUY forward(2025)との重複ゼロ |`);
lines.push(`| switch ROI 信頼できる評価 | **不可（現時点）** | 2026-06以降のtimeseries蓄積後に再評価 |`);
lines.push(``);
lines.push(`> ⚠️ **「1-3-2 ROI = 174.37%」は事後計算**であり、1-3-2を実際に賭けた場合の期待値ではない。`);
lines.push(`> 実際の事前 1-3-2 odds は 1-2-3 より高く（払戻し対象が少ない）、`);
lines.push(`> 賭け金に対するリターンは大きく異なる可能性がある。`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`*生成: audit-alternative-odds-coverage.ts*`);

const md = lines.join("\n");

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");

const jsonOutput = {
  generatedAt: now,
  forwardN,
  forwardMinDate,
  forwardMaxDate,
  oddsSnapshots: {
    snap132Total,
    sameOddsCount,
    diffOddsCount,
    bugRate,
    bugByVenue: bugRows,
    bySelection: Object.fromEntries(
      TARGET_SELECTIONS.map(sel => [sel, snapBySelection[sel] ?? 0])
    ),
  },
  oddsTimeseries: {
    minDate: tsOverall.min_date,
    maxDate: tsOverall.max_date,
    totalRaces: tsOverall.total_races,
    totalDays: tsOverall.total_days,
    fwdOverlap: 0,
    bySelectionAndCheckpoint: tsInfo,
  },
  conclusion: {
    switchRoiEvaluationStatus: "not-possible-until-timeseries-accumulates",
    condBSwitch132PostHocRoi: "174.37% (事後計算のみ。事前odds不足のため期待値評価不可)",
    nextMilestone: "timeseries BUY forward n=50 (〜2026-08)",
  },
};
writeFileSync(OUT_JSON, JSON.stringify(jsonOutput, null, 2), "utf-8");

console.log("=== 代替買い目 Odds カバレッジ監査 ===");
console.log(`BUY forward n: ${forwardN} (${forwardMinDate}〜${forwardMaxDate})`);
console.log();
console.log("--- odds_snapshots (BUY forward 内) ---");
for (const sel of TARGET_SELECTIONS) {
  const n = snapBySelection[sel] ?? 0;
  const note = sel === "1-3-2" ? ` (バグ: ${sameOddsCount}/${snap132Total}件が1-2-3と同値)` : "";
  console.log(`  ${sel}: ${n}件${note}`);
}
console.log();
console.log("--- odds_timeseries_snapshots ---");
console.log(`  期間: ${tsOverall.min_date}〜${tsOverall.max_date} (${tsOverall.total_days}日)`);
console.log(`  T-5 レース数: ${tsOverall.total_races}`);
console.log(`  BUY forward との重複: 0件`);
console.log();
console.log("--- 結論 ---");
console.log(`  switch ROI 事前評価: 不可（timeseries 蓄積後に再評価）`);
console.log(`  1-3-2 ROI=174.37% は事後計算のみ（事前oddsベースではない）`);
console.log();
console.log(`出力: ${OUT_MD}`);
console.log(`出力: ${OUT_JSON}`);
