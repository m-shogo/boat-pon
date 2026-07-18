import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { loadEnvFiles } from "../src/domain/envFile";
import { officialOddsUrl, teleBoatUrl } from "../src/domain/officialLinks";
import { buildLineText, lineMessagingConfigFromEnv, sendLinePushTextToRecipients } from "../src/domain/lineMessaging";
import { formatNoBuyReasonSummary, summarizeNoBuyReasons } from "../src/domain/lineDailySummary";
import { LIVE_MONITOR_MODEL_VERSION } from "../src/domain/liveMonitor";

type Mode = "daily" | "test" | "results" | "forward" | "errors";

type NotificationRow = {
  id: number;
  raceId: string;
  title: string;
  body: string;
  officialUrl: string;
};

type BuyRow = {
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  bet_type: string;
  selection: string;
  estimated_hit_rate: number;
  raw_estimated_hit_rate: number | null;
  required_odds: number;
  current_odds: number | null;
  ev: number | null;
  recommended_stake_yen: number;
  sample_size: number;
  model_version: string | null;
  run_kind: string;
  decision_reasons: string | null;
  created_at: string;
};

type DailyCounts = {
  buy: number;
  watch: number;
  skip: number;
  total: number;
  oddsPresent: number;
};

type NoBuyReasonRow = {
  decision_reasons: string | null;
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
    "  pnpm notify:line:results [--date YYYY-MM-DD] [--dry-run]",
    "  pnpm notify:line:forward [--dry-run]",
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
  if (first === "daily" || first === "test" || first === "results" || first === "forward" || first === "errors") return first;
  throw new Error(`Unknown mode: ${first ?? "(missing)"}\n${usage()}`);
}

function numberValue(value: unknown): number {
  return value == null ? 0 : Number(value);
}

function formatOdds(value: number | null) {
  return value == null ? "未取得" : `${value.toFixed(1)}倍`;
}

function parseReasons(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // ignore invalid legacy JSON
  }
  return [];
}

function formatBuyBody(row: BuyRow) {
  const reasons = parseReasons(row.decision_reasons);
  const voteUrl = teleBoatUrl(row.date, row.venue, row.race_no);
  const lines = [
    `候補: ${row.selection}`,
    `券種: ${row.bet_type}`,
    `推定的中率: ${(row.estimated_hit_rate * 100).toFixed(1)}%`,
    row.raw_estimated_hit_rate == null ? null : `保守化前推定: ${(row.raw_estimated_hit_rate * 100).toFixed(1)}%`,
    `必要オッズ: ${row.required_odds.toFixed(1)}倍以上`,
    `取得オッズ: ${formatOdds(row.current_odds)}`,
    `EV: ${row.ev == null ? "-" : row.ev.toFixed(2)}`,
    `推奨stake: ${row.recommended_stake_yen}円`,
    `sample: n=${row.sample_size}`,
    `model: ${row.model_version ?? "unknown"} / ${row.run_kind}`,
    reasons.length > 0 ? `理由: ${reasons.slice(0, 3).join(" / ")}` : null,
    "",
    `投票: ${voteUrl}`,
    "【paper観察モード】実購入なし。公式オッズで確認して検証・反省用。",
  ].filter((line): line is string => line != null);
  return lines.join("\n");
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

function listBuyRows(db: DatabaseSync, date: string): BuyRow[] {
  return db.prepare(`
SELECT
  race_id,
  date,
  venue,
  race_no,
  bet_type,
  selection,
  estimated_hit_rate,
  raw_estimated_hit_rate,
  required_odds,
  current_odds,
  ev,
  recommended_stake_yen,
  sample_size,
  model_version,
  run_kind,
  decision_reasons,
  created_at
FROM decision_history
WHERE date = ?
  AND decision = 'BUY'
  AND model_version = ?
  AND run_kind = 'paper-live'
ORDER BY venue ASC, race_no ASC, race_id ASC
`).all(date, LIVE_MONITOR_MODEL_VERSION) as BuyRow[];
}

function listNoBuyReasonRows(db: DatabaseSync, date: string): NoBuyReasonRow[] {
  return db.prepare(`
SELECT decision_reasons
FROM decision_history
WHERE date = ?
  AND decision IN ('WATCH', 'SKIP')
  AND model_version = ?
  AND run_kind = 'paper-live'
`).all(date, LIVE_MONITOR_MODEL_VERSION) as NoBuyReasonRow[];
}

function buildDailySummary(date: string, counts: DailyCounts, buyRows: BuyRow[], noBuyReasonRows: NoBuyReasonRow[]) {
  const buyPreview = buyRows.slice(0, 5).map((row) => {
    const odds = formatOdds(row.current_odds);
    return `・${row.venue} ${row.race_no}R ${row.selection} / ${odds}`;
  });
  const oddsRate = counts.total > 0 ? `${counts.oddsPresent}/${counts.total}` : "0/0";
  return [
    `BUY=${counts.buy} WATCH=${counts.watch} SKIP=${counts.skip}`,
    `odds=${oddsRate}`,
    `model=${LIVE_MONITOR_MODEL_VERSION} / paper-live`,
    buyPreview.length > 0 ? ["", "BUY候補:", ...buyPreview].join("\n") : "BUY候補なし。買わない日として観察継続。",
    "",
    formatNoBuyReasonSummary(summarizeNoBuyReasons(noBuyReasonRows.map((row) => row.decision_reasons))),
    "",
    "※購入指示ではなくpaper検証候補です。",
  ].join("\n");
}

function buildDailyNotifications(db: DatabaseSync, date: string, dryRun: boolean): NotificationRow[] {
  const counts = dailyCounts(db, date);
  const buyRows = listBuyRows(db, date);
  const noBuyReasonRows = listNoBuyReasonRows(db, date);
  const notifications: NotificationRow[] = [];

  const summaryTitle = counts.buy > 0
    ? `🚤 Boat Pon Daily | BUY ${counts.buy}件 | ${date}`
    : `🚤 Boat Pon Daily | ${date}`;
  const summary = upsertPendingNotification(db, {
    raceId: `line-daily-${date}`,
    title: summaryTitle,
    body: buildDailySummary(date, counts, buyRows, noBuyReasonRows),
    officialUrl: "https://www.boatrace.jp/",
    dryRun,
  });
  if (summary) notifications.push(summary);

  for (const row of buyRows) {
    const officialUrl = officialOddsUrl(row.date, row.venue, row.race_no);
    const notification = upsertPendingNotification(db, {
      raceId: row.race_id,
      title: `🎯 BUY候補: ${row.venue} ${row.race_no}R`,
      body: formatBuyBody(row),
      officialUrl,
      dryRun,
    });
    if (notification) notifications.push(notification);
  }

  return notifications;
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
      console.log(`to=${recipients.length > 0 ? recipients.join(",") : "<BOAT_PON_LINE_TO>"}`);
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
  payout_yen: number | null;
};

function listBuyResults(db: DatabaseSync, date: string): ResultRow[] {
  return db.prepare(`
SELECT
  dh.race_id, dh.date, dh.venue, dh.race_no, dh.selection, dh.bet_type,
  dh.current_odds, dh.recommended_stake_yen,
  rr.trifecta,
  rp.payout_yen
FROM decision_history dh
LEFT JOIN race_results rr ON rr.race_id = dh.race_id
LEFT JOIN race_payouts rp ON rp.race_id = dh.race_id
  AND rp.bet_type = dh.bet_type AND rp.combination = dh.selection
WHERE dh.date = ?
  AND dh.decision = 'BUY'
  AND dh.source = 'history-model'
  AND dh.model_version = ?
ORDER BY dh.venue ASC, dh.race_no ASC
`).all(date, LIVE_MONITOR_MODEL_VERSION) as ResultRow[];
}

function buildResultsNotifications(db: DatabaseSync, date: string, dryRun: boolean): NotificationRow[] {
  const rows = listBuyResults(db, date);
  if (rows.length === 0) return [];

  const settled = rows.filter((r) => r.trifecta != null);
  if (settled.length === 0) return [];

  const hits = settled.filter((r) => r.payout_yen != null && r.payout_yen > 0);
  const misses = settled.filter((r) => r.payout_yen == null || r.payout_yen === 0);

  const totalStake = settled.length * 100;
  const totalPayout = hits.reduce((s, r) => s + (r.payout_yen ?? 0), 0);
  const profit = totalPayout - totalStake;
  const profitSign = profit >= 0 ? "+" : "";

  const lines: string[] = [];
  for (const r of hits) {
    lines.push(`的中: ${r.venue}${r.race_no}R ${r.selection} → ${(r.payout_yen ?? 0).toLocaleString()}円 🎯`);
  }
  for (const r of misses) {
    lines.push(`不的中: ${r.venue}${r.race_no}R ${r.selection} (実際: ${r.trifecta ?? "不明"})`);
  }
  lines.push("");
  lines.push(`収支: ${profitSign}${profit.toLocaleString()}円 (stake ${totalStake.toLocaleString()}円)`);
  lines.push("※paper検証。実購入なし。");

  const title = `🏁 Boat Pon 結果 | ${hits.length}勝${misses.length}敗 | ${date}`;
  const body = lines.join("\n");

  const notifications: NotificationRow[] = [];
  const n = upsertPendingNotification(db, {
    raceId: `line-results-${date}`,
    title,
    body,
    officialUrl: "https://www.boatrace.jp/",
    dryRun,
  });
  if (n) notifications.push(n);
  return notifications;
}

// ─── forward mode: Forward ROI 週次サマリー ────────────────────────────────

const FORWARD_START = "2025-01-01";
const FORWARD_STAKE = 100;
const EXCLUDED_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACE_NOS = [10, 11, 12];

function isoWeek(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00+09:00");
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const dayOfYear = Math.floor((d.getTime() - jan4.getTime()) / 86400000) + 4;
  const weekNum = Math.ceil(dayOfYear / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function buildForwardNotifications(db: DatabaseSync, dryRun: boolean): NotificationRow[] {
  const venueExcl = EXCLUDED_VENUES.map((v) => `'${v}'`).join(",");
  const raceNoExcl = EXCLUDED_RACE_NOS.join(",");
  const baseWhere = `
    decision='BUY' AND run_kind='historical-backfill'
    AND result IS NOT NULL AND result != ''
    AND venue NOT IN (${venueExcl})
    AND race_no NOT IN (${raceNoExcl})
    AND date >= '${FORWARD_START}'
  `;

  const baseline = db.prepare(`
SELECT COUNT(*) as n,
  SUM(CASE WHEN result=selection THEN 1 ELSE 0 END) as hits,
  SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp
    WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta'
    AND rp.combination=dh.selection LIMIT 1), 0)) as pr
FROM decision_history dh
WHERE ${baseWhere} AND selection='1-2-3'
`).get() as { n: number; hits: number; pr: number };

  const baseN = baseline.n ?? 0;
  const baseRoi = baseN > 0 ? Math.round(((baseline.pr ?? 0) / (baseN * FORWARD_STAKE)) * 10000) / 100 : 0;

  const wind24Exh1Where = `
    ${baseWhere}
    AND EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)
    AND EXISTS (SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
        AND ed.exhibition_time IS NOT NULL
        AND ed.exhibition_time = (
          SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2 WHERE ed2.race_id=dh.race_id
        ))
  `;

  const sw = db.prepare(`
SELECT COUNT(*) as n,
  SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp
    WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta'
    AND rp.combination='1-3-2' LIMIT 1), 0)) as pr132
FROM decision_history dh
WHERE ${wind24Exh1Where}
`).get() as { n: number; pr132: number };

  const swN = sw.n ?? 0;
  const swStake = swN * FORWARD_STAKE;

  const allPr132 = db.prepare(`
SELECT COALESCE((SELECT rp.payout_yen FROM race_payouts rp
  WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta'
  AND rp.combination='1-3-2' LIMIT 1), 0) as pr132
FROM decision_history dh
WHERE ${wind24Exh1Where}
ORDER BY pr132 DESC
`).all().map((r) => (r as { pr132: number }).pr132);
  const top2Sum = (allPr132[0] ?? 0) + (allPr132[1] ?? 0);
  const top2ExclRoi = swStake > 0 ? Math.round((((sw.pr132 ?? 0) - top2Sum) / swStake) * 10000) / 100 : 0;

  const upgradeTarget = 200;
  const remaining = Math.max(0, upgradeTarget - swN);
  let verdict: string;
  if (swN < 30) {
    verdict = "判定不可(n<30)";
  } else if (remaining > 0) {
    verdict = `⏳格上げ待ち (残り${remaining}件)`;
  } else if (top2ExclRoi >= 100) {
    verdict = "✅格上げ候補";
  } else {
    verdict = "観察継続";
  }

  const today = todayJst();
  const lines = [
    `■ 風速2〜4×展示1位 1-3-2`,
    `  forward n=${swN}/${upgradeTarget} | top2除外ROI: ${top2ExclRoi}%`,
    `  判定: ${verdict}`,
    "",
    `■ 全体 baseline (1-2-3)`,
    `  forward n=${baseN} | payout ROI: ${baseRoi}%`,
    "",
    "※実払戻ベース。current_odds判断は参考値。",
  ];

  const week = isoWeek(today);
  const title = `📊 Forward週次 | ${today}`;
  const body = lines.join("\n");

  const notifications: NotificationRow[] = [];
  const n = upsertPendingNotification(db, {
    raceId: `line-forward-weekly-${week}`,
    title,
    body,
    officialUrl: "https://www.boatrace.jp/",
    dryRun,
  });
  if (n) notifications.push(n);
  return notifications;
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
  const db = new DatabaseSync("data/boat.sqlite");
  try {
    let notifications: NotificationRow[];
    switch (mode) {
      case "daily":
        notifications = buildDailyNotifications(db, date, dryRun);
        break;
      case "results":
        notifications = buildResultsNotifications(db, date, dryRun);
        break;
      case "forward":
        notifications = buildForwardNotifications(db, dryRun);
        break;
      case "errors":
        notifications = buildErrorNotifications(db, date, dryRun);
        break;
    }
    await deliverNotifications(db, notifications, dryRun);
  } finally {
    db.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
