/**
 * Macが落ちていた期間の未実行処理を補完する入口。
 * supervisor / Mac再起動後の復帰から呼ばれる。
 *
 * usage: tsx scripts/run-catchup.ts [--days N]
 *   --days: 遡る最大日数 (default=7, max=30, env CATCHUP_DAYS で上書き可)
 *
 * 復元できるもの:
 *   - 出走表 (official programs)
 *   - レース結果 (official results)
 *   - 直前情報バックフィル (BUY/WATCH対象分)
 *
 * 復元できないもの → missing_jobs に記録:
 *   - 締切直前オッズスナップショット (リアルタイム専用)
 *   - その瞬間の期待値判定
 *   - 過去日の日次レポート
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { openDb } from "../server/db";
import { getDatesBetween, getTodayInTokyo, subtractDays } from "../src/jobs/date";
import { acquireLock, clearStaleLock, releaseLock } from "../src/jobs/job-lock";
import { getLastSuccessDate, hasSucceeded, markFailed, markRunning, markSkipped, markSuccess, recordMissing } from "../src/jobs/job-runner";

const LOCK_KEY = "catchup";
const MAX_CATCHUP_DAYS = 30;

// CATCHUP_DAYS のバリデーション
function parseCatchupDays(): number {
  const daysIdx = process.argv.indexOf("--days");
  const raw = process.argv.find((a) => a.startsWith("--days="))?.slice(7)
    ?? (daysIdx >= 0 ? process.argv[daysIdx + 1] : undefined)
    ?? process.env["CATCHUP_DAYS"]
    ?? "7";

  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`[catchup] invalid --days value: "${raw}" (must be a positive integer)`);
    process.exit(1);
  }
  return Math.min(n, MAX_CATCHUP_DAYS);
}

const CATCHUP_DAYS = parseCatchupDays();

function getPackageScripts(): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { scripts?: Record<string, string> };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

function hasScript(name: string): boolean {
  return name in getPackageScripts();
}

function runScript(scriptName: string, extraArgs: string[] = []): void {
  const result = spawnSync("pnpm", [scriptName, ...extraArgs], {
    stdio: "inherit",
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`pnpm ${scriptName} exited with code ${result.status}`);
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// 補完すべき日付を計算する (最後の成功日の翌日〜昨日、最大CATCHUP_DAYS日)
function getMissingDates(db: ReturnType<typeof openDb>, jobName: string, today: string): string[] {
  const lastSuccess = getLastSuccessDate(db, jobName);
  const to = subtractDays(today, 1); // 昨日まで (今日はdailyで担当)
  let from: string;
  if (lastSuccess) {
    const daysSinceSuccess = Math.round(
      (new Date(`${today}T00:00:00Z`).getTime() - new Date(`${lastSuccess}T00:00:00Z`).getTime()) / 86400000
    );
    const lookback = Math.min(CATCHUP_DAYS, daysSinceSuccess - 1);
    if (lookback <= 0) return [];
    from = subtractDays(today, lookback);
  } else {
    from = subtractDays(today, CATCHUP_DAYS);
  }
  if (from > to) return [];
  return getDatesBetween(from, to);
}

/**
 * 一括CLI実行でまとめて補完するジョブ。
 * - 全 dates を markRunning
 * - CLI成功 → 全 dates を markSuccess
 * - CLI失敗 → 全 dates を markFailed (途中で成功扱いにしない)
 * - すでに success のものは skipped
 */
async function bulkCatchupJob(
  db: ReturnType<typeof openDb>,
  jobName: string,
  dates: string[],
  runBulk: (from: string, to: string) => void
): Promise<{ ok: number; skipped: number; failed: number }> {
  const todo = dates.filter((d) => !hasSucceeded(db, jobName, d));
  const skipped = dates.length - todo.length;
  for (const d of dates) markSkipped(db, jobName, d); // already-success 分を記録

  if (todo.length === 0) return { ok: 0, skipped, failed: 0 };

  const from = todo[0]; const to = todo[todo.length - 1];
  for (const d of todo) markRunning(db, jobName, d);
  try {
    runBulk(from, to);
    for (const d of todo) markSuccess(db, jobName, d);
    return { ok: todo.length, skipped, failed: 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    for (const d of todo) markFailed(db, jobName, d, msg);
    console.warn(`  [catchup] FAIL ${jobName} ${from}〜${to}: ${msg}`);
    return { ok: 0, skipped, failed: todo.length };
  }
}

async function main() {
  const today = getTodayInTokyo();
  console.log(`[catchup] date=${today} days=${CATCHUP_DAYS}`);

  const db = openDb();
  try {
    clearStaleLock(db, LOCK_KEY);
    if (!acquireLock(db, LOCK_KEY)) {
      console.warn("[catchup] another instance is running. exit.");
      process.exit(0);
    }

    const summary: Array<{ job: string; ok: number; skipped: number; failed: number }> = [];

    // 1. 出走表バックフィル (一括CLI)
    {
      const dates = getMissingDates(db, "race_calendar_fetch", today);
      console.log(`[catchup] race_calendar_fetch: ${dates.length} dates`);
      if (dates.length > 0 && hasScript("fetch:official-programs")) {
        const r = await bulkCatchupJob(db, "race_calendar_fetch", dates, (from, to) => {
          runScript("fetch:official-programs", [from, to]);
        });
        summary.push({ job: "race_calendar_fetch", ...r });
      } else {
        for (const d of dates) markSkipped(db, "race_calendar_fetch", d);
        summary.push({ job: "race_calendar_fetch", ok: 0, skipped: dates.length, failed: 0 });
      }
      await sleep(2000);
    }

    // 2. レース結果バックフィル (一括CLI)
    {
      const dates = getMissingDates(db, "race_result_fetch", today);
      console.log(`[catchup] race_result_fetch: ${dates.length} dates`);
      if (dates.length > 0 && hasScript("fetch:official-results")) {
        const r = await bulkCatchupJob(db, "race_result_fetch", dates, (from, to) => {
          runScript("fetch:official-results", [from, to]);
        });
        summary.push({ job: "race_result_fetch", ...r });
      } else {
        for (const d of dates) markSkipped(db, "race_result_fetch", d);
        summary.push({ job: "race_result_fetch", ok: 0, skipped: dates.length, failed: 0 });
      }
      await sleep(2000);
    }

    // 3. 直前情報バックフィル (BUY/WATCH対象のみ、一括CLI)
    {
      const dates = getMissingDates(db, "exhibition_backfill", today);
      console.log(`[catchup] exhibition_backfill: ${dates.length} dates`);
      if (dates.length > 0 && hasScript("backfill:beforeinfo")) {
        const r = await bulkCatchupJob(db, "exhibition_backfill", dates, (from, to) => {
          runScript("backfill:beforeinfo", ["--from", from, "--to", to]);
        });
        summary.push({ job: "exhibition_backfill", ...r });
      } else {
        for (const d of dates) markSkipped(db, "exhibition_backfill", d);
        summary.push({ job: "exhibition_backfill", ok: 0, skipped: dates.length, failed: 0 });
      }
    }

    // 4. オッズスナップショット: リアルタイムのため復元不可 → missing_jobs に記録
    {
      const dates = getMissingDates(db, "odds_snapshot", today);
      for (const date of dates) {
        recordMissing(db, "odds_snapshot", date,
          "Mac was powered off or asleep; realtime odds snapshot could not be reconstructed");
      }
      if (dates.length > 0) {
        console.log(`[catchup] odds_snapshot: ${dates.length} dates → missing_jobs (realtime only)`);
      }
      summary.push({ job: "odds_snapshot(missing)", ok: 0, skipped: dates.length, failed: 0 });
    }

    // 5. 過去日の日次レポート: 生成不可 → missing_jobs に記録
    {
      const dates = getMissingDates(db, "daily_report_generate", today);
      for (const date of dates) {
        recordMissing(db, "daily_report_generate", date,
          "Historical daily report generation not supported; run pnpm daily for today only");
      }
      if (dates.length > 0) {
        console.log(`[catchup] daily_report_generate: ${dates.length} dates → missing_jobs`);
      }
      summary.push({ job: "daily_report_generate(missing)", ok: 0, skipped: dates.length, failed: 0 });
    }

    // --- サマリー ---
    console.log("\n[catchup] === summary ===");
    for (const r of summary) {
      console.log(`  ${r.job}: ok=${r.ok} skipped=${r.skipped} failed=${r.failed}`);
    }
    const totalFailed = summary.reduce((s, r) => s + r.failed, 0);
    if (totalFailed > 0) {
      console.warn(`[catchup] ${totalFailed} job failure(s)`);
      process.exitCode = 1;
    } else {
      console.log("[catchup] done.");
    }
  } finally {
    releaseLock(db, LOCK_KEY);
    db.close();
  }
}

main().catch((err) => {
  console.error("[catchup] fatal:", err);
  process.exit(1);
});
