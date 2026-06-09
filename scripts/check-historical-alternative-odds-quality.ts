/**
 * check-historical-alternative-odds-quality.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 * BUY は検証候補、ROI は検証指標であり購入推奨ではない。
 *
 * 目的: historical_alternative_odds テーブルの保存品質を確認する。
 *   - 5買い目 coverage, 同値チェック, 異常値, source 確認
 *   - condB / skip候補 との重複確認
 *   - 既存テーブルに副作用がないことを確認
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/historical-alternative-odds-quality.md";
const OUT_JSON = "reports/historical-alternative-odds-quality.json";
const TARGET_TABLE = "historical_alternative_odds";

const FORWARD_START = "2025-01-01";
const EXCL_VENUES   = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES    = [10, 11, 12];
const TARGET_SELS   = ["1-2-3", "1-3-2", "1-2-4", "1-4-2", "1-3-4"] as const;
const SOURCE_TYPE    = "official_archive";
const SOURCE_QUALITY = "historical_closing_odds";

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

const excl_v = EXCL_VENUES.map(v => `'${v}'`).join(",");
const excl_r = EXCL_RACES.join(",");

// ─── テーブル存在確認 ─────────────────────────────────────────────────────────

const tableExists = (db.prepare(
  `SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='${TARGET_TABLE}'`
).get() as { n: number }).n > 0;

if (!tableExists) {
  console.log(`⚠️ ${TARGET_TABLE} テーブルが存在しません。CREATE TABLE を先に実行してください。`);
  process.exit(0);
}

// ─── 基本統計 ─────────────────────────────────────────────────────────────────

const basic = db.prepare(`
  SELECT
    COUNT(*) total_rows,
    COUNT(DISTINCT race_id) total_races,
    COUNT(DISTINCT combination) total_combinations,
    MIN(race_date) min_date,
    MAX(race_date) max_date
  FROM ${TARGET_TABLE}
  WHERE source_type='${SOURCE_TYPE}' AND source_quality='${SOURCE_QUALITY}'
`).get() as { total_rows: number; total_races: number; total_combinations: number; min_date: string; max_date: string };

// ─── combination 別件数 ───────────────────────────────────────────────────────

const byCombo = db.prepare(`
  SELECT combination, COUNT(*) n
  FROM ${TARGET_TABLE}
  WHERE source_type='${SOURCE_TYPE}' AND source_quality='${SOURCE_QUALITY}'
  GROUP BY combination
  ORDER BY combination
`).all() as { combination: string; n: number }[];

// ─── race単位で5買い目が揃っている割合 ───────────────────────────────────────

const with5Sels = (db.prepare(`
  SELECT COUNT(*) n FROM (
    SELECT race_id
    FROM ${TARGET_TABLE}
    WHERE source_type='${SOURCE_TYPE}' AND source_quality='${SOURCE_QUALITY}'
      AND combination IN ('1-2-3','1-3-2','1-2-4','1-4-2','1-3-4')
      AND odds > 0
    GROUP BY race_id
    HAVING COUNT(DISTINCT combination) >= 5
  )
`).get() as { n: number }).n;

const with4Sels = (db.prepare(`
  SELECT COUNT(*) n FROM (
    SELECT race_id
    FROM ${TARGET_TABLE}
    WHERE source_type='${SOURCE_TYPE}' AND source_quality='${SOURCE_QUALITY}'
      AND combination IN ('1-2-3','1-3-2','1-2-4','1-4-2','1-3-4')
      AND odds > 0
    GROUP BY race_id
    HAVING COUNT(DISTINCT combination) = 4
  )
`).get() as { n: number }).n;

// ─── condB 対象 race 数 ────────────────────────────────────────────────────────

const WIND24 = `EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id
  AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)`;
const EXH1   = `EXISTS (SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=1
    AND ed.exhibition_time IS NOT NULL
    AND ed.exhibition_time = (SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2
      WHERE ed2.race_id=dh.race_id))`;

const condBInTable = (db.prepare(`
  SELECT COUNT(DISTINCT hao.race_id) n
  FROM ${TARGET_TABLE} hao
  JOIN decision_history dh ON dh.race_id=hao.race_id
    AND dh.selection='1-2-3' AND dh.run_kind='historical-backfill'
  WHERE hao.source_type='${SOURCE_TYPE}' AND hao.source_quality='${SOURCE_QUALITY}'
    AND ${WIND24} AND ${EXH1}
`).get() as { n: number }).n;

// ─── 同値チェック: 1-2-3 = 1-3-2 の件数 ─────────────────────────────────────

const sameValueCheck = db.prepare(`
  SELECT
    COUNT(*) total_with_both,
    SUM(CASE WHEN ABS(o123 - o132) < 0.01 THEN 1 ELSE 0 END) same_123_132,
    SUM(CASE WHEN ABS(o123 - o132) < 0.01
      AND ABS(o123 - o124) < 0.01
      AND ABS(o123 - o142) < 0.01
      AND ABS(o123 - o134) < 0.01 THEN 1 ELSE 0 END) all_same
  FROM (
    SELECT race_id,
      MIN(CASE WHEN combination='1-2-3' THEN odds END) o123,
      MIN(CASE WHEN combination='1-3-2' THEN odds END) o132,
      MIN(CASE WHEN combination='1-2-4' THEN odds END) o124,
      MIN(CASE WHEN combination='1-4-2' THEN odds END) o142,
      MIN(CASE WHEN combination='1-3-4' THEN odds END) o134
    FROM ${TARGET_TABLE}
    WHERE source_type='${SOURCE_TYPE}' AND source_quality='${SOURCE_QUALITY}'
    GROUP BY race_id
    HAVING COUNT(DISTINCT combination) >= 5
  )
  WHERE o123 IS NOT NULL AND o132 IS NOT NULL
`).get() as { total_with_both: number; same_123_132: number; all_same: number };

// ─── 異常値チェック ───────────────────────────────────────────────────────────

const anomaly = db.prepare(`
  SELECT
    SUM(CASE WHEN odds <= 0 THEN 1 ELSE 0 END) zero_or_neg,
    SUM(CASE WHEN odds IS NULL THEN 1 ELSE 0 END) null_odds,
    SUM(CASE WHEN odds > 9999 THEN 1 ELSE 0 END) very_large
  FROM ${TARGET_TABLE}
  WHERE source_type='${SOURCE_TYPE}' AND source_quality='${SOURCE_QUALITY}'
`).get() as { zero_or_neg: number; null_odds: number; very_large: number };

// ─── source フィールド確認 ────────────────────────────────────────────────────

const sourceCheck = db.prepare(`
  SELECT
    COUNT(CASE WHEN source_type='${SOURCE_TYPE}' THEN 1 END) correct_type,
    COUNT(CASE WHEN source_quality='${SOURCE_QUALITY}' THEN 1 END) correct_quality,
    COUNT(CASE WHEN is_backfill=1 THEN 1 END) is_backfill_1,
    COUNT(CASE WHEN source_url IS NOT NULL AND source_url != '' THEN 1 END) has_url,
    COUNT(CASE WHEN fetched_at IS NOT NULL AND fetched_at != '' THEN 1 END) has_fetched_at,
    COUNT(CASE WHEN parser_version IS NOT NULL THEN 1 END) has_parser_ver
  FROM ${TARGET_TABLE}
`).get() as {
  correct_type: number; correct_quality: number; is_backfill_1: number;
  has_url: number; has_fetched_at: number; has_parser_ver: number;
};

// ─── 既存テーブルへの影響確認 ─────────────────────────────────────────────────

const oddsSnapshotsCount = (db.prepare(
  "SELECT COUNT(*) n FROM odds_snapshots WHERE source='historical_closing_odds'"
).get() as { n: number }).n;

const timeseriesCount = (db.prepare(
  "SELECT COUNT(*) n FROM odds_timeseries_snapshots WHERE source='historical_closing_odds'"
).get() as { n: number }).n;

// ─── 欠損詳細 ─────────────────────────────────────────────────────────────────

type MissingDetail = { race_id: string; race_date: string; venue: string; race_no: number; n_combos: number; combos: string };
const missingDetail = db.prepare(`
  SELECT race_id, race_date, venue, race_no,
    COUNT(DISTINCT combination) n_combos,
    GROUP_CONCAT(combination ORDER BY combination) combos
  FROM ${TARGET_TABLE}
  WHERE source_type='${SOURCE_TYPE}' AND source_quality='${SOURCE_QUALITY}'
  GROUP BY race_id
  HAVING n_combos < 5
  LIMIT 20
`).all() as MissingDetail[];

// ─── 出力 ────────────────────────────────────────────────────────────────────

const now = new Date().toISOString();
const lines: string[] = [];
const totalRows = basic.total_rows;

function pct(a: number, b: number) { return b > 0 ? Math.round(a / b * 100) : 0; }

lines.push(`# historical_alternative_odds 保存品質チェック`);
lines.push(``);
lines.push(`生成日時: ${now}`);
lines.push(``);
lines.push(`> **読み取り専用。BUY は検証候補、ROI は検証指標。購入指示ではない。**`);
lines.push(`> **historical closing odds は live/T-5/timeseries odds ではない。**`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 基本統計`);
lines.push(``);
lines.push(`| 項目 | 値 |`);
lines.push(`|---|---|`);
lines.push(`| 総レコード数 | ${totalRows} |`);
lines.push(`| ユニーク race 数 | ${basic.total_races} |`);
lines.push(`| データ期間 | ${basic.min_date} 〜 ${basic.max_date} |`);
lines.push(`| 5買い目全て揃っている race 数 | ${with5Sels} / ${basic.total_races} (${pct(with5Sels, basic.total_races)}%) |`);
lines.push(`| 4買い目のみの race 数 | ${with4Sels} (欠場等で正常なスキップ) |`);
lines.push(`| condB 該当 race 数 | ${condBInTable} |`);
lines.push(``);
lines.push(`## combination 別件数`);
lines.push(``);
lines.push(`| combination | 件数 | 率 |`);
lines.push(`|---|---:|---:|`);
for (const row of byCombo) {
  lines.push(`| ${row.combination} | ${row.n} | ${pct(row.n, basic.total_races)}% |`);
}
lines.push(``);
lines.push(`## 同値チェック`);
lines.push(``);
lines.push(`| 項目 | 件数 | 率 | 判定 |`);
lines.push(`|---|---:|---:|---|`);
const same132Rate = pct(sameValueCheck.same_123_132, sameValueCheck.total_with_both);
const allSameRate  = pct(sameValueCheck.all_same, sameValueCheck.total_with_both);
lines.push(`| 5買い目揃い race | ${sameValueCheck.total_with_both} | — | — |`);
lines.push(`| 1-2-3=1-3-2 同値 | ${sameValueCheck.same_123_132} | ${same132Rate}% | ${same132Rate < 10 ? "✅ OK" : "⚠️ 要確認"} |`);
lines.push(`| 5買い目全同値 | ${sameValueCheck.all_same} | ${allSameRate}% | ${allSameRate === 0 ? "✅ OK" : "❌ ERROR"} |`);
lines.push(``);
lines.push(`## 異常値チェック`);
lines.push(``);
lines.push(`| 項目 | 件数 | 判定 |`);
lines.push(`|---|---:|---|`);
lines.push(`| odds ≤ 0 | ${anomaly.zero_or_neg} | ${anomaly.zero_or_neg === 0 ? "✅ OK" : "❌ ERROR"} |`);
lines.push(`| odds = NULL | ${anomaly.null_odds} | ${anomaly.null_odds === 0 ? "✅ OK" : "❌ ERROR"} |`);
lines.push(`| odds > 9999 | ${anomaly.very_large} | ${anomaly.very_large === 0 ? "✅ OK" : "⚠️ 要確認"} |`);
lines.push(``);
lines.push(`## source フィールド確認`);
lines.push(``);
lines.push(`| 項目 | 件数 | 率 | 判定 |`);
lines.push(`|---|---:|---:|---|`);
lines.push(`| source_type=official_archive | ${sourceCheck.correct_type} | ${pct(sourceCheck.correct_type, totalRows)}% | ${sourceCheck.correct_type === totalRows ? "✅" : "❌"} |`);
lines.push(`| source_quality=historical_closing_odds | ${sourceCheck.correct_quality} | ${pct(sourceCheck.correct_quality, totalRows)}% | ${sourceCheck.correct_quality === totalRows ? "✅" : "❌"} |`);
lines.push(`| is_backfill=1 | ${sourceCheck.is_backfill_1} | ${pct(sourceCheck.is_backfill_1, totalRows)}% | ${sourceCheck.is_backfill_1 === totalRows ? "✅" : "❌"} |`);
lines.push(`| source_url あり | ${sourceCheck.has_url} | ${pct(sourceCheck.has_url, totalRows)}% | ${sourceCheck.has_url === totalRows ? "✅" : "⚠️"} |`);
lines.push(`| fetched_at あり | ${sourceCheck.has_fetched_at} | ${pct(sourceCheck.has_fetched_at, totalRows)}% | ${sourceCheck.has_fetched_at === totalRows ? "✅" : "❌"} |`);
lines.push(`| parser_version あり | ${sourceCheck.has_parser_ver} | ${pct(sourceCheck.has_parser_ver, totalRows)}% | ${sourceCheck.has_parser_ver === totalRows ? "✅" : "❌"} |`);
lines.push(``);
lines.push(`## 既存テーブルへの影響確認`);
lines.push(``);
lines.push(`| 確認 | 結果 |`);
lines.push(`|---|---|`);
lines.push(`| odds_snapshots に historical_closing_odds レコードなし | ${oddsSnapshotsCount === 0 ? "✅ なし" : "❌ " + oddsSnapshotsCount + "件あり（要確認）"} |`);
lines.push(`| odds_timeseries_snapshots に historical_closing_odds レコードなし | ${timeseriesCount === 0 ? "✅ なし" : "❌ " + timeseriesCount + "件あり（要確認）"} |`);
lines.push(``);

if (missingDetail.length > 0) {
  lines.push(`## 5買い目未満のレース（欠場等）`);
  lines.push(``);
  lines.push(`| race_id | 取得買い目数 | 取得済み | 備考 |`);
  lines.push(`|---|---:|---|---|`);
  for (const row of missingDetail) {
    lines.push(`| ${row.race_id} | ${row.n_combos}/5 | ${row.combos} | 欠場/非販売の可能性あり |`);
  }
  lines.push(``);
}

lines.push(`---`);
lines.push(``);
lines.push(`## 総合判定`);
lines.push(``);
const allOk = anomaly.zero_or_neg === 0 && anomaly.null_odds === 0
  && sameValueCheck.all_same === 0 && same132Rate < 10
  && sourceCheck.correct_type === totalRows && sourceCheck.correct_quality === totalRows
  && sourceCheck.is_backfill_1 === totalRows
  && oddsSnapshotsCount === 0 && timeseriesCount === 0;

lines.push(`**${allOk ? "✅ 品質良好。次回 --limit 200 --write へ進んでよい。" : "⚠️ 要確認項目あり。上記エラーを確認してください。"}**`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 注記`);
lines.push(``);
lines.push(`- 条件Bの 1-3-2 ROI は **事後計算**（race_payouts.payout_yen ベース）であり、事前 odds ベースの switch 評価ではない`);
lines.push(`- 事前代替 odds 不足のため switch 本採用不可`);
lines.push(`- **historical closing odds backfill ができても live/T-5 forward ではない**`);
lines.push(`- 現時点で採用可能なのは skip monitor のみ`);
lines.push(`- 条件B は n=200 到達後も、代替 odds が蓄積されなければ switch 採用不可`);
lines.push(`- switch は必ず future-only odds_timeseries で再確認する`);
lines.push(``);
lines.push(`---`);
lines.push(`*生成: check-historical-alternative-odds-quality.ts*`);

const md = lines.join("\n");
if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");

const jsonOutput = {
  generatedAt: now,
  tableExists,
  basic,
  with5Sels,
  with4Sels,
  condBInTable,
  byCombo,
  sameValueCheck,
  anomaly,
  sourceCheck,
  existingTablesContaminated: { oddsSnapshotsCount, timeseriesCount },
  missingDetail,
  allOk,
};
writeFileSync(OUT_JSON, JSON.stringify(jsonOutput, null, 2), "utf-8");

console.log("=== historical_alternative_odds 品質チェック ===");
console.log(`総レコード: ${totalRows} / ユニーク race: ${basic.total_races}`);
console.log(`5買い目揃い: ${with5Sels}/${basic.total_races} (${pct(with5Sels, basic.total_races)}%)`);
console.log(`condB該当: ${condBInTable} / 同値率: ${same132Rate}% / 全同値: ${sameValueCheck.all_same}`);
console.log(`異常値: zero_or_neg=${anomaly.zero_or_neg} / null=${anomaly.null_odds}`);
console.log(`既存テーブル汚染: odds_snapshots=${oddsSnapshotsCount} / timeseries=${timeseriesCount}`);
console.log(`総合: ${allOk ? "✅ 品質良好" : "⚠️ 要確認"}`);
console.log();
console.log(`出力: ${OUT_MD}`);
console.log(`出力: ${OUT_JSON}`);
