/**
 * 今日分の通常処理を安全に実行する入口。
 * supervisor / Mac再起動後の復帰 から呼ばれる。
 *
 * usage: tsx scripts/run-daily.ts [--date YYYY-MM-DD]
 *
 * - 自動投票・自動購入・ログイン保存・投票サイト操作は行わない
 * - 「買い確定」「利益確定」などの断定表現は出力しない
 * - 既存CLIが存在する場合のみ呼び出す
 * - 1つのjobが失敗しても他のjobを継続する
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { openDb } from "../server/db";
import { getTodayInTokyo, subtractDays } from "../src/jobs/date";
import { acquireLock, clearStaleLock, releaseLock } from "../src/jobs/job-lock";
import { recordMissing, runJob } from "../src/jobs/job-runner";

const LOCK_KEY = "daily";
const dateIdx = process.argv.indexOf("--date");
const APP_DATE = process.argv.find((a) => a.startsWith("--date="))?.slice(7)
  ?? (dateIdx >= 0 ? process.argv[dateIdx + 1] : undefined)
  ?? getTodayInTokyo();

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

async function main() {
  const today = APP_DATE;
  const yesterday = subtractDays(today, 1);

  console.log(`[daily] date=${today}`);

  const db = openDb();
  try {
    // ロック取得（前回の stale lock があれば解除）
    clearStaleLock(db, LOCK_KEY);
    if (!acquireLock(db, LOCK_KEY)) {
      console.warn("[daily] another instance is running. exit.");
      process.exit(0);
    }

    const results: Array<{ job: string; status: string; note?: string }> = [];

    const job = async (name: string, fn: () => Promise<void>) => {
      const r = await runJob(db, name, today, fn);
      results.push({ job: name, status: r.skipped ? "skipped" : r.success ? "ok" : "failed", note: r.message });
    };

    // 1. 今日の出走表取得
    await job("race_calendar_fetch", async () => {
      if (!hasScript("fetch:official-programs")) throw new Error("script not found");
      runNpmScript("fetch:official-programs", [today, today]);
    });

    // 2. 昨日のレース結果取得
    await job("race_result_fetch", async () => {
      if (!hasScript("fetch:official-results")) throw new Error("script not found");
      runNpmScript("fetch:official-results", [yesterday, yesterday]);
    });

    // 3. 今日のオッズ取得 (live専用。過去分は復元不可)
    await job("odds_snapshot", async () => {
      if (!hasScript("auto:odds")) throw new Error("script not found");
      runNpmScript("auto:odds");
    });

    // 4. 今日の直前情報取得 (live専用。過去分は復元不可)
    await job("exhibition_fetch", async () => {
      if (!hasScript("auto:beforeinfo")) throw new Error("script not found");
      runNpmScript("auto:beforeinfo");
    });

    // 5. 日次レポート生成
    await job("daily_report_generate", async () => {
      if (!hasScript("report:daily")) throw new Error("script not found");
      runNpmScript("report:daily");
    });

    // 6. データカバレッジ確認
    await job("data_coverage_check", async () => {
      if (!hasScript("report:data-coverage")) throw new Error("script not found");
      runNpmScript("report:data-coverage", ["--beforeinfo-days=7"]);
    });

    // --- サマリー ---
    console.log("\n[daily] === summary ===");
    for (const r of results) {
      const icon = r.status === "ok" ? "✓" : r.status === "skipped" ? "-" : "✗";
      console.log(`  ${icon} ${r.job}: ${r.status}${r.note ? ` (${r.note})` : ""}`);
    }
    const failed = results.filter((r) => r.status === "failed");
    if (failed.length > 0) {
      console.warn(`[daily] ${failed.length} job(s) failed`);
      process.exitCode = 1;
    } else {
      console.log("[daily] done.");
    }
  } finally {
    releaseLock(db, LOCK_KEY);
    db.close();
  }
}

main().catch((err) => {
  console.error("[daily] fatal:", err);
  process.exit(1);
});
