import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { loadEnvFiles } from "../src/domain/envFile";
import { officialResultUrl } from "../src/domain/officialLinks";
import { buildBuyResultNotification } from "../src/domain/buyResultNotification";
import { buildLineText, lineMessagingConfigFromEnv, sendLinePushTextToRecipients } from "../src/domain/lineMessaging";
import { LIVE_MONITOR_MODEL_VERSION } from "../src/domain/liveMonitor";
import { accuracySnapshotFromReport, classifyBuyTiming } from "../src/domain/accuracyScorecard";
import { formatDailySummary, formatWeeklySummary, type DailyBuy, type WeeklyWindow } from "../src/domain/lineMessages";
import { loadBuyLedgers } from "./lib/buyLedger";

type Mode = "daily" | "test" | "results" | "weekly" | "errors";

// --preview: 送信済みかどうかに関係なく文面を表示するだけ（送信しない・DB に書かない・DB は読み取り専用で開く）。
const PREVIEW = process.argv.includes("--preview");

type NotificationRow = {
  id: number;
  raceId: string;
  title: string;
  body: string;
  officialUrl: string;
};

type DailyCounts = {
  buy: number;
  watch: number;
  skip: number;
  total: number;
  oddsPresent: number;
};

function todayJst() {
  return new Intl.DateTimeFormat("sv", { timeZone: "Asia/Tokyo" }).format(new Date());
}

function argValue(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  return args[index + 1] ?? null;
}

function hasFlag(args: string[], name: string) {
  return args.includes(name);
}

function usage() {
  return [
    "Usage:",
    "  pnpm notify:line:test [--dry-run] [--message <text>]",
    "  pnpm notify:line:daily [--date YYYY-MM-DD] [--dry-run]",
    "  pnpm notify:line:results [--date YYYY-MM-DD | --from YYYY-MM-DD --to YYYY-MM-DD] [--dry-run]",
    "  npx tsx scripts/notify-line.ts weekly [--growth-json path] [--dry-run]",
    "  pnpm notify:line:errors [--date YYYY-MM-DD] [--dry-run]",
    "",
    "Env file:",
    "  Create .env in the repository root. Use .env.example only as a reference.",
    "",
    "Optional:",
    "  --dry-run prints the LINE message without sending.",
  ].join("\n");
}

function parseMode(args: string[]): Mode {
  const first = args.find((arg) => !arg.startsWith("--"));
  if (first === "forward") return "weekly"; // 旧名（launchd の古いスクリプトから呼ばれても動くように）
  if (first === "daily" || first === "test" || first === "results" || first === "weekly" || first === "errors") return first;
  throw new Error(`Unknown mode: ${first ?? "(missing)"}\n${usage()}`);
}

function numberValue(value: unknown): number {
  return value == null ? 0 : Number(value);
}

function notificationRowFromRecord(row: Record<string, unknown>): NotificationRow {
  return {
    id: Number(row.id),
    raceId: String(row.race_id),
    title: String(row.title),
    body: String(row.body),
    officialUrl: String(row.official_url),
  };
}

function upsertPendingNotification(
  db: DatabaseSync,
  args: { raceId: string; title: string; body: string; officialUrl: string; dryRun: boolean },
): NotificationRow | null {
  const existing = db.prepare(`
SELECT id, race_id, status, title, body, official_url
FROM notification_log
WHERE race_id = ? AND channel = 'line'
`).get(args.raceId) as Record<string, unknown> | undefined;

  if (PREVIEW) return { id: 0, raceId: args.raceId, title: args.title, body: args.body, officialUrl: args.officialUrl };
  if (existing?.status === "SENT") return null;
  if (args.dryRun) {
    return {
      id: 0,
      raceId: args.raceId,
      title: args.title,
      body: args.body,
      officialUrl: args.officialUrl,
    };
  }

  if (existing) {
    db.prepare(`
UPDATE notification_log
SET status = 'PENDING', title = ?, body = ?, official_url = ?
WHERE id = ?
`).run(args.title, args.body, args.officialUrl, Number(existing.id));
  } else {
    db.prepare(`
INSERT INTO notification_log (race_id, channel, status, title, body, official_url)
VALUES (?, 'line', 'PENDING', ?, ?, ?)
`).run(args.raceId, args.title, args.body, args.officialUrl);
  }

  const row = db.prepare(`
SELECT id, race_id, title, body, official_url
FROM notification_log
WHERE race_id = ? AND channel = 'line'
`).get(args.raceId) as Record<string, unknown>;
  return notificationRowFromRecord(row);
}

function markNotificationSent(db: DatabaseSync, id: number) {
  db.prepare("UPDATE notification_log SET status = 'SENT', sent_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
}

function mergeRecentPendingNotifications(db: DatabaseSync, notifications: NotificationRow[], dryRun: boolean): NotificationRow[] {
  if (dryRun) return notifications;
  const pending = db.prepare(`
SELECT id, race_id, title, body, official_url
FROM notification_log
WHERE channel = 'line'
  AND status = 'PENDING'
  AND created_at >= datetime('now', '-3 days')
ORDER BY id ASC
`).all().map(notificationRowFromRecord);

  const merged = new Map<number, NotificationRow>();
  for (const notification of [...pending, ...notifications]) merged.set(notification.id, notification);
  return [...merged.values()];
}

function dailyCounts(db: DatabaseSync, date: string): DailyCounts {
  const row = db.prepare(`
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN decision = 'BUY' THEN 1 ELSE 0 END) AS buy,
  SUM(CASE WHEN decision = 'WATCH' THEN 1 ELSE 0 END) AS watch,
  SUM(CASE WHEN decision = 'SKIP' THEN 1 ELSE 0 END) AS skip,
  SUM(CASE WHEN current_odds IS NOT NULL THEN 1 ELSE 0 END) AS odds_present
FROM decision_history
WHERE date = ?
  AND model_version = ?
  AND run_kind = 'paper-live'
`).get(date, LIVE_MONITOR_MODEL_VERSION) as Record<string, unknown>;

  return {
    buy: numberValue(row.buy),
    watch: numberValue(row.watch),
    skip: numberValue(row.skip),
    total: numberValue(row.total),
    oddsPresent: numberValue(row.odds_present),
  };
}

/** 番組数と、締切5分前（T-5）の全120通りのオッズを取れたレース数。 */
function dailyCoverage(db: DatabaseSync, date: string) {
  const programs = numberValue((db.prepare(`SELECT COUNT(*) AS n FROM official_programs WHERE date = ?`).get(date) as Record<string, unknown>).n);
  const t5Races = numberValue((db.prepare(`
SELECT COUNT(DISTINCT race_id) AS n FROM (
  SELECT race_id FROM odds_timeseries_snapshots
  WHERE race_id LIKE ? AND checkpoint_label = 'T-5'
  GROUP BY race_id, captured_at HAVING COUNT(DISTINCT selection) >= 120
)`).get(`${date.replaceAll("-", "")}-%`) as Record<string, unknown>).n);
  return { programs, t5Races };
}

function scorecardAlerts(now: Date): string[] {
  try {
    const path = "data/reports/scorecard/latest.json";
    if (!existsSync(path)) return [];
    const snapshot = accuracySnapshotFromReport(JSON.parse(readFileSync(path, "utf8")));
    if (!snapshot || now.getTime() - Date.parse(snapshot.generatedAt) > 48 * 3600_000) return [];
    return snapshot.alerts;
  } catch {
    return [];
  }
}

/**
 * 夜の日次まとめ（1通）。今日の BUY の結果は、確定結果（race_results）か、速報の通知文（「実着順: X」）から読む。
 * 以前は BUY 候補を1件ずつ別に送っていたが、21:30 にはレースが終わっていて紛らわしいので、まとめの中の一覧にした。
 */
function buildDailyNotifications(db: DatabaseSync, date: string, dryRun: boolean): NotificationRow[] {
  const counts = dailyCounts(db, date);
  const rows = db.prepare(`
WITH buy_rows AS (
  SELECT dh.*,
    ROW_NUMBER() OVER (PARTITION BY dh.race_id, dh.bet_type, dh.selection ORDER BY dh.created_at DESC, dh.id DESC) AS row_num
  FROM decision_history dh
  WHERE dh.date = ? AND dh.decision = 'BUY' AND dh.model_version = ? AND dh.run_kind = 'paper-live'
)
SELECT dh.race_id, dh.date, dh.venue, dh.race_no, dh.selection, p.close_at, rr.trifecta, rr.payout_yen, rr.returned,
  (SELECT n.sent_at FROM notification_log n WHERE n.race_id = dh.race_id AND n.channel = 'line' AND n.status = 'SENT') AS sent_at,
  (SELECT MIN(e.fetched_at) FROM exhibition_data e WHERE e.race_id = dh.race_id) AS info_at,
  (SELECT n.body FROM notification_log n WHERE n.race_id = 'line-buy-result-fast-' || dh.race_id AND n.channel = 'line' AND n.status IN ('SENT', 'IN_SUMMARY')) AS fast_body
FROM buy_rows dh
LEFT JOIN official_programs p ON p.race_id = dh.race_id
LEFT JOIN race_results rr ON rr.race_id = dh.race_id
WHERE dh.row_num = 1
ORDER BY p.close_at, dh.venue, dh.race_no
`).all(date, LIVE_MONITOR_MODEL_VERSION) as Array<{
    race_id: string; date: string; venue: string; race_no: number; selection: string; close_at: string | null;
    trifecta: string | null; payout_yen: number | null; returned: number | null; sent_at: string | null; info_at: string | null; fast_body: string | null;
  }>;
  const todayBuys: DailyBuy[] = rows.map((row) => {
    const fastResult = row.fast_body?.match(/実着順: (\d-\d-\d)\n/)?.[1] ?? null;
    const fastPayout = row.fast_body?.match(/払戻 ([\d,]+)円/)?.[1];
    const resultSelection = row.trifecta ?? fastResult;
    const result: DailyBuy["result"] = row.returned ? "returned" : resultSelection == null ? "pending" : resultSelection === row.selection ? "hit" : "miss";
    const payoutYen = row.trifecta != null ? row.payout_yen : fastPayout ? Number(fastPayout.replaceAll(",", "")) : null;
    return {
      venue: row.venue,
      raceNo: row.race_no,
      selection: row.selection,
      notified: classifyBuyTiming({ date: row.date, closeAt: row.close_at, sentAt: row.sent_at, infoAt: row.info_at }) === "notified",
      result,
      payoutYen,
    };
  });
  const ledgers = loadBuyLedgers(db, date);
  const message = formatDailySummary({
    date,
    todayBuys,
    lastSettledDay: ledgers.lastSettledDay,
    month: ledgers.month,
    total: ledgers.total,
    sinceFix: ledgers.sinceFix,
    notifiedTotal: ledgers.notifiedTotal,
    alerts: scorecardAlerts(new Date()),
    counts,
    coverage: dailyCoverage(db, date),
  });
  const summary = upsertPendingNotification(db, {
    raceId: `line-daily-${date}`,
    title: message.title,
    body: message.body,
    officialUrl: "https://www.boatrace.jp/",
    dryRun,
  });
  return summary ? [summary] : [];
}

async function deliverNotifications(db: DatabaseSync | null, notifications: NotificationRow[], dryRun: boolean) {
  if (notifications.length === 0) {
    console.log("LINE notify: no pending notifications");
    return;
  }

  const envConfig = lineMessagingConfigFromEnv(process.env);
  if (!envConfig.enabled && !dryRun) {
    console.log(`LINE notify skipped: ${envConfig.reason}`);
    return;
  }

  const recipients = envConfig.enabled ? envConfig.config.recipients : envConfig.recipients;
  for (const notification of notifications) {
    const text = buildLineText(notification.title, notification.body, notification.officialUrl);
    if (dryRun || (envConfig.enabled && envConfig.config.dryRun)) {
      console.log("--- LINE dry-run ---");
      console.log(`recipients=${recipients.length > 0 ? recipients.length : "<BOAT_PON_LINE_TO>"}`);
      console.log(text);
      continue;
    }

    if (!envConfig.enabled) continue;
    await sendLinePushTextToRecipients({
      channelAccessToken: envConfig.config.channelAccessToken,
      recipients: envConfig.config.recipients,
      text,
      endpoint: envConfig.config.endpoint,
    });
    if (db && notification.id > 0) markNotificationSent(db, notification.id);
    console.log(`LINE notify sent: ${notification.raceId}`);
  }
}

// ─── results mode: レース結果通知 ─────────────────────────────────────────

type ResultRow = {
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  selection: string;
  bet_type: string;
  current_odds: number | null;
  recommended_stake_yen: number;
  trifecta: string | null;
  winning_payout_yen: number | null;
  returned: number | null;
};

function listBuyResults(db: DatabaseSync, from: string, to: string): ResultRow[] {
  return db.prepare(`
WITH buy_rows AS (
  SELECT dh.*,
    ROW_NUMBER() OVER (
      PARTITION BY dh.race_id, dh.bet_type, dh.selection
      ORDER BY dh.created_at DESC, dh.id DESC
    ) AS row_num
  FROM decision_history dh
  WHERE dh.date >= ? AND dh.date <= ?
    AND dh.decision = 'BUY'
    AND dh.model_version = ?
    AND dh.run_kind = 'paper-live'
)
SELECT
  dh.race_id, dh.date, dh.venue, dh.race_no, dh.selection, dh.bet_type,
  dh.current_odds, dh.recommended_stake_yen,
  rr.trifecta,
  rr.payout_yen AS winning_payout_yen,
  rr.returned
FROM buy_rows dh
JOIN race_results rr ON rr.race_id = dh.race_id
WHERE dh.row_num = 1
  AND dh.bet_type IN ('trifecta', '3連単')
  AND (rr.trifecta IS NOT NULL OR rr.returned != 0)
ORDER BY dh.date ASC, dh.venue ASC, dh.race_no ASC
`).all(from, to, LIVE_MONITOR_MODEL_VERSION) as ResultRow[];
}

function buildResultsNotifications(db: DatabaseSync, from: string, to: string, dryRun: boolean): NotificationRow[] {
  const rows = listBuyResults(db, from, to);
  const notifications: NotificationRow[] = [];
  const ledgers = loadBuyLedgers(db, todayJst());
  for (const row of rows) {
    // 締切後の速報（scripts/notify-buy-results-fast.ts）を送っていて（はずれを日次まとめに載せた IN_SUMMARY も含む）、着順が確定と同じなら、確定通知は送らない。
    const fast = db.prepare("SELECT status, body FROM notification_log WHERE race_id = ? AND channel = 'line' AND status IN ('SENT', 'IN_SUMMARY')")
      .get(`line-buy-result-fast-${row.race_id}`) as { status: string; body: string } | undefined;
    // IN_SUMMARY（はずれを日次まとめに載せた）は、その日の日次まとめが実際に送れたときだけ「伝えた」とみなす。
    // 日次まとめが失敗していたら、確定通知で知らせる（Codex のレビューの指摘）。
    const delivered = fast?.status === "SENT" || (fast?.status === "IN_SUMMARY" && db.prepare(
      "SELECT 1 FROM notification_log WHERE race_id = ? AND channel = 'line' AND status = 'SENT'",
    ).get(`line-daily-${row.date}`) != null);
    if (fast && delivered && row.trifecta && fast.body.includes(`実着順: ${row.trifecta}\n`)) continue;
    const message = buildBuyResultNotification({
      venue: row.venue,
      raceNo: row.race_no,
      betType: row.bet_type,
      selection: row.selection,
      resultSelection: row.trifecta,
      winningPayoutYen: row.winning_payout_yen,
      returned: row.returned !== 0,
      currentOdds: row.current_odds,
      tally: { month: ledgers.month, total: ledgers.total },
    });
    // 締切前にリアルタイム通知できなかった BUY は、行動できなかったことを結果の末尾に書いておく。
    const timing = db.prepare(`SELECT p.close_at,
      (SELECT n.sent_at FROM notification_log n WHERE n.race_id = ? AND n.channel = 'line' AND n.status = 'SENT') AS sent_at,
      (SELECT MIN(e.fetched_at) FROM exhibition_data e WHERE e.race_id = ?) AS info_at
      FROM official_programs p WHERE p.race_id = ?`).get(row.race_id, row.race_id, row.race_id) as { close_at: string | null; sent_at: string | null; info_at: string | null } | undefined;
    const notifiedBeforeClose = timing != null && classifyBuyTiming({ date: row.date, closeAt: timing.close_at, sentAt: timing.sent_at, infoAt: timing.info_at }) === "notified";
    const notification = upsertPendingNotification(db, {
      raceId: `line-buy-result-${row.race_id}-${row.bet_type}-${row.selection}`,
      title: message.title,
      body: notifiedBeforeClose ? message.body : `${message.body}\n（この BUY は締切前に通知できなかった。締切後の判定）`,
      officialUrl: officialResultUrl(row.date, row.venue, row.race_no),
      dryRun,
    });
    if (notification) notifications.push(notification);
  }
  return notifications;
}

// ─── weekly mode: 月曜の週次まとめ（先週と比べて良くなったか） ─────────────────
// 以前の forward mode（風速2〜4×展示1位の格上げ監視）は、候補監視の終了（2026-10-08）で役目を終えた。
// いまは scripts/report-growth.ts --no-months が書いた JSON を読んで、先週との比較を1通にする。

type GrowthRow = { key: string; from: string; to: string; buys: WeeklyWindow["buys"]; notified: number; decisionCoverage: number | null; t5Coverage: number | null; logLossGap: number | null };

function buildWeeklyNotifications(db: DatabaseSync, growthPath: string, dryRun: boolean): NotificationRow[] {
  if (!existsSync(growthPath)) {
    console.error(`weekly: ${growthPath} が無い（report-growth.ts --no-months を先に実行する）`);
    return [];
  }
  const growth = JSON.parse(readFileSync(growthPath, "utf8")) as { generatedAt: string; rows: GrowthRow[]; knowledgeAdded?: Record<string, number> };
  const now = new Date();
  if (now.getTime() - Date.parse(growth.generatedAt) > 48 * 3600_000) {
    console.error(`weekly: ${growthPath} が古い（${growth.generatedAt}）`);
    return [];
  }
  const pick = (key: string): WeeklyWindow | null => {
    const r = growth.rows.find((row) => row.key === key);
    return r ? { from: r.from, to: r.to, buys: r.buys, notified: r.notified, decisionCoverage: r.decisionCoverage, t5Coverage: r.t5Coverage, logLossGap: r.logLossGap } : null;
  };
  const thisWeek = pick("w0"), lastWeek = pick("w1");
  if (!thisWeek || !lastWeek) return [];
  const message = formatWeeklySummary({ thisWeek, lastWeek, knowledgeAdded: growth.knowledgeAdded?.w0 ?? 0, alerts: scorecardAlerts(now), total: loadBuyLedgers(db, todayJst()).total });
  const notification = upsertPendingNotification(db, {
    raceId: `line-weekly-growth-${thisWeek.to}`,
    title: message.title,
    body: message.body,
    officialUrl: "https://www.boatrace.jp/",
    dryRun,
  });
  return notification ? [notification] : [];
}

// ─── errors mode: エラーアラート ───────────────────────────────────────────

type FailedJobRow = {
  job_name: string;
  error_message: string | null;
};

function listFailedJobs(db: DatabaseSync, date: string): FailedJobRow[] {
  return db.prepare(`
SELECT job_name, error_message
FROM job_runs
WHERE target_date = ? AND status = 'failed'
ORDER BY job_name
`).all(date) as FailedJobRow[];
}

function countLogErrors(date: string): Array<{ file: string; count: number }> {
  const logDir = "data/logs";
  const errFiles = ["auto-odds-err.log", "auto-exhibition-err.log", "daily-results-err.log", "daily-programs-err.log"];
  const results: Array<{ file: string; count: number }> = [];
  for (const file of errFiles) {
    const path = `${logDir}/${file}`;
    if (!existsSync(path)) continue;
    const content = readFileSync(path, "utf-8");
    const count = content.split("\n").filter((line) => line.includes(date)).length;
    if (count > 0) results.push({ file, count });
  }
  return results;
}

function buildErrorNotifications(db: DatabaseSync, date: string, dryRun: boolean): NotificationRow[] {
  const failedJobs = listFailedJobs(db, date);
  const logErrors = countLogErrors(date);

  if (failedJobs.length === 0 && logErrors.length === 0) return [];

  const lines: string[] = [];
  if (failedJobs.length > 0) {
    lines.push("■ ジョブ失敗:");
    for (const j of failedJobs) {
      const msg = j.error_message ? `: ${j.error_message.slice(0, 80)}` : "";
      lines.push(`  ${j.job_name}${msg}`);
    }
  }
  if (logErrors.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("■ ログエラー:");
    for (const e of logErrors) {
      lines.push(`  ${e.file}: ${e.count}件`);
    }
  }

  const totalErrors = failedJobs.length + logErrors.reduce((s, e) => s + e.count, 0);
  const title = `⚠️ Boat Pon エラー | ${totalErrors}件 | ${date}`;
  const body = lines.join("\n");

  const notifications: NotificationRow[] = [];
  const n = upsertPendingNotification(db, {
    raceId: `line-errors-${date}`,
    title,
    body,
    officialUrl: "",
    dryRun,
  });
  if (n) notifications.push(n);
  return notifications;
}

// ─── main ─────────────────────────────────────────────────────────────────

async function run() {
  loadEnvFiles([".env"]);
  const args = process.argv.slice(2);
  const mode = parseMode(args);
  const dryRun = hasFlag(args, "--dry-run") || process.env.BOAT_PON_LINE_DRY_RUN === "1" || process.env.BOAT_PON_LINE_DRY_RUN === "true";

  if (mode === "test") {
    const message = argValue(args, "--message") ?? `Boat Pon LINE test ${new Date().toISOString()}`;
    await deliverNotifications(null, [{
      id: 0,
      raceId: "line-test",
      title: "🚤 Boat Pon LINE test",
      body: message,
      officialUrl: "https://www.boatrace.jp/",
    }], dryRun);
    return;
  }

  const date = argValue(args, "--date") ?? todayJst();
  const db = new DatabaseSync(process.env.BOAT_PON_DB_URI ?? "data/boat.sqlite", PREVIEW ? { readOnly: true } : {});
  try {
    let notifications: NotificationRow[];
    switch (mode) {
      case "daily":
        notifications = buildDailyNotifications(db, date, dryRun);
        break;
      case "results":
        notifications = buildResultsNotifications(
          db,
          argValue(args, "--from") ?? date,
          argValue(args, "--to") ?? date,
          dryRun,
        );
        break;
      case "weekly":
        notifications = buildWeeklyNotifications(db, argValue(args, "--growth-json") ?? "data/reports/scorecard/growth-weekly.json", dryRun);
        break;
      case "errors":
        notifications = buildErrorNotifications(db, date, dryRun);
        break;
    }
    if (PREVIEW) {
      for (const n of notifications) console.log(`--- ${n.raceId}\n${buildLineText(n.title, n.body, n.officialUrl)}\n`);
      return;
    }
    notifications = mergeRecentPendingNotifications(db, notifications, dryRun);
    await deliverNotifications(db, notifications, dryRun);
  } finally {
    db.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
