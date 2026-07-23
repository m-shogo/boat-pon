import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { LIVE_MONITOR_FROM, LIVE_MONITOR_MODEL_VERSION } from "../src/domain/liveMonitor";
import { inspectLiveLog, type LiveLogJob } from "./live-log-utils";

const DB_PATH = "data/boat.sqlite";
const CWD = "/Users/m-shogo/Developer/personal/boat-pon";
const LOG_PATHS: Array<{ path: string; job: LiveLogJob }> = [
  { path: "data/logs/daily-programs.log", job: "daily-programs" },
  { path: "data/logs/daily-programs-err.log", job: "daily-programs" },
  { path: "data/logs/auto-odds.log", job: "auto-odds" },
  { path: "data/logs/auto-odds-err.log", job: "auto-odds" },
  { path: "data/logs/progress.log", job: "daily-progress" },
  { path: "data/logs/progress-err.log", job: "daily-progress" },
];

const now = new Date();
const todayJst = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
const generatedAt = new Date(now.getTime() + 9 * 3600_000)
  .toISOString()
  .replace("T", " ")
  .slice(0, 16) + " JST";

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");
try {
  main();
} finally {
  db.close();
}

function main() {
  const status = buildStatus();

  console.log(`=== AI Handoff === ${generatedAt}`);
  console.log(`cwd: ${CWD}`);
  console.log("read_first: docs/current-ai-handoff.md");
  console.log("correctness_source: reports/current-system-correctness-audit.md");
  console.log("");
  console.log("## 制約");
  console.log("- commit/push禁止（Codexレビュー後に実施）");
  console.log("- 禁止: 判定ロジック/モデルパラメータ/BudgetRule/app_settings");
  console.log("  server/db.ts, server/candidates.ts, src/App.tsx, data/, DB, 購入系");
  console.log("");
  console.log("## 現在状態");
  console.log(`  git: ${gitStatus()}`);
  console.log(`  guard: ${guardStatus()}`);
  console.log(`  programs: ${todayJst} ${status.programsToday}`);
  console.log(`  odds: ${todayJst} ${status.oddsToday}`);
  console.log(`  decisions: BUY=${status.buy} WATCH=${status.watch} SKIP=${status.skip}`);
  console.log(`  paper_live_buy_total: ${status.liveBuyN} (profitability unverified; promotion gateではない)`);
  console.log(`  watch_buy_odds_coverage: ${status.coverage}`);
  console.log(`  errors: ${status.errors}`);
  console.log("");
  console.log("## 実装可能範囲");
  console.log("  監視/運用/README/docs/ログ分類/表示整理");
  console.log("");
  console.log("## 作業手順");
  console.log("  1. 作業前: npm run status:brief && npm run guard:live && npm run build");
  console.log("     状態確認だけなら: npm run status:brief -- --json");
  console.log("     候補確認だけなら: npm run watch:today -- --json");
  console.log("     起動/ログ確認なら: npm run readiness -- --json");
  console.log("     21:05以降の締め確認なら: npm run day:close -- --json");
  console.log("  2. 実装（上記範囲のみ）");
  console.log("  3. 作業後: npm run status:brief && npm run guard:live && npm run build");
  console.log("");
  console.log("## 最終報告形式");
  console.log("  変更ファイル / 意図 / 検証結果");
}

function buildStatus() {
  const programsRow = db.prepare(
    "SELECT COUNT(*) AS n FROM official_programs WHERE date = ?"
  ).get(todayJst) as { n: number };

  const oddsRow = db.prepare(
    "SELECT COUNT(*) AS n FROM odds_snapshots WHERE substr(datetime(captured_at, '+9 hours'),1,10) = ?"
  ).get(todayJst) as { n: number };

  const decisionRows = db.prepare(
    "SELECT decision, COUNT(*) AS n FROM decision_history WHERE date = ? AND model_version = ? AND run_kind = 'paper-live' GROUP BY decision"
  ).all(todayJst, LIVE_MONITOR_MODEL_VERSION) as Array<{ decision: string; n: number }>;

  const decMap = Object.fromEntries(decisionRows.map((r) => [r.decision, r.n]));

  const qualityRow = db.prepare(`
    SELECT COUNT(*) AS n,
           SUM(CASE WHEN current_odds IS NOT NULL THEN 1 ELSE 0 END) AS present
    FROM decision_history
    WHERE date >= ? AND model_version = ? AND decision IN ('WATCH','BUY')
  `).get(LIVE_MONITOR_FROM, LIVE_MONITOR_MODEL_VERSION) as { n: number; present: number };

  const liveBuyRow = db.prepare(
    "SELECT COUNT(*) AS n FROM decision_history WHERE date >= ? AND model_version = ? AND run_kind = 'paper-live' AND decision = 'BUY'"
  ).get(LIVE_MONITOR_FROM, LIVE_MONITOR_MODEL_VERSION) as { n: number };

  const coverage =
    qualityRow.n > 0
      ? `${qualityRow.present}/${qualityRow.n} ${Math.round((qualityRow.present / qualityRow.n) * 100)}%`
      : "-";

  return {
    programsToday: programsRow.n,
    oddsToday: oddsRow.n,
    buy: decMap["BUY"] ?? 0,
    watch: decMap["WATCH"] ?? 0,
    skip: decMap["SKIP"] ?? 0,
    liveBuyN: liveBuyRow.n,
    coverage,
    errors: checkErrors(),
  };
}

function checkErrors() {
  const activeErrors = LOG_PATHS
    .map((log) => inspectLiveLog(log.path, log.job))
    .filter((log) => !log.ok)
    .map((log) => log.path.replace("data/logs/", ""));
  return activeErrors.length === 0 ? "none_new" : activeErrors.join(",");
}

function gitStatus() {
  try {
    const out = execFileSync("git", ["status", "--short"], { encoding: "utf8" });
    return out.trim() === "" ? "clean" : "dirty";
  } catch {
    return "unknown";
  }
}

function guardStatus() {
  try {
    execFileSync("npm", ["run", "guard:live", "--silent"], { encoding: "utf8", stdio: "pipe" });
    return "ok";
  } catch {
    return "block";
  }
}
