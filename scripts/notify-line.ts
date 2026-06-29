import { DatabaseSync } from "node:sqlite";
import { loadEnvFiles } from "../src/domain/envFile";
import { officialOddsUrl } from "../src/domain/officialLinks";
import { buildLineText, lineMessagingConfigFromEnv, sendLinePushTextToRecipients } from "../src/domain/lineMessaging";
import { LIVE_MONITOR_MODEL_VERSION } from "../src/domain/liveMonitor";

type Mode = "daily" | "test";

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
    "",
    "Env file:",
    "  Copy .env.example to .env.local and set LINE credentials there.",
    "",
    "Required env for actual send:",
    "  BOAT_PON_LINE_CHANNEL_ACCESS_TOKEN=<Messaging API channel access token>",
    "  BOAT_PON_LINE_TO=<userId,groupId,or roomId>[,<more recipients>]",
    "",
    "Optional env:",
    "  BOAT_PON_LINE_DRY_RUN=1",
    "  BOAT_PON_LINE_ENDPOINT=https://api.line.me/v2/bot/message/push",
  ].join("\n");
}

function parseMode(args: string[]): Mode {
  const first = args.find((arg) => !arg.startsWith("--"));
  if (first === "daily" || first === "test") return first;
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

function buildDailySummary(date: string, counts: DailyCounts, buyRows: BuyRow[]) {
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
    "※購入指示ではなくpaper検証候補です。",
  ].join("\n");
}

function buildDailyNotifications(db: DatabaseSync, date: string, dryRun: boolean): NotificationRow[] {
  const counts = dailyCounts(db, date);
  const buyRows = listBuyRows(db, date);
  const notifications: NotificationRow[] = [];

  const summaryTitle = counts.buy > 0
    ? `🚤 Boat Pon Daily | BUY ${counts.buy}件 | ${date}`
    : `🚤 Boat Pon Daily | ${date}`;
  const summary = upsertPendingNotification(db, {
    raceId: `line-daily-${date}`,
    title: summaryTitle,
    body: buildDailySummary(date, counts, buyRows),
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

async function run() {
  loadEnvFiles();
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
    const notifications = buildDailyNotifications(db, date, dryRun);
    await deliverNotifications(db, notifications, dryRun);
  } finally {
    db.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
