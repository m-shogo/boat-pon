/**
 * racer_course_stats のバルク取得完了を監視し、完了時にMac通知を送る。
 * usage: tsx scripts/notify-racer-stats-done.ts
 */

import { execSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = "data/boat.sqlite";
const CHECK_INTERVAL_MS = 60_000; // 1分ごとにチェック
const TOTAL_RACERS = 2644; // official_programsに登場した全選手数
const DONE_THRESHOLD = 0.97; // 97%以上で完了とみなす

function getProgress(): { fetched: number; total: number; pct: number } {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const row = db.prepare(`
      SELECT COUNT(DISTINCT registration_no) AS cnt FROM racer_profiles
      WHERE flying_count IS NOT NULL OR avg_st IS NOT NULL
    `).get() as { cnt: number };
    const fetched = row.cnt;
    return { fetched, total: TOTAL_RACERS, pct: fetched / TOTAL_RACERS };
  } finally {
    db.close();
  }
}

function macNotify(title: string, message: string) {
  const safe = (s: string) => s.replace(/"/g, '\\"');
  execSync(
    `osascript -e 'display notification "${safe(message)}" with title "${safe(title)}" sound name "Glass"'`
  );
}

async function main() {
  console.log("バルク取得完了を監視中... (Ctrl+C で終了)");
  let lastFetched = 0;

  while (true) {
    const { fetched, total, pct } = getProgress();

    if (fetched !== lastFetched) {
      console.log(`[${new Date().toLocaleTimeString("ja-JP")}] ${fetched}人 / ${total}人 (${(pct * 100).toFixed(1)}%)`);
      lastFetched = fetched;
    }

    if (pct >= DONE_THRESHOLD) {
      console.log("✅ バルク取得完了！");
      macNotify(
        "boat-pon ✅ バルク取得完了",
        `${fetched}人分のデータが揃いました。npm run stats:racer-coverage で確認してください。`
      );
      break;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
