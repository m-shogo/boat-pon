/**
 * design-historical-alternative-odds-storage.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 * BUY は検証候補、ROI は検証指標であり購入推奨ではない。
 *
 * 目的: historical_alternative_odds テーブルの設計案を出力する。
 *   今回はSQL案・型・制約のみ出力する。実DBへのCREATE TABLE実行はしない。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/historical-alternative-odds-storage-design.md";
const OUT_JSON = "reports/historical-alternative-odds-storage-design.json";

const FORWARD_START = "2025-01-01";
const EXCL_VENUES   = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES    = [10, 11, 12];
const TARGET_SELS   = ["1-2-3", "1-3-2", "1-2-4", "1-4-2", "1-3-4"] as const;

const WIND24 = `EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id
  AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)`;
const EXH1   = `EXISTS (SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=1
    AND ed.exhibition_time IS NOT NULL
    AND ed.exhibition_time = (SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2
      WHERE ed2.race_id=dh.race_id))`;

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

const excl_v = EXCL_VENUES.map(v => `'${v}'`).join(",");
const excl_r = EXCL_RACES.join(",");

// ─── 既存テーブル確認 ─────────────────────────────────────────────────────────

const existingTables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
).all() as { name: string }[];
const tableNames = existingTables.map(t => t.name);
const targetTableExists = tableNames.includes("historical_alternative_odds");

// ─── forward BUY 件数と内訳 ───────────────────────────────────────────────────

type ForwardStat = { total: number; condB: number; r6: number; hamanako: number; suminoe: number; other: number };
const fwdStat = db.prepare(`
  WITH fwd AS (
    SELECT dh.race_id, dh.venue, dh.race_no,
      CASE WHEN ${WIND24} AND ${EXH1} THEN 1 ELSE 0 END is_condB
    FROM decision_history dh
    WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
      AND dh.result IS NOT NULL AND dh.result != ''
      AND dh.current_odds IS NOT NULL
      AND dh.venue NOT IN (${excl_v})
      AND dh.race_no NOT IN (${excl_r})
      AND dh.selection='1-2-3'
      AND dh.date >= '${FORWARD_START}'
  )
  SELECT
    COUNT(*) total,
    SUM(is_condB) condB,
    SUM(CASE WHEN race_no=6 THEN 1 ELSE 0 END) r6,
    SUM(CASE WHEN venue='浜名湖' THEN 1 ELSE 0 END) hamanako,
    SUM(CASE WHEN venue='住之江' THEN 1 ELSE 0 END) suminoe,
    SUM(CASE WHEN is_condB=0 AND race_no!=6 AND venue NOT IN ('浜名湖','住之江') THEN 1 ELSE 0 END) other
  FROM fwd
`).get() as ForwardStat;

const totalRecords = fwdStat.total * TARGET_SELS.length;

// ─── CREATE TABLE SQL 案 ──────────────────────────────────────────────────────

const CREATE_TABLE_SQL = `-- ⚠️ 設計案のみ。今回は実行しない。実行は次フェーズで確認後に行う。
CREATE TABLE historical_alternative_odds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,

  -- レース識別 (decision_history.race_id と JOIN 可能)
  race_id      TEXT NOT NULL,
  race_date    TEXT NOT NULL,  -- YYYY-MM-DD
  venue        TEXT NOT NULL,
  venue_code   TEXT NOT NULL,  -- 2桁場コード (01〜24)
  race_no      INTEGER NOT NULL,

  -- 代替買い目 odds
  combination  TEXT NOT NULL,  -- '1-2-3' / '1-3-2' / '1-2-4' / '1-4-2' / '1-3-4'
  odds         REAL NOT NULL,

  -- データソース情報 (live odds / timeseries odds と明確に区別する)
  source_type    TEXT NOT NULL DEFAULT 'official_archive',
  source_quality TEXT NOT NULL DEFAULT 'historical_closing_odds',
  -- source_quality: 'historical_closing_odds' のみ使用。
  --   live_odds / t5_odds / timeseries_odds とは絶対に混同しない。

  source_url   TEXT NOT NULL,  -- 取得元 URL
  fetched_at   TEXT NOT NULL,  -- ISO8601 取得日時
  parser_version TEXT NOT NULL DEFAULT '1.0',

  -- backfill フラグ
  is_backfill  INTEGER NOT NULL DEFAULT 1,  -- 常に 1 (後日補完)

  -- 品質ステータス
  fetch_status TEXT NOT NULL DEFAULT 'success',
  -- 'success' / 'fetch_error' / 'parse_error' / 'no_odds_found'

  notes        TEXT  -- 備考 (parse失敗理由等)
);

-- ユニーク制約: 同一レース×買い目×ソース種別の重複を防ぐ
CREATE UNIQUE INDEX uq_historical_alternative_odds_key
  ON historical_alternative_odds (race_id, combination, source_type, source_quality);

-- 検索用インデックス
CREATE INDEX idx_hao_race_id    ON historical_alternative_odds (race_id);
CREATE INDEX idx_hao_race_date  ON historical_alternative_odds (race_date);
CREATE INDEX idx_hao_venue      ON historical_alternative_odds (venue);
CREATE INDEX idx_hao_race_no    ON historical_alternative_odds (race_no);
CREATE INDEX idx_hao_combination ON historical_alternative_odds (combination);
CREATE INDEX idx_hao_source     ON historical_alternative_odds (source_type, source_quality);`;

// ─── 出力 ─────────────────────────────────────────────────────────────────────

const now = new Date().toISOString();
const lines: string[] = [];

lines.push(`# historical_alternative_odds テーブル設計案`);
lines.push(``);
lines.push(`生成日時: ${now}`);
lines.push(``);
lines.push(`> ⚠️ **設計案のみ。今回は実DBへのCREATE TABLE実行なし。**`);
lines.push(`> **DB書き込みは次フェーズで dry-run 確認後に行う。**`);
lines.push(`> BUY は検証候補、ROI は検証指標。購入指示ではない。app_settings / 本番 decision 変更禁止。`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 現状確認`);
lines.push(``);
lines.push(`| 項目 | 値 |`);
lines.push(`|---|---|`);
lines.push(`| テーブル存在確認 | ${targetTableExists ? "⚠️ 既存あり" : "✅ 未作成（設計案のみ）"} |`);
lines.push(`| forward BUY 総件数 | ${fwdStat.total} |`);
lines.push(`| 取得対象レコード予定 | ${totalRecords}件 (${fwdStat.total}races × 5買い目) |`);
lines.push(`| うち条件B | ${fwdStat.condB} |`);
lines.push(`| うち6R | ${fwdStat.r6} |`);
lines.push(`| うち浜名湖 | ${fwdStat.hamanako} |`);
lines.push(`| うち住之江 | ${fwdStat.suminoe} |`);
lines.push(`| うちその他 | ${fwdStat.other} |`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 既存テーブルに混ぜない理由`);
lines.push(``);
lines.push(`### odds_snapshots を使わない理由`);
lines.push(``);
lines.push(`| 理由 | 詳細 |`);
lines.push(`|---|---|`);
lines.push(`| 品質バグ | backfill 時に 1-3-2 = 1-2-3 が記録されたレコードが 124/125 件存在 |`);
lines.push(`| 意味が違う | odds_snapshots は「BUY 候補レースの事前odds取得記録」。historical closing は後日取得の締切時オッズ |`);
lines.push(`| source区別不能 | is_final_like / source カラムだけでは live/closing の区別が難しい |`);
lines.push(`| 将来の混乱を防ぐ | 分析時に historical closing と live odds が混在するとバイアスになる |`);
lines.push(``);
lines.push(`### odds_timeseries_snapshots を使わない理由`);
lines.push(``);
lines.push(`| 理由 | 詳細 |`);
lines.push(`|---|---|`);
lines.push(`| 設計目的が違う | timeseries は checkpoint (T-5/T-10/T-20/T-30) 別の事前odds。historical closing は締切後取得 |`);
lines.push(`| 期間が違う | timeseries は 2026-06 開始。forward BUY は 2025-01 〜。重複ゼロ |`);
lines.push(`| 混在禁止 | timeseries が将来 switch 分析の基準になる。historical closing を混入すると信頼性が崩れる |`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## historical closing odds と live/timeseries odds の違い`);
lines.push(``);
lines.push(`| 項目 | historical closing odds | live/timeseries odds |`);
lines.push(`|---|---|---|`);
lines.push(`| 取得タイミング | **後日取得**（公式アーカイブから事後収集） | リアルタイム（T-5/T-10等） |`);
lines.push(`| 信頼性 | 締切時の確定オッズに近い（変動あり） | 買い前の事前判断材料 |`);
lines.push(`| forward 分析に使えるか | **参考**（switch backtest）| ✅ 本来の事前 odds |`);
lines.push(`| switch 本採用の根拠になるか | ❌ 参考のみ（live での未検証） | 将来は ✅（timeseries n=200 後） |`);
lines.push(`| 変数名 / カラム名 | source_quality = 'historical_closing_odds' | checkpoint_label = 'T-5' 等 |`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## switch 分析で使える範囲`);
lines.push(``);
lines.push(`> ⚠️ **注意: switch 分析は historical closing odds だけでは本採用できない**`);
lines.push(``);
lines.push(`| 分析 | 使えるか | 条件 |`);
lines.push(`|---|---|---|`);
lines.push(`| historical switch backtest | ⚠️ 参考のみ | historical closing odds が揃えば可能 |`);
lines.push(`| forward switch 分析（正式） | ❌ 現在不可 | timeseries BUY forward 重複 n≥200 が条件 |`);
lines.push(`| switch 本採用 | ❌ 現在不可 | live/T-5 odds での未検証のため |`);
lines.push(`| skip monitor | ✅ 現行可能 | 既存 forward で実施中 |`);
lines.push(``);
lines.push(`**現時点で採用可能なのは skip monitor のみ。**`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## CREATE TABLE SQL 案`);
lines.push(``);
lines.push(`\`\`\`sql`);
lines.push(CREATE_TABLE_SQL);
lines.push(`\`\`\``);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## カラム定義`);
lines.push(``);
lines.push(`| カラム | 型 | NOT NULL | DEFAULT | 説明 |`);
lines.push(`|---|---|:---:|---|---|`);
lines.push(`| id | INTEGER | ✅ | AUTOINCREMENT | 主キー |`);
lines.push(`| race_id | TEXT | ✅ | — | decision_history.race_id と JOIN 可能 |`);
lines.push(`| race_date | TEXT | ✅ | — | YYYY-MM-DD |`);
lines.push(`| venue | TEXT | ✅ | — | 場名 |`);
lines.push(`| venue_code | TEXT | ✅ | — | 2桁場コード (01〜24) |`);
lines.push(`| race_no | INTEGER | ✅ | — | レース番号 |`);
lines.push(`| combination | TEXT | ✅ | — | 1-2-3 / 1-3-2 / 1-2-4 / 1-4-2 / 1-3-4 |`);
lines.push(`| odds | REAL | ✅ | — | 取得オッズ値 |`);
lines.push(`| source_type | TEXT | ✅ | official_archive | データソース種別 |`);
lines.push(`| source_quality | TEXT | ✅ | historical_closing_odds | live/timeseries と区別するラベル |`);
lines.push(`| source_url | TEXT | ✅ | — | 取得元 URL |`);
lines.push(`| fetched_at | TEXT | ✅ | — | ISO8601 取得日時 |`);
lines.push(`| parser_version | TEXT | ✅ | 1.0 | パーサーバージョン |`);
lines.push(`| is_backfill | INTEGER | ✅ | 1 | 常に 1 (後日補完フラグ) |`);
lines.push(`| fetch_status | TEXT | ✅ | success | success / fetch_error / parse_error / no_odds_found |`);
lines.push(`| notes | TEXT | — | NULL | 備考 |`);
lines.push(``);
lines.push(`## ユニーク制約`);
lines.push(``);
lines.push(`\`\`\`sql`);
lines.push(`-- 同一レース×買い目×ソース種別の重複を防ぐ`);
lines.push(`CREATE UNIQUE INDEX uq_historical_alternative_odds_key`);
lines.push(`  ON historical_alternative_odds (race_id, combination, source_type, source_quality);`);
lines.push(`\`\`\``);
lines.push(``);
lines.push(`## インデックス案`);
lines.push(``);
lines.push(`| インデックス | カラム | 目的 |`);
lines.push(`|---|---|---|`);
lines.push(`| uq_key | race_id, combination, source_type, source_quality | UNIQUE / 重複防止 |`);
lines.push(`| idx_race_id | race_id | decision_history との JOIN |`);
lines.push(`| idx_race_date | race_date | 期間フィルター |`);
lines.push(`| idx_venue | venue | 会場別集計 |`);
lines.push(`| idx_race_no | race_no | raceNo別集計 |`);
lines.push(`| idx_combination | combination | 買い目別集計 |`);
lines.push(`| idx_source | source_type, source_quality | ソース種別フィルター |`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## backfill 優先順位`);
lines.push(``);
lines.push(`| 優先度 | 区分 | n | 理由 |`);
lines.push(`|---|---|---:|---|`);
lines.push(`| A | 条件B該当 | ${fwdStat.condB} | switch検証の主対象 |`);
lines.push(`| B | 6R | ${fwdStat.r6} | skip候補の検証 |`);
lines.push(`| C | 浜名湖+住之江 | ${fwdStat.hamanako + fwdStat.suminoe} | skip候補の検証 |`);
lines.push(`| D | 6R+浜名湖+住之江 | ${fwdStat.r6 + fwdStat.hamanako + fwdStat.suminoe} | 重複含む |`);
lines.push(`| E | その他のforward BUY | ${fwdStat.other} | 全体 backfill |`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 注記（必須）`);
lines.push(``);
lines.push(`- 条件Bの 1-3-2 ROI は **事後計算**（race_payouts.payout_yen ベース）であり、事前 odds ベースの switch 評価ではない`);
lines.push(`- 事前代替 odds 不足のため switch 本採用不可`);
lines.push(`- **historical closing odds backfill ができても live/T-5 forward ではない**`);
lines.push(`- 現時点で採用可能なのは skip monitor のみ`);
lines.push(`- 条件B は n=200 到達後も、代替 odds が蓄積されなければ switch 採用不可`);
lines.push(`- historical closing odds で良くても、live/T-5 odds で未検証なら switch 本採用不可`);
lines.push(`- switch は必ず future-only odds_timeseries で再確認する`);
lines.push(``);
lines.push(`---`);
lines.push(`*生成: design-historical-alternative-odds-storage.ts*`);

const md = lines.join("\n");
if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");

const jsonOutput = {
  generatedAt: now,
  targetTableExists,
  forwardStats: fwdStat,
  estimatedTotalRecords: totalRecords,
  createTableSql: CREATE_TABLE_SQL,
  columns: [
    { name: "id", type: "INTEGER", notNull: true, default: "AUTOINCREMENT", note: "主キー" },
    { name: "race_id", type: "TEXT", notNull: true, note: "decision_history.race_id と JOIN 可能" },
    { name: "race_date", type: "TEXT", notNull: true, note: "YYYY-MM-DD" },
    { name: "venue", type: "TEXT", notNull: true, note: "場名" },
    { name: "venue_code", type: "TEXT", notNull: true, note: "2桁場コード" },
    { name: "race_no", type: "INTEGER", notNull: true, note: "レース番号" },
    { name: "combination", type: "TEXT", notNull: true, note: "1-2-3 等 5択" },
    { name: "odds", type: "REAL", notNull: true, note: "取得オッズ" },
    { name: "source_type", type: "TEXT", notNull: true, default: "official_archive" },
    { name: "source_quality", type: "TEXT", notNull: true, default: "historical_closing_odds" },
    { name: "source_url", type: "TEXT", notNull: true },
    { name: "fetched_at", type: "TEXT", notNull: true },
    { name: "parser_version", type: "TEXT", notNull: true, default: "1.0" },
    { name: "is_backfill", type: "INTEGER", notNull: true, default: 1 },
    { name: "fetch_status", type: "TEXT", notNull: true, default: "success" },
    { name: "notes", type: "TEXT", notNull: false },
  ],
  uniqueConstraint: ["race_id", "combination", "source_type", "source_quality"],
  indexes: [
    { name: "uq_key", columns: ["race_id", "combination", "source_type", "source_quality"], unique: true },
    { name: "idx_race_id", columns: ["race_id"] },
    { name: "idx_race_date", columns: ["race_date"] },
    { name: "idx_venue", columns: ["venue"] },
    { name: "idx_race_no", columns: ["race_no"] },
    { name: "idx_combination", columns: ["combination"] },
    { name: "idx_source", columns: ["source_type", "source_quality"] },
  ],
  backfillPriority: [
    { priority: "A", label: "condB", n: fwdStat.condB },
    { priority: "B", label: "6R", n: fwdStat.r6 },
    { priority: "C", label: "浜名湖+住之江", n: fwdStat.hamanako + fwdStat.suminoe },
    { priority: "D", label: "6R+浜名湖+住之江", n: fwdStat.r6 + fwdStat.hamanako + fwdStat.suminoe },
    { priority: "E", label: "allForward", n: fwdStat.total },
  ],
  notes: [
    "条件Bの1-3-2 ROIは事後計算（事前oddsベースではない）",
    "事前代替odds不足のためswitch本採用不可",
    "historical closing odds backfillができてもlive/T-5 forwardではない",
    "現時点で採用可能なのはskip monitorのみ",
    "条件Bはn=200到達しても代替odds蓄積なしではswitch採用不可",
  ],
};
writeFileSync(OUT_JSON, JSON.stringify(jsonOutput, null, 2), "utf-8");

console.log("=== historical_alternative_odds テーブル設計案 ===");
console.log(`テーブル存在: ${targetTableExists ? "⚠️ 既存あり" : "✅ 未作成"}`);
console.log(`forward BUY: ${fwdStat.total}件 → 保存予定 ${totalRecords}件 (×5買い目)`);
console.log(`  condB: ${fwdStat.condB} / 6R: ${fwdStat.r6} / 浜名湖: ${fwdStat.hamanako} / 住之江: ${fwdStat.suminoe} / 他: ${fwdStat.other}`);
console.log();
console.log(`出力: ${OUT_MD}`);
console.log(`出力: ${OUT_JSON}`);
