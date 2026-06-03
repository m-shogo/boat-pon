/**
 * decision_history に判定理由・特徴量内訳の保存先を追加する安全migration。
 *
 * - 既存データは削除しない
 * - DROP TABLE しない
 * - 何度実行しても既存カラムはスキップする
 * - 外部サイトアクセス・自動投票・ログイン操作は行わない
 */

import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA busy_timeout = 5000");

try {
  addColumn("decision_history", "decision_reasons", "TEXT NOT NULL DEFAULT '[]'");
  addColumn("decision_history", "feature_adjustment", "REAL");
  addColumn("decision_history", "feature_adjustment_breakdown", "TEXT");

  db.exec(`
CREATE INDEX IF NOT EXISTS idx_decision_history_model_run_date
ON decision_history (model_version, run_kind, date, decision);
`);

  console.log("[migrate-decision-audit] done");
} finally {
  db.close();
}

function addColumn(table: string, column: string, definition: string) {
  if (columnExists(table, column)) {
    console.log(`[migrate-decision-audit] skip existing: ${table}.${column}`);
    return;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`[migrate-decision-audit] added: ${table}.${column}`);
}

function columnExists(table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}
