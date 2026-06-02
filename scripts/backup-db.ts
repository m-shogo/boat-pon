/**
 * pnpm backup — DB・重要データファイルのスナップショットを保存する
 * backups/YYYY-MM-DDTHH-mm-ss/ に存在するファイルだけコピー
 * 最新 30 件を保持し古いバックアップを自動削除
 *
 * 注意: 自動投票・ログイン保存は行わない。記録・検証・学習用データのバックアップのみ。
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const BACKUP_ROOT = "backups";
const MAX_BACKUPS = 30;

// backup 対象: 存在しなければ skip（エラーにしない）
const TARGETS = [
  "data/boat.sqlite",
  "data/boat-pon.db",
  "data/run-cursors.json",
];

function timestampDir(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    now.getFullYear(),
    "-", pad(now.getMonth() + 1),
    "-", pad(now.getDate()),
    "T", pad(now.getHours()),
    "-", pad(now.getMinutes()),
    "-", pad(now.getSeconds()),
  ].join("");
}

function pruneOldBackups(): void {
  if (!existsSync(BACKUP_ROOT)) return;
  const dirs = readdirSync(BACKUP_ROOT)
    .filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(name))
    .sort();
  const excess = dirs.length - MAX_BACKUPS;
  for (let i = 0; i < excess; i++) {
    const target = join(BACKUP_ROOT, dirs[i]);
    rmSync(target, { recursive: true, force: true });
    console.log(`[backup] 古いバックアップを削除: ${target}`);
  }
}

const dest = join(BACKUP_ROOT, timestampDir());
mkdirSync(dest, { recursive: true });

let copied = 0;
for (const src of TARGETS) {
  if (!existsSync(src)) {
    console.log(`[backup] skip (not found): ${src}`);
    continue;
  }
  const destFile = join(dest, src.replace(/\//g, "__"));
  cpSync(src, destFile);
  const size = statSync(destFile).size;
  console.log(`[backup] ${src} → ${destFile} (${(size / 1024).toFixed(1)} KB)`);
  copied++;
}

pruneOldBackups();
console.log(`[backup] 完了: ${dest} (${copied} 件)`);
