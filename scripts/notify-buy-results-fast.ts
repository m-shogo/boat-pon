/**
 * BUY を出したレースの結果を、締切後すぐに LINE で知らせる（速報）。
 * 以前は結果の通知が翌日以降の 21:30（公式 K ファイルの取り込み後）にしか届かなかった。
 *
 * launchd から 10 分ごとに呼ぶ想定（docs/launchd/com.boatpon.buy-results-fast.plist。登録はユーザーが行う）。
 * 公式サイトへのアクセスは「今日の paper-live BUY で、締切から 8〜120 分たったレース」の結果ページだけで、1回の実行で最大 6 件。
 * 正式な精算は翌日の K ファイル取り込み（race_results）で行う。速報と同じ結果なら、翌日の確定通知は送らない（notify-line.ts results）。
 * 書き込むのは notification_log だけ。--dry-run では取得と判定を表示するだけで、送信も書き込みもしない。
 *
 * 使い方: npx tsx scripts/notify-buy-results-fast.ts [--date YYYY-MM-DD] [--dry-run]
 *   --dry-run と --date を一緒に使うと、過去日の動作確認として締切後の時間帯の条件を外す。
 */
import { DatabaseSync } from "node:sqlite";
import { classifyBuyTiming } from "../src/domain/accuracyScorecard";
import { buildBuyResultNotification } from "../src/domain/buyResultNotification";
import { loadEnvFiles } from "../src/domain/envFile";
import { buildLineText, lineMessagingConfigFromEnv, sendLinePushTextToRecipients } from "../src/domain/lineMessaging";
import { LIVE_MONITOR_MODEL_VERSION } from "../src/domain/liveMonitor";
import { minutesUntilRaceClose } from "../src/domain/livePersistence";
import { officialOddsUrl } from "../src/domain/officialLinks";
import { parseRaceResultTrifecta } from "../src/domain/officialRaceResultPage";
import { venueCodes } from "./fetch-official-odds";

const MIN_MINUTES_AFTER_CLOSE = 8;
const MAX_MINUTES_AFTER_CLOSE = 120;
const MAX_FETCHES_PER_RUN = 6;
const FETCH_TIMEOUT_MS = 20_000;

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const dateArgIndex = args.indexOf("--date");
const todayJst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
const DATE = dateArgIndex >= 0 ? args[dateArgIndex + 1] : todayJst;
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) throw new Error(`invalid --date: ${DATE}`);
const jstHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
if (dateArgIndex < 0 && (jstHour < 9 || jstHour >= 23)) {
  console.log("notify-buy-results-fast: outside 09:00-23:00 JST, skip");
  process.exit(0);
}

const db = new DatabaseSync(process.env.BOAT_PON_DB_URI ?? "data/boat.sqlite", DRY_RUN ? { readOnly: true } : {});
db.exec("PRAGMA busy_timeout = 30000;");
try {
  type Buy = { race_id: string; date: string; venue: string; race_no: number; selection: string; bet_type: string; current_odds: number | null; close_at: string | null };
  const buys = db.prepare(`
SELECT d.race_id, d.date, d.venue, d.race_no, d.selection, d.bet_type, d.current_odds, p.close_at
FROM decision_history d
LEFT JOIN official_programs p ON p.race_id = d.race_id
WHERE d.date = ? AND d.decision = 'BUY' AND d.run_kind = 'paper-live' AND d.model_version = ?
  AND d.bet_type IN ('trifecta', '3連単')
ORDER BY p.close_at
`).all(DATE, LIVE_MONITOR_MODEL_VERSION) as Buy[];

  let fetches = 0, sent = 0, pending = 0;
  for (const buy of buys) {
    const key = `line-buy-result-fast-${buy.race_id}`;
    const already = db.prepare("SELECT status FROM notification_log WHERE race_id = ? AND channel = 'line'").get(key) as { status: string } | undefined;
    if (already?.status === "SENT" || !buy.close_at) continue;
    const minutesAfterClose = -minutesUntilRaceClose(buy.date, buy.close_at, new Date());
    // 過去日付の dry-run（動作確認）のときだけ、締切後の時間帯の条件を外す。
    const ignoreWindow = DRY_RUN && dateArgIndex >= 0;
    if (!ignoreWindow && (minutesAfterClose < MIN_MINUTES_AFTER_CLOSE || minutesAfterClose > MAX_MINUTES_AFTER_CLOSE)) continue;
    const jcd = venueCodes[buy.venue];
    if (!jcd) continue;
    if (fetches >= MAX_FETCHES_PER_RUN) break;
    fetches += 1;

    const url = `https://www.boatrace.jp/owpc/pc/race/raceresult?rno=${buy.race_no}&jcd=${jcd}&hd=${buy.date.replaceAll("-", "")}`;
    let parsed;
    try {
      const res = await fetch(url, { headers: { "user-agent": "BoatPon/0.1 personal low-frequency fetch" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      parsed = parseRaceResultTrifecta(await res.text());
    } catch (err) {
      console.error(`fast-result fetch failed: ${buy.race_id} ${err instanceof Error ? err.message : err}`);
      continue;
    }
    if (!parsed) {
      pending += 1;
      console.log(`fast-result not yet: ${buy.race_id} (+${minutesAfterClose.toFixed(0)}m)`);
      continue;
    }

    const hit = parsed.combinations.includes(buy.selection);
    const deadHeat = parsed.combinations.length > 1;
    const message = buildBuyResultNotification({
      venue: buy.venue,
      raceNo: buy.race_no,
      betType: buy.bet_type,
      selection: buy.selection,
      resultSelection: hit ? buy.selection : parsed.combinations[0],
      winningPayoutYen: deadHeat ? null : parsed.payoutYen,
      returned: false,
      currentOdds: buy.current_odds,
    });
    const title = message.title.replace("BUY事後結果", "BUY結果（速報）");
    // 締切前にリアルタイム通知できなかった BUY（締切後の再評価で BUY になったもの）は、その旨を先頭に書く。
    const timing = db.prepare(`SELECT
      (SELECT n.sent_at FROM notification_log n WHERE n.race_id = ? AND n.channel = 'line' AND n.status = 'SENT') AS sent_at,
      (SELECT MIN(e.fetched_at) FROM exhibition_data e WHERE e.race_id = ?) AS info_at`).get(buy.race_id, buy.race_id) as { sent_at: string | null; info_at: string | null };
    const notifiedBeforeClose = classifyBuyTiming({ date: buy.date, closeAt: buy.close_at, sentAt: timing.sent_at, infoAt: timing.info_at }) === "notified";
    const body = [notifiedBeforeClose ? null : "※このBUYは締切前に通知できなかった（締切後の判定）。", message.body, deadHeat ? `同着: ${parsed.combinations.join(" / ")}（払戻は翌日の確定で）` : null, "公式の確定値は翌日の取り込みで再確認します。"].filter(Boolean).join("\n");
    const oddsUrl = officialOddsUrl(buy.date, buy.venue, buy.race_no);

    if (DRY_RUN) {
      console.log(`[dry-run] ${title}\n${body}\n`);
      continue;
    }
    loadEnvFiles([".env"]);
    const envConfig = lineMessagingConfigFromEnv(process.env);
    if (!envConfig.enabled || envConfig.config.dryRun) {
      console.log(`fast-result LINE disabled: ${buy.race_id}`);
      continue;
    }
    await sendLinePushTextToRecipients({
      channelAccessToken: envConfig.config.channelAccessToken,
      recipients: envConfig.config.recipients,
      text: buildLineText(title, body, oddsUrl),
      endpoint: envConfig.config.endpoint,
    });
    db.prepare(`
INSERT INTO notification_log (race_id, channel, status, title, body, official_url, sent_at)
VALUES (?, 'line', 'SENT', ?, ?, ?, CURRENT_TIMESTAMP)
ON CONFLICT(race_id, channel) DO UPDATE SET status='SENT', title=?, body=?, official_url=?, sent_at=CURRENT_TIMESTAMP
`).run(key, title, body, oddsUrl, title, body, oddsUrl);
    sent += 1;
    console.log(`fast-result sent: ${buy.race_id} ${hit ? "hit" : "miss"}`);
  }
  console.log(`notify-buy-results-fast done: date=${DATE} buys=${buys.length} fetches=${fetches} sent=${sent} pending=${pending} dryRun=${DRY_RUN}`);
} finally {
  db.close();
}
