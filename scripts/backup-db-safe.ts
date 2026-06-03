/**
 * WAL-safe SQLite backup.
 *
 * data/boat.sqlite は WAL mode で動くため、DB本体の単純コピーでは最新状態を取りこぼす可能性がある。
 * このスクリプトは PRAGMA wal_checkpoint(FULL) + VACUUM INTO で一貫したDBを保存する。
 *
 * - 既存DBは削除しない
 * - data/ は削除しない
 * - backups/ の世代管理のみ行う
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const BACKUP_ROOT = "backups";
const SQLITE_DB = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const MAX_BACKUPS = Number(process.env.BOAT_PON_MAX_BACKUPS ?? 30);
const EXTRA_TARGETS = [
  "data/run-cursors.json",
  "data/boat-pon.db",
];

const dest = join(BACKUP_ROOT, timestampDir());
mkdirSync(dest, { recursive: true });

let copied = 0;
copied += backupSqlite(dest);
copied += copyExtraTargets(dest);
pruneOldBackups();

console.log(`[backup-safe] done: ${dest} files=${copied}`);

function backupSqlite(destDir: string): number {
  if (!existsSync(SQLITE_DB)) {
    console.log(`[backup-safe] skip sqlite not found: ${SQLITE_DB}`);
    return 0;
  }

  const dbFileName = SQLITE_DB.split("/").pop() || "boat.sqlite";
  const destFile = join(destDir, dbFileName);
  const db = new DatabaseSync(SQLITE_DB);

  try {
    db.exec("PRAGMA busy_timeout = 30000;");
    db.exec("PRAGMA wal_checkpoint(FULL);");
    db.exec(`VACUUM INTO ${sqlQuote(destFile)};`);
  } finally {
    db.close();
  }

  const size = statSync(destFile).size;
  console.log(`[backup-safe] sqlite ${SQLITE_DB} -> ${destFile} (${formatKb(size)} KB)`);
  return 1;
}

function copyExtraTargets(destDir: string): number {
  let count = 0;
  for (const src of EXTRA_TARGETS) {
    if (!existsSync(src)) {
      console.log(`[backup-safe] skip extra not found: ${src}`);
      continue;
    }
    const destFile = join(destDir, src.replace(/\//g, "__"));
    cpSync(src, destFile);
    const size = statSync(destFile).size;
    console.log(`[backup-safe] extra ${src} -> ${destFile} (${formatKb(size)} KB)`);
    count += 1;
  }
  return count;
}

function pruneOldBackups(): void {
  if (!existsSync(BACKUP_ROOT)) return;
  const dirs = readdirSync(BACKUP_ROOT)
    .filter((name) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(name))
    .sort();

  const excess = dirs.length - MAX_BACKUPS;
  if (excess <= 0) return;

  for (let i = 0; i < excess; i += 1) {
    const target = join(BACKUP_ROOT, dirs[i]);
    rmSync(target, { recursive: true, force: true });
    console.log(`[backup-safe] pruned old backup: ${target}`);
  }
}

function timestampDir(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function sqlQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function formatKb(size: number): string {
  return (size / 1024).toFixed(1);
}
