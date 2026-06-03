/**
 * pnpm backup — DB・重要データファイルのスナップショットを保存する
 * backups/YYYY-MM-DDTHH-mm-ss/ に保存
 * DB は WAL を考慮し VACUUM INTO 方式でスナップショット化
 * 最新 30 件を保持し古いバックアップを自動削除
 *
 * 注意: 自動投票・ログイン保存は行わない。記録・検証・学習用データのバックアップのみ。
 */

import { DatabaseSync } from "node:sqlite";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const BACKUP_ROOT = "backups";
const DB_PATH = "data/boat.sqlite";
const MAX_BACKUPS = 30;

// DB 以外のバックアップ対象（存在しなければ skip）
const EXTRA_TARGETS = [
  "data/run-cursors.json",
];

function timestampDir(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function pruneOldBackups(): void {
  if (!existsSync(BACKUP_ROOT)) return;
  const dirs = readdirSync(BACKUP_ROOT)
    .filter((name) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(name))
    .sort();
  const excess = dirs.length - MAX_BACKUPS;
  for (let i = 0; i < excess; i++) {
    const target = join(BACKUP_ROOT, dirs[i]);
    rmSync(target, { recursive: true, force: true });
    console.log(`[backup] 古いバックアップを削除: ${target}`);
  }
}

const destDir = join(BACKUP_ROOT, timestampDir());
mkdirSync(destDir, { recursive: true });

// DB バックアップ（WAL対応: VACUUM INTO）
if (!existsSync(DB_PATH)) {
  console.warn(`[backup] DB が見つかりません: ${DB_PATH} — スキップします`);
} else {
  const destDb = join(destDir, "boat.sqlite");
  const db = new DatabaseSync(DB_PATH);
  try {
    db.exec("PRAGMA busy_timeout = 30000;");
    // WAL に残っている変更を DB 本体へ反映
    db.exec("PRAGMA wal_checkpoint(FULL);");
    // 実行中 DB を安全にスナップショット化（WAL の有無にかかわらず一貫性を保証）
    db.exec(`VACUUM INTO '${destDb.replaceAll("'", "''")}'`);
    const size = statSync(destDb).size;
    console.log(`[backup] ${DB_PATH} → ${destDb} (${(size / 1024).toFixed(1)} KB) [VACUUM INTO]`);
  } finally {
    db.close();
  }
}

// その他ファイルのバックアップ
let extraCopied = 0;
for (const src of EXTRA_TARGETS) {
  if (!existsSync(src)) {
    console.log(`[backup] skip (not found): ${src}`);
    continue;
  }
  const destFile = join(destDir, src.replace(/\//g, "__"));
  cpSync(src, destFile);
  const size = statSync(destFile).size;
  console.log(`[backup] ${src} → ${destFile} (${(size / 1024).toFixed(1)} KB)`);
  extraCopied++;
}

pruneOldBackups();
console.log(`[backup] 完了: ${destDir} (DB + ${extraCopied} 件)`);
