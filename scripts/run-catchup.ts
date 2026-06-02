/**
 * Macが落ちていた期間の未実行処理を補完する入口。
 * supervisor / Mac再起動後の復帰から呼ばれる。
 *
 * usage: tsx scripts/run-catchup.ts [--days N]
 *   --days: 遡る最大日数 (default=7, env CATCHUP_DAYS で上書き可)
 *
 * 復元できるもの:
 *   - 出走表 (official programs)
 *   - レース結果 (official results)
 *   - 日次レポート
 *   - 直前情報バックフィル (BUY/WATCH対象分)
 *
 * 復元できないもの → missing_jobs に記録:
 *   - 締切直前オッズスナップショット
 *   - リアルタイム通知
 *   - その瞬間の期待値判定
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { openDb } from "../server/db";
import { getDatesBetween, getTodayInTokyo, subtractDays } from "../src/jobs/date";
import { acquireLock, clearStaleLock, releaseLock } from "../src/jobs/job-lock";
import { getLastSuccessDate, hasSucceeded, markFailed, markRunning, markSkipped, markSuccess, recordMissing } from "../src/jobs/job-runner";

const LOCK_KEY = "catchup";

const DEFAULT_CATCHUP_DAYS = Number(process.env["CATCHUP_DAYS"] ?? "7");
const daysIdx = process.argv.indexOf("--days");
const daysArg = process.argv.find((a) => a.startsWith("--days="))?.slice(7)
  ?? (daysIdx >= 0 ? process.argv[daysIdx + 1] : undefined);
const CATCHUP_DAYS = daysArg ? Number(daysArg) : DEFAULT_CATCHUP_DAYS;

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

function runNpmScript(scriptName: string, extraArgs: string[] = []): void {
  const result = spawnSync("npm", ["run", scriptName, "--", ...extraArgs], {
    stdio: "inherit",
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`npm run ${scriptName} exited with code ${result.status}`);
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// 補完すべき日付を計算する (最後の成功日の翌日〜昨日)
function getMissingDates(db: ReturnType<typeof openDb>, jobName: string, today: string): string[] {
  const lastSuccess = getLastSuccessDate(db, jobName);
  const from = lastSuccess ? subtractDays(today, Math.min(CATCHUP_DAYS, daysDiff(lastSuccess, today) - 1)) : subtractDays(today, CATCHUP_DAYS);
  const to = subtractDays(today, 1); // 昨日まで (今日はdailyで担当)
  if (from > to) return [];
  return getDatesBetween(from, to);
}

function daysDiff(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000);
}

async function catchupJob(
  db: ReturnType<typeof openDb>,
  jobName: string,
  dates: string[],
  fn: (date: string) => Promise<void>
): Promise<{ ok: number; skipped: number; failed: number }> {
  let ok = 0; let skipped = 0; let failed = 0;
  for (const date of dates) {
    if (hasSucceeded(db, jobName, date)) {
      markSkipped(db, jobName, date);
      skipped++;
      continue;
    }
    markRunning(db, jobName, date);
    try {
      await fn(date);
      markSuccess(db, jobName, date);
      ok++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      markFailed(db, jobName, date, msg);
      console.warn(`  [catchup] FAIL ${jobName} ${date}: ${msg}`);
      failed++;
    }
  }
  return { ok, skipped, failed };
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

    // 1. 出走表バックフィル
    {
      const dates = getMissingDates(db, "race_calendar_fetch", today);
      console.log(`[catchup] race_calendar_fetch: ${dates.length} dates`);
      if (dates.length > 0 && hasScript("fetch:official-programs")) {
        // まとめて1回呼ぶ (内部でキャッシュあり)
        const from = dates[0]; const to = dates[dates.length - 1];
        const r = await catchupJob(db, "race_calendar_fetch", dates, async (date) => {
          if (date !== from) return; // 初日に一括実行
          runNpmScript("fetch:official-programs", [from, to]);
        });
        // 残り日付も success にマーク (一括実行のため)
        for (const date of dates.slice(1)) {
          if (!hasSucceeded(db, "race_calendar_fetch", date)) {
            markRunning(db, "race_calendar_fetch", date);
            markSuccess(db, "race_calendar_fetch", date);
          }
        }
        summary.push({ job: "race_calendar_fetch", ...r });
      } else {
        summary.push({ job: "race_calendar_fetch", ok: 0, skipped: dates.length, failed: 0 });
      }
      await sleep(3000);
    }

    // 2. レース結果バックフィル
    {
      const dates = getMissingDates(db, "race_result_fetch", today);
      console.log(`[catchup] race_result_fetch: ${dates.length} dates`);
      if (dates.length > 0 && hasScript("fetch:official-results")) {
        const from = dates[0]; const to = dates[dates.length - 1];
        const r = await catchupJob(db, "race_result_fetch", dates, async (date) => {
          if (date !== from) return;
          runNpmScript("fetch:official-results", [from, to]);
        });
        for (const date of dates.slice(1)) {
          if (!hasSucceeded(db, "race_result_fetch", date)) {
            markRunning(db, "race_result_fetch", date);
            markSuccess(db, "race_result_fetch", date);
          }
        }
        summary.push({ job: "race_result_fetch", ...r });
      } else {
        summary.push({ job: "race_result_fetch", ok: 0, skipped: dates.length, failed: 0 });
      }
      await sleep(3000);
    }

    // 3. 直前情報バックフィル (BUY/WATCH対象分のみ、backfill-beforeinfoを使用)
    {
      const dates = getMissingDates(db, "exhibition_backfill", today);
      console.log(`[catchup] exhibition_backfill: ${dates.length} dates`);
      if (dates.length > 0 && hasScript("backfill:beforeinfo")) {
        const from = dates[0]; const to = dates[dates.length - 1];
        const r = await catchupJob(db, "exhibition_backfill", dates, async (date) => {
          if (date !== from) return;
          runNpmScript("backfill:beforeinfo", [`--from`, from, `--to`, to]);
        });
        for (const date of dates.slice(1)) {
          if (!hasSucceeded(db, "exhibition_backfill", date)) {
            markRunning(db, "exhibition_backfill", date);
            markSuccess(db, "exhibition_backfill", date);
          }
        }
        summary.push({ job: "exhibition_backfill", ...r });
      } else {
        summary.push({ job: "exhibition_backfill", ok: 0, skipped: dates.length, failed: 0 });
      }
    }

    // 4. オッズスナップショット: リアルタイムのため復元不可 → missing_jobs に記録 (failure扱いしない)
    {
      const dates = getMissingDates(db, "odds_snapshot", today);
      for (const date of dates) {
        if (!hasSucceeded(db, "odds_snapshot", date)) {
          recordMissing(db, "odds_snapshot", date,
            "Mac was powered off or asleep; realtime odds snapshot could not be reconstructed");
        }
      }
      if (dates.length > 0) {
        console.log(`[catchup] odds_snapshot: ${dates.length} dates → missing_jobs (realtime only, not a failure)`);
      }
      summary.push({ job: "odds_snapshot(missing)", ok: 0, skipped: dates.length, failed: 0 });
    }

    // 5. 日次レポート生成
    {
      const dates = getMissingDates(db, "daily_report_generate", today);
      console.log(`[catchup] daily_report_generate: ${dates.length} dates`);
      if (dates.length > 0 && hasScript("report:daily")) {
        // report:daily は今日分のみ生成なので、過去日分は skipped として記録
        for (const date of dates) {
          if (!hasSucceeded(db, "daily_report_generate", date)) {
            recordMissing(db, "daily_report_generate", date,
              "Historical daily report generation not supported; run report:daily for today only");
          }
        }
      }
      summary.push({ job: "daily_report_generate", ok: 0, skipped: dates.length, failed: 0 });
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
