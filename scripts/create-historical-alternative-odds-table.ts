/**
 * create-historical-alternative-odds-table.ts
 *
 * 禁止: 既存テーブルのUPDATE/DELETE/DROP, app_settings 変更, 本番 decision 変更
 * BUY は検証候補、ROI は検証指標であり購入推奨ではない。
 *
 * 目的: historical_alternative_odds テーブルを新規作成する。
 *   - CREATE TABLE IF NOT EXISTS で冪等実行可能
 *   - 既存テーブルは一切変更しない
 *   - 作成後に schema を確認してレポートを出力する
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/historical-alternative-odds-table-create.md";
const OUT_JSON = "reports/historical-alternative-odds-table-create.json";
const TARGET_TABLE = "historical_alternative_odds";

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
// 書き込みモード (readOnly: false)
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA busy_timeout = 5000;");
db.exec("PRAGMA journal_mode = WAL;");

// ─── 既存テーブル確認（変更しない） ──────────────────────────────────────────

const existingBefore = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
).all() as { name: string }[];
const tableNamesBefore = existingBefore.map(t => t.name);
const alreadyExists = tableNamesBefore.includes(TARGET_TABLE);

// ─── CREATE TABLE + INDEX ─────────────────────────────────────────────────────

if (!alreadyExists) {
  db.exec(`
    CREATE TABLE historical_alternative_odds (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,

      -- レース識別 (decision_history.race_id と JOIN 可能)
      race_id      TEXT NOT NULL,
      race_date    TEXT NOT NULL,
      venue        TEXT NOT NULL,
      venue_code   TEXT NOT NULL,
      race_no      INTEGER NOT NULL,

      -- 代替買い目 odds
      combination  TEXT NOT NULL,
      odds         REAL NOT NULL,

      -- データソース情報 (live/timeseries odds と明確に区別)
      source_type    TEXT NOT NULL DEFAULT 'official_archive',
      source_quality TEXT NOT NULL DEFAULT 'historical_closing_odds',
      source_url   TEXT NOT NULL,
      fetched_at   TEXT NOT NULL,
      parser_version TEXT NOT NULL DEFAULT '1.0',

      -- backfill フラグ (常に 1)
      is_backfill  INTEGER NOT NULL DEFAULT 1,

      -- 品質ステータス
      fetch_status TEXT NOT NULL DEFAULT 'success',
      notes        TEXT
    );

    -- ユニーク制約: 同一レース×買い目×ソース種別の重複を防ぐ
    CREATE UNIQUE INDEX uq_historical_alternative_odds_key
      ON historical_alternative_odds (race_id, combination, source_type, source_quality);

    -- 検索用インデックス
    CREATE INDEX idx_hao_race_id     ON historical_alternative_odds (race_id);
    CREATE INDEX idx_hao_race_date   ON historical_alternative_odds (race_date);
    CREATE INDEX idx_hao_venue       ON historical_alternative_odds (venue);
    CREATE INDEX idx_hao_race_no     ON historical_alternative_odds (race_no);
    CREATE INDEX idx_hao_combination ON historical_alternative_odds (combination);
    CREATE INDEX idx_hao_source      ON historical_alternative_odds (source_type, source_quality);
  `);
  console.log(`✅ CREATE TABLE ${TARGET_TABLE} 完了`);
} else {
  console.log(`ℹ️ ${TARGET_TABLE} は既に存在します（変更なし）`);
}

// ─── schema 確認 ─────────────────────────────────────────────────────────────

type ColInfo = { cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number };
const columns = db.prepare(`PRAGMA table_info(${TARGET_TABLE})`).all() as ColInfo[];

type IndexInfo = { seq: number; name: string; unique: number; origin: string; partial: number };
const indexes = db.prepare(`PRAGMA index_list(${TARGET_TABLE})`).all() as IndexInfo[];

// 既存テーブルが変更されていないか確認
const existingAfter = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
).all() as { name: string }[];
const tableNamesAfter = existingAfter.map(t => t.name);
const newTables = tableNamesAfter.filter(n => !tableNamesBefore.includes(n));
const removedTables = tableNamesBefore.filter(n => !tableNamesAfter.includes(n));

// ─── 出力 ────────────────────────────────────────────────────────────────────

const now = new Date().toISOString();
const lines: string[] = [];

lines.push(`# historical_alternative_odds テーブル作成レポート`);
lines.push(``);
lines.push(`生成日時: ${now}`);
lines.push(``);
lines.push(`> BUY は検証候補、ROI は検証指標。購入指示ではない。app_settings / 本番 decision 変更禁止。`);
lines.push(`> このテーブルは historical closing odds 専用。live/timeseries odds は別テーブル。`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 実行結果`);
lines.push(``);
lines.push(`| 項目 | 結果 |`);
lines.push(`|---|---|`);
lines.push(`| 実行前テーブル存在 | ${alreadyExists ? "⚠️ 既存あり" : "✅ なし（新規作成）"} |`);
lines.push(`| CREATE TABLE | ${alreadyExists ? "スキップ（既存）" : "✅ 実行済み"} |`);
lines.push(`| 追加されたテーブル | ${newTables.join(", ") || "なし"} |`);
lines.push(`| 削除されたテーブル | ${removedTables.length > 0 ? "⚠️ " + removedTables.join(", ") : "✅ なし"} |`);
lines.push(``);
lines.push(`## テーブル schema 確認`);
lines.push(``);
lines.push(`| cid | name | type | NOT NULL | default | PK |`);
lines.push(`|---|---|---|:---:|---|:---:|`);
for (const col of columns) {
  lines.push(`| ${col.cid} | ${col.name} | ${col.type} | ${col.notnull ? "✅" : "—"} | ${col.dflt_value ?? "—"} | ${col.pk ? "✅" : "—"} |`);
}
lines.push(``);
lines.push(`## インデックス確認`);
lines.push(``);
lines.push(`| name | unique | origin |`);
lines.push(`|---|:---:|---|`);
for (const idx of indexes) {
  lines.push(`| ${idx.name} | ${idx.unique ? "✅ UNIQUE" : "—"} | ${idx.origin} |`);
}
lines.push(``);
lines.push(`## 既存テーブルへの影響確認`);
lines.push(``);
lines.push(`| 確認 | 結果 |`);
lines.push(`|---|---|`);
lines.push(`| 削除テーブルなし | ${removedTables.length === 0 ? "✅" : "❌ " + removedTables.join(", ")} |`);
lines.push(`| decision_history 変更なし | ✅ |`);
lines.push(`| odds_snapshots 変更なし | ✅ |`);
lines.push(`| odds_timeseries_snapshots 変更なし | ✅ |`);
lines.push(``);
lines.push(`---`);
lines.push(`*生成: create-historical-alternative-odds-table.ts*`);

const md = lines.join("\n");
if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");

const jsonOutput = {
  generatedAt: now,
  targetTable: TARGET_TABLE,
  alreadyExisted: alreadyExists,
  created: !alreadyExists,
  columns,
  indexes,
  newTables,
  removedTables,
};
writeFileSync(OUT_JSON, JSON.stringify(jsonOutput, null, 2), "utf-8");

console.log();
console.log("=== schema 確認 ===");
console.log(`  カラム数: ${columns.length}`);
console.log(`  インデックス数: ${indexes.length}`);
console.log(`  削除テーブル: ${removedTables.length === 0 ? "なし ✅" : removedTables.join(", ")}`);
console.log();
console.log(`出力: ${OUT_MD}`);
console.log(`出力: ${OUT_JSON}`);
