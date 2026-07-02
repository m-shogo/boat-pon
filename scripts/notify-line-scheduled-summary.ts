import { DatabaseSync } from "node:sqlite";
import { loadEnvFiles } from "../src/domain/envFile";
import { buildLineText, lineMessagingConfigFromEnv, sendLinePushTextToRecipients } from "../src/domain/lineMessaging";
import { LIVE_MONITOR_MODEL_VERSION } from "../src/domain/liveMonitor";

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

function numberValue(value: unknown) {
  return value == null ? 0 : Number(value);
}

function formatOdds(value: number | null) {
  return value == null ? "未取得" : `${value.toFixed(1)}倍`;
}

type BuyPreviewRow = {
  venue: string;
  race_no: number;
  selection: string;
  current_odds: number | null;
};

async function main() {
  loadEnvFiles([".env"]);
  const args = process.argv.slice(2);
  const date = argValue(args, "--date") ?? todayJst();
  const dryRun = hasFlag(args, "--dry-run") || process.env.BOAT_PON_LINE_DRY_RUN === "1" || process.env.BOAT_PON_LINE_DRY_RUN === "true";

  const db = new DatabaseSync("data/boat.sqlite", { readOnly: true });
  try {
    const counts = db.prepare(`
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

    const buyRows = db.prepare(`
SELECT venue, race_no, selection, current_odds
FROM decision_history
WHERE date = ?
  AND decision = 'BUY'
  AND model_version = ?
  AND run_kind = 'paper-live'
ORDER BY venue ASC, race_no ASC, race_id ASC
LIMIT 5
`).all(date, LIVE_MONITOR_MODEL_VERSION) as BuyPreviewRow[];

    const total = numberValue(counts.total);
    const buy = numberValue(counts.buy);
    const watch = numberValue(counts.watch);
    const skip = numberValue(counts.skip);
    const oddsPresent = numberValue(counts.odds_present);
    const title = buy > 0 ? `🚤 Boat Pon 21:30 | BUY ${buy}件 | ${date}` : `🚤 Boat Pon 21:30 | ${date}`;
    const buyPreview = buyRows.map((row) => `・${row.venue} ${row.race_no}R ${row.selection} / ${formatOdds(row.current_odds)}`);
    const body = [
      `BUY=${buy} WATCH=${watch} SKIP=${skip}`,
      `odds=${total > 0 ? `${oddsPresent}/${total}` : "0/0"}`,
      `model=${LIVE_MONITOR_MODEL_VERSION} / paper-live`,
      buyPreview.length > 0 ? ["", "BUY候補:", ...buyPreview].join("\n") : "BUY候補なし。買わない日として観察継続。",
      "",
      "※21:30本番サマリ。購入指示ではなくpaper検証候補です。",
    ].join("\n");

    const envConfig = lineMessagingConfigFromEnv(process.env);
    const text = buildLineText(title, body, "https://www.boatrace.jp/");
    const recipients = envConfig.enabled ? envConfig.config.recipients : envConfig.recipients;
    if (dryRun || (envConfig.enabled && envConfig.config.dryRun)) {
      console.log("--- LINE scheduled summary dry-run ---");
      console.log(`to=${recipients.length > 0 ? recipients.join(",") : "<BOAT_PON_LINE_TO>"}`);
      console.log(text);
      return;
    }
    if (!envConfig.enabled) {
      console.log(`LINE scheduled summary skipped: ${envConfig.reason}`);
      return;
    }

    await sendLinePushTextToRecipients({
      channelAccessToken: envConfig.config.channelAccessToken,
      recipients: envConfig.config.recipients,
      text,
      endpoint: envConfig.config.endpoint,
    });
    console.log(`LINE scheduled summary sent: ${date}`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
