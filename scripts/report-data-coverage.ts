/**
 * データカバレッジレポート
 *
 * docs/data-roadmap.md に記載した 7 項目について、SQLite DB の
 * テーブル/カラムの存在とレコード数を確認し、OK / PARTIAL / MISSING で表示する。
 *
 * usage:
 *   npx tsx scripts/report-data-coverage.ts
 *   npx tsx scripts/report-data-coverage.ts --json
 *
 * DB パス優先順:
 *   1. 環境変数 BOAT_PON_DB_PATH
 *   2. data/boat.sqlite  (プロジェクト標準)
 *   3. data/boat-pon.db
 *   4. data/boatrace.db
 *   5. boat-pon.db
 *   6. boatrace.db
 *
 * 注意:
 * - このスクリプトはデータ収集・投票処理を一切行わない（読み取り専用診断）
 * - 自動投票は絶対に禁止
 * - DB が存在しない場合は全項目 MISSING で出力（クラッシュしない）
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

type Status = "OK" | "PARTIAL" | "MISSING";

type CoverageItem = {
  id: number;
  name: string;
  status: Status;
  detail: string;
  tables: string[];
  recordCount: number | null;
};

// ---------- DB 検索 ----------

const DB_CANDIDATES: string[] = [
  process.env.BOAT_PON_DB_PATH ?? "",
  "data/boat.sqlite",
  "data/boat-pon.db",
  "data/boatrace.db",
  "boat-pon.db",
  "boatrace.db",
].filter(Boolean);

function findDb(): string | null {
  for (const p of DB_CANDIDATES) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

// ---------- DB ヘルパー ----------

function openDb(path: string): DatabaseSync | null {
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    db.exec("PRAGMA busy_timeout = 3000");
    return db;
  } catch {
    return null;
  }
}

function tableExists(db: DatabaseSync, table: string): boolean {
  try {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(table) as { name: string } | undefined;
    return row != null;
  } catch {
    return false;
  }
}

function columnExists(db: DatabaseSync, table: string, column: string): boolean {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return cols.some((c) => c.name === column);
  } catch {
    return false;
  }
}

function countSql(db: DatabaseSync, sql: string): number {
  try {
    const row = db.prepare(sql).get() as { n: number } | undefined;
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

// ---------- カバレッジチェック ----------

function buildReport(db: DatabaseSync | null): CoverageItem[] {
  const items: CoverageItem[] = [];

  // 1. 結果データ
  {
    const table = "race_results";
    let status: Status = "MISSING";
    let detail = "race_results テーブルなし";
    let n: number | null = null;

    if (db && tableExists(db, table)) {
      n = countSql(db, "SELECT COUNT(*) AS n FROM race_results");
      if (n > 10000) {
        status = "OK";
        detail = `race_results ${n.toLocaleString()}件 (trifecta/payout_yen/popularity/returned あり)`;
      } else if (n > 0) {
        status = "PARTIAL";
        detail = `race_results ${n}件のみ（件数不足）`;
      } else {
        detail = "race_results は空";
      }
    }

    items.push({ id: 1, name: "結果データ", status, detail, tables: [table], recordCount: n });
  }

  // 2. 締切直前オッズ
  {
    const table = "odds_snapshots";
    let status: Status = "MISSING";
    let detail = "odds_snapshots テーブルなし";
    let n: number | null = null;

    if (db && tableExists(db, table)) {
      const totalN = countSql(db, "SELECT COUNT(*) AS n FROM odds_snapshots");
      const hasFinalCol = columnExists(db, table, "is_final_like");

      if (!hasFinalCol) {
        status = "PARTIAL";
        n = totalN;
        detail = `odds_snapshots ${totalN.toLocaleString()}件（is_final_like カラムなし）`;
      } else {
        const finalN = countSql(db, "SELECT COUNT(*) AS n FROM odds_snapshots WHERE is_final_like=1");
        n = finalN;
        if (finalN > 1000) {
          status = "OK";
          detail = `odds_snapshots 計${totalN.toLocaleString()}件 / 締切直前(is_final_like=1): ${finalN.toLocaleString()}件`;
        } else if (totalN > 0) {
          status = "PARTIAL";
          detail = `odds_snapshots ${totalN.toLocaleString()}件 / 締切直前スナップショット ${finalN}件のみ`;
        } else {
          detail = "odds_snapshots は空";
        }
      }
    }

    items.push({ id: 2, name: "締切直前オッズ", status, detail, tables: [table], recordCount: n });
  }

  // 3. 現在オッズと必要オッズの差
  {
    const table = "decision_history";
    let status: Status = "MISSING";
    let detail = "decision_history テーブルなし";
    let n: number | null = null;

    if (db && tableExists(db, table)) {
      const hasCurrent = columnExists(db, table, "current_odds");
      const hasRequired = columnExists(db, table, "required_odds");

      if (hasCurrent && hasRequired) {
        n = countSql(db,
          "SELECT COUNT(*) AS n FROM decision_history WHERE current_odds IS NOT NULL AND required_odds IS NOT NULL"
        );
        if (n > 0) {
          status = "OK";
          detail = `decision_history に current_odds・required_odds 両カラムあり (${n.toLocaleString()}件)。ratio は都度計算`;
        } else {
          status = "PARTIAL";
          detail = "current_odds・required_odds カラムあり。非 NULL レコードなし";
        }
      } else {
        status = "PARTIAL";
        detail = `current_odds: ${hasCurrent} / required_odds: ${hasRequired}（片方なし）`;
        n = countSql(db, "SELECT COUNT(*) AS n FROM decision_history");
      }
    }

    items.push({ id: 3, name: "現在オッズと必要オッズの差", status, detail, tables: [table], recordCount: n });
  }

  // 4. 天候・風・波
  {
    const table = "race_weather";
    let status: Status = "MISSING";
    let detail = "race_weather テーブルなし";
    let n: number | null = null;

    if (db && tableExists(db, table)) {
      n = countSql(db, "SELECT COUNT(*) AS n FROM race_weather WHERE wind_speed_mps IS NOT NULL OR wave_height_cm IS NOT NULL");
      const total = countSql(db, "SELECT COUNT(*) AS n FROM race_weather");
      if (n > 10000) {
        status = "OK";
        detail = `race_weather ${total.toLocaleString()}件`;
      } else if (n > 0) {
        status = "PARTIAL";
        detail = `race_weather ${total}件のみ（自動取得が疎）。auto-fetch-exhibition の安定稼働が必要`;
      } else {
        detail = "race_weather は空";
      }
    }

    items.push({ id: 4, name: "天候・風・波", status, detail, tables: [table], recordCount: n });
  }

  // 5. 展示タイム
  {
    const table = "exhibition_data";
    let status: Status = "MISSING";
    let detail = "exhibition_data テーブルなし";
    let n: number | null = null;

    if (db && tableExists(db, table)) {
      n = countSql(db, "SELECT COUNT(*) AS n FROM exhibition_data WHERE exhibition_time IS NOT NULL");
      const total = countSql(db, "SELECT COUNT(*) AS n FROM exhibition_data");
      if (n > 10000) {
        status = "OK";
        detail = `exhibition_data ${total.toLocaleString()}件（exhibition_time: ${n.toLocaleString()}件）`;
      } else if (n > 0) {
        status = "PARTIAL";
        detail = `exhibition_data ${total}件のみ（auto-fetch-exhibition の網羅率向上が必要）`;
      } else {
        detail = "exhibition_data は空または exhibition_time がすべて NULL";
      }
    }

    items.push({ id: 5, name: "展示タイム", status, detail, tables: [table], recordCount: n });
  }

  // 6. チルト・部品交換
  {
    let status: Status = "MISSING";
    let detail = "race_equipment テーブルなし";
    let n: number | null = null;
    const tables: string[] = ["race_equipment"];

    if (db && tableExists(db, "race_equipment")) {
      const total = countSql(db, "SELECT COUNT(*) AS n FROM race_equipment");
      const tiltN = countSql(db, "SELECT COUNT(*) AS n FROM race_equipment WHERE tilt_angle IS NOT NULL");
      const partsN = countSql(db, "SELECT COUNT(*) AS n FROM race_equipment WHERE parts_changed_count > 0 OR propeller_changed = 1");
      n = total;
      if (total > 10000 && tiltN > 10000) {
        status = "OK";
        detail = `race_equipment ${total.toLocaleString()}件（チルト ${tiltN.toLocaleString()}件 / 部品・プロペラ交換 ${partsN.toLocaleString()}件）`;
      } else if (total > 0) {
        status = "PARTIAL";
        detail = `race_equipment ${total}件（チルト ${tiltN}件 / 部品・プロペラ交換 ${partsN}件）。beforeinfo取得の蓄積が必要`;
      } else {
        detail = "race_equipment は空";
      }
    }

    items.push({ id: 6, name: "チルト・部品交換", status, detail, tables, recordCount: n });
  }

  // 7. モーター/ボート成績
  {
    let status: Status = "MISSING";
    let detail = "";
    let n: number | null = null;
    const tables: string[] = [];

    const hasPrograms = db != null && tableExists(db, "official_programs");
    const hasProfiles = db != null && tableExists(db, "racer_profiles");
    const hasCourseStats = db != null && tableExists(db, "racer_course_stats");

    if (hasPrograms) tables.push("official_programs");
    if (hasProfiles) tables.push("racer_profiles");
    if (hasCourseStats) tables.push("racer_course_stats");

    let motorN = 0;
    if (hasPrograms && db) {
      motorN = countSql(db,
        "SELECT COUNT(*) AS n FROM official_programs WHERE raw_json LIKE '%motorTop2Rate%'"
      );
      n = motorN;
    }

    if (motorN > 10000) {
      status = "PARTIAL"; // raw_json 経由なので PARTIAL（専用インデックスなし）
      const profileN = hasProfiles ? countSql(db!, "SELECT COUNT(*) AS n FROM racer_profiles") : 0;
      detail = `official_programs.raw_json に motorTop2Rate/boatTop2Rate: ${motorN.toLocaleString()}件`
        + (hasProfiles ? `  racer_profiles: ${profileN.toLocaleString()}件` : "")
        + "  専用インデックステーブルなし（JSON解析で対応）";
    } else if (hasProfiles) {
      status = "PARTIAL";
      const profileN = countSql(db!, "SELECT COUNT(*) AS n FROM racer_profiles");
      detail = `racer_profiles: ${profileN}件。motorTop2Rate は official_programs.raw_json 経由（未収集または件数不足）`;
    } else {
      detail = "official_programs / racer_profiles テーブルなし";
    }

    items.push({ id: 7, name: "モーター/ボート成績", status, detail, tables, recordCount: n });
  }

  return items;
}

// ---------- 出力 ----------

function printText(dbPath: string | null, items: CoverageItem[]) {
  const statusLabel: Record<Status, string> = {
    OK: "✅ OK     ",
    PARTIAL: "⚠️  PARTIAL",
    MISSING: "❌ MISSING",
  };

  console.log("=== データカバレッジレポート ===");
  console.log(`生成: ${new Date().toISOString()}`);
  console.log(`DB:   ${dbPath ?? "（見つからず — 全項目 MISSING）"}`);
  console.log("");

  for (const item of items) {
    console.log(`${item.id}. ${item.name}`);
    console.log(`   ${statusLabel[item.status]}  ${item.detail}`);
    if (item.tables.length > 0) {
      console.log(`   テーブル: ${item.tables.join(", ")}`);
    }
    console.log("");
  }

  const ok = items.filter((i) => i.status === "OK").length;
  const partial = items.filter((i) => i.status === "PARTIAL").length;
  const missing = items.filter((i) => i.status === "MISSING").length;
  console.log(`サマリー:  ✅ OK=${ok}  ⚠️ PARTIAL=${partial}  ❌ MISSING=${missing}  / ${items.length}項目`);
  console.log("詳細: docs/data-roadmap.md");
}

function printJson(dbPath: string | null, items: CoverageItem[]) {
  const ok = items.filter((i) => i.status === "OK").length;
  const partial = items.filter((i) => i.status === "PARTIAL").length;
  const missing = items.filter((i) => i.status === "MISSING").length;

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        dbPath,
        summary: { ok, partial, missing, total: items.length },
        items,
      },
      null,
      2,
    ),
  );
}

// ---------- main ----------

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");

const dbPath = findDb();
const db = dbPath ? openDb(dbPath) : null;
const items = buildReport(db);
if (db) { try { db.close(); } catch { /* ignore */ } }

if (jsonMode) {
  printJson(dbPath, items);
} else {
  printText(dbPath, items);
}
