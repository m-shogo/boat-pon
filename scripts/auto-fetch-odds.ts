/**
 * 今日の候補レースのオッズを自動取得し、decision_history に保存する。
 *
 * cron / launchd で定期実行する想定（例: 毎15分）。
 * サーバー不要で単体動作する。
 *
 * usage:
 *   tsx scripts/auto-fetch-odds.ts [--dry-run] [--force]
 *
 *   --dry-run  DBに書かず対象レースだけ表示
 *   --force    キャッシュを無視して再取得
 */

import { buildCandidateRows } from "../server/candidates";
import { getManualOdds, getSettings, hasEarlyOddsSnapshot, insertDecisionHistory, listAllOddsBySelection, listAllResultsForModel, listEarlyOddsSnapshots, listOddsSnapshots, listProgramInputs, loadRaceWeatherMap, openDb, recordOddsSnapshot, recordOddsTimeseriesSnapshot, setOdds } from "../server/db";
import { LIVE_MONITOR_FROM, LIVE_MONITOR_MODEL_VERSION } from "../src/domain/liveMonitor";
import { isWithinOddsFetchWindow, minutesUntilRaceClose, oddsCheckpointLabel, shouldPersistDecisionHistory } from "../src/domain/livePersistence";
import { mergeOddsMaps } from "../src/domain/oddsSnapshot";
import { isTrifectaSelectionUnavailable, parseAllTrifectaOdds, parseTrifectaOdds } from "../src/domain/oddsParser";
import { fetchOfficialOdds } from "./fetch-official-odds";
import { loadEnvFiles } from "../src/domain/envFile";
import { buildLineText, lineMessagingConfigFromEnv, sendLinePushTextToRecipients } from "../src/domain/lineMessaging";
import { officialOddsUrl, teleBoatUrl } from "../src/domain/officialLinks";

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

const FETCH_RETRY_COUNT = 2;
const FETCH_RETRY_DELAY_MS = 4000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(args: Parameters<typeof fetchOfficialOdds>[0]) {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= FETCH_RETRY_COUNT; attempt++) {
    try {
      return await fetchOfficialOdds(args);
    } catch (err) {
      lastErr = err;
      if (attempt < FETCH_RETRY_COUNT) {
        console.log(`fetch-retry: ${args.venue}-${String(args.raceNo).padStart(2, "0")} attempt=${attempt + 1}`);
        await sleep(FETCH_RETRY_DELAY_MS);
      }
    }
  }
  throw lastErr;
}

function todayJst() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

const db = openDb();
try {
  const now = new Date();
  const today = todayJst();
  const settings = getSettings(db);
  const oddsByRaceId = mergeOddsMaps(getManualOdds(db), listOddsSnapshots(db));

  const weatherMap = loadRaceWeatherMap(db);
  const rows = buildCandidateRows(
    settings,
    now,
    oddsByRaceId,
    listProgramInputs(db, today),
    listAllResultsForModel(db),
    listEarlyOddsSnapshots(db),
    listAllOddsBySelection(db),
    weatherMap,
  );

  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  let saved = 0;

  for (const row of rows) {
    const { candidate } = row;
    if (candidate.source === "sample") continue;
    const minutes = minutesUntilRaceClose(candidate.date, candidate.closeAt, now);
    if (!isWithinOddsFetchWindow(candidate, settings, now)) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(`[dry-run] ${candidate.raceId} ${candidate.selection.join("-")} closes_in=${Math.round(minutes)}min`);
      fetched += 1;
      continue;
    }

    try {
      const fetchArgs = {
        date: candidate.date,
        venue: candidate.venue,
        raceNo: candidate.raceNo,
        forceRefresh: force,
      };
      const result = await fetchWithRetry(fetchArgs);
      let allOddsMap = parseAllTrifectaOdds(result.html);
      let html = result.html;

      // parse失敗時: キャッシュが不完全な可能性があるためforceRefreshで再取得
      if (allOddsMap.size === 0 && !result.cached) {
        console.log(`parse-retry: ${candidate.raceId} ${candidate.selection.join("-")}`);
        await sleep(FETCH_RETRY_DELAY_MS);
        const retried = await fetchWithRetry({ ...fetchArgs, forceRefresh: true }).catch(() => null);
        if (retried) {
          html = retried.html;
          allOddsMap = parseAllTrifectaOdds(html);
        }
      }

      if (allOddsMap.size === 0) {
        if (isTrifectaSelectionUnavailable(html, candidate.selection)) {
          console.log(`odds-unavailable: ${candidate.raceId} ${candidate.selection.join("-")}`);
        } else {
          console.warn(`parse-failed: ${candidate.raceId} ${candidate.selection.join("-")}`);
          failed += 1;
        }
        continue;
      }

      // 全120通りを保存
      const capturedAt = new Date().toISOString();
      const roundedMinutes = Math.round(minutes);
      const checkpointLabel = oddsCheckpointLabel(minutes);
      for (const [selStr, oddsVal] of allOddsMap) {
        recordOddsSnapshot(db, {
          raceId: candidate.raceId,
          selection: selStr,
          odds: oddsVal,
          popularity: null,
          source: "official",
          capturedAt,
          isFinalLike: false,
        });
        recordOddsTimeseriesSnapshot(db, {
          raceId: candidate.raceId,
          selection: selStr,
          odds: oddsVal,
          popularity: null,
          source: "official",
          capturedAt,
          isFinalLike: false,
          minutesBeforeClose: roundedMinutes,
          checkpointLabel,
        });
        // Late Money Signal: まだofficial-earlyがない出目のみ保存
        if (!hasEarlyOddsSnapshot(db, candidate.raceId, selStr)) {
          recordOddsSnapshot(db, {
            raceId: candidate.raceId,
            selection: selStr,
            odds: oddsVal,
            popularity: null,
            source: "official-early",
            capturedAt,
            isFinalLike: false,
          });
        }
      }

      // manual_oddsテーブルも候補出目のオッズで更新（後続の buildCandidateRows 用）
      const selectionStr = candidate.selection.join("-");
      const candidateOdds = allOddsMap.get(selectionStr);
      if (candidateOdds != null) {
        setOdds(db, candidate.raceId, candidateOdds, "official", selectionStr);
      }

      console.log(`fetched: ${candidate.raceId} all-120 odds=${allOddsMap.size}件`);
      fetched += 1;
    } catch (err) {
      console.error(`error: ${candidate.raceId}`, err instanceof Error ? err.message : err);
      failed += 1;
    }
  }

  if (!dryRun) {
    // オッズ取得後に再計算して decision_history を保存
    const freshOdds = mergeOddsMaps(getManualOdds(db), listOddsSnapshots(db));
    const freshRows = buildCandidateRows(
      settings,
      now,
      freshOdds,
      listProgramInputs(db, today),
      listAllResultsForModel(db),
      listEarlyOddsSnapshots(db),
      listAllOddsBySelection(db),
      loadRaceWeatherMap(db),
    );
    const persistHistory = today >= LIVE_MONITOR_FROM;
    for (const row of freshRows) {
      if (row.candidate.source === "sample") continue;
      if (persistHistory && shouldPersistDecisionHistory(row.candidate, settings, LIVE_MONITOR_FROM, now)) {
        insertDecisionHistory(db, row.candidate, row.decision, { replaceRace: true });
        saved += 1;
      }
    }

    // 保存後の DB から実際の BUY を取得し、未通知なら即 LINE 通知
    const confirmedBuys = db.prepare(`
      SELECT race_id, date, venue, race_no, selection, bet_type, current_odds, ev, recommended_stake_yen
      FROM decision_history
      WHERE date = ? AND decision = 'BUY' AND source = 'history-model' AND model_version = ?
    `).all(today, LIVE_MONITOR_MODEL_VERSION) as Array<{
      race_id: string; date: string; venue: string; race_no: number;
      selection: string; bet_type: string; current_odds: number | null;
      ev: number | null; recommended_stake_yen: number;
    }>;

    const pendingBuys = confirmedBuys.filter((buy) => {
      const notif = db.prepare(
        "SELECT status FROM notification_log WHERE race_id = ? AND channel = 'line'"
      ).get(buy.race_id) as { status: string } | undefined;
      return notif?.status !== "SENT";
    });

    if (pendingBuys.length > 0) {
      try {
        loadEnvFiles([".env"]);
        const envConfig = lineMessagingConfigFromEnv(process.env);
        if (envConfig.enabled && !envConfig.config.dryRun) {
          for (const buy of pendingBuys) {
            const odds = buy.current_odds != null ? `${buy.current_odds.toFixed(1)}倍` : "未取得";
            const ev = buy.ev != null ? buy.ev.toFixed(2) : "-";
            const voteUrl = teleBoatUrl(buy.date, buy.venue, buy.race_no);
            const oddsUrl = officialOddsUrl(buy.date, buy.venue, buy.race_no);
            const title = `🎯 BUY: ${buy.venue}${buy.race_no}R ${buy.selection}`;
            const body = [
              `券種: ${buy.bet_type}`,
              `オッズ: ${odds} / EV: ${ev}`,
              `stake: ${buy.recommended_stake_yen}円`,
              "",
              `投票: ${voteUrl}`,
              "【paper観察モード】",
            ].join("\n");
            const text = buildLineText(title, body, oddsUrl);

            await sendLinePushTextToRecipients({
              channelAccessToken: envConfig.config.channelAccessToken,
              recipients: envConfig.config.recipients,
              text,
              endpoint: envConfig.config.endpoint,
            });

            db.prepare(`
              INSERT INTO notification_log (race_id, channel, status, title, body, official_url, sent_at)
              VALUES (?, 'line', 'SENT', ?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(race_id, channel) DO UPDATE SET status='SENT', title=?, body=?, official_url=?, sent_at=CURRENT_TIMESTAMP
            `).run(buy.race_id, title, body, oddsUrl, title, body, oddsUrl);

            console.log(`LINE realtime: ${buy.race_id} ${buy.selection}`);
          }
        }
      } catch (err) {
        console.error("LINE realtime notify error:", err instanceof Error ? err.message : err);
      }
    }
  }

  console.log(`auto-fetch-odds done: fetched=${fetched} skipped=${skipped} failed=${failed} saved=${saved} dryRun=${dryRun}`);
} finally {
  db.close();
}
