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
import { getManualOdds, getSettings, insertDecisionHistory, listAllOddsBySelection, listEarlyOddsSnapshots, listOddsSnapshots, listProgramInputs, listResultsForModelRange, loadRaceWeatherMap, openDb, recordOddsSnapshot, recordOddsTimeseriesSnapshot, setOdds } from "../server/db";
import { LIVE_MONITOR_FROM, LIVE_MONITOR_MODEL_VERSION } from "../src/domain/liveMonitor";
import { isWithinOddsFetchWindow, minutesUntilRaceClose, oddsCheckpointLabel, shouldPersistDecisionHistory } from "../src/domain/livePersistence";
import { mergeOddsMaps } from "../src/domain/oddsSnapshot";
import { isCompleteTrifectaCheckpoint, isScheduledCollectionHour, prioritizeRaceRows, runWithConcurrency } from "../src/domain/liveOddsFetch";
import { countUnavailableTrifectaSelections, isTrifectaSelectionUnavailable, parseAllTrifectaOdds, parseTrifectaOdds } from "../src/domain/oddsParser";
import { fetchOfficialOdds } from "./fetch-official-odds";
import { loadEnvFiles } from "../src/domain/envFile";
import { buildLineText, lineMessagingConfigFromEnv, sendLinePushTextToRecipients } from "../src/domain/lineMessaging";
import { officialOddsUrl, teleBoatUrl } from "../src/domain/officialLinks";
import { selectTopModelCandidatePerRace } from "../src/domain/candidateSelection";
import { judgeCandidate } from "../src/domain/decision";
import { shouldSendRealtimeBuyNotification } from "../src/domain/buyNotification";
import { OWNER_PROPELLER_STABLE_START } from "../src/domain/raceRegime";

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const scheduled = process.argv.includes("--scheduled");

if (scheduled && !isScheduledCollectionHour(new Date())) {
  console.log("auto-fetch-odds scheduled: outside 08:00-21:05 JST, skip");
  process.exit(0);
}

const FETCH_RETRY_COUNT = 2;
const FETCH_RETRY_DELAY_MS = 4000;
// 5分間隔ジョブの実行時間でT-5窓を飛び越えないよう、収集だけは締切1分前まで継続する。
// BUY通知は別途5分以上の余裕を必須にする。
const COLLECTION_MIN_MINUTES_BEFORE_CLOSE = 1;
// 締切順を保ちつつ、公式サイトへの負荷を抑えた小さい並列度で通信待ちだけを重ねる。
const OFFICIAL_FETCH_CONCURRENCY = 2;

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
  const runStartedAt = Date.now();
  const now = new Date();
  const today = todayJst();
  const settings = getSettings(db);
  // 収集開始を予測モデル構築から完全に分離する。公式番組だけで全raceを即時対象化する。
  const collectionPrograms = db.prepare(`
    SELECT race_id, date, venue, race_no, close_at
    FROM official_programs
    WHERE date = ?
    ORDER BY close_at, venue, race_no
  `).all(today) as Array<{ race_id: string; date: string; venue: string; race_no: number; close_at: string }>;

  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  let saved = 0;
  let checkpointCompleteSkipped = 0;

  const checkpointSelectionCount = db.prepare(`
    SELECT COALESCE(MAX(n), 0) AS n FROM (
      SELECT COUNT(DISTINCT selection) AS n
      FROM odds_timeseries_snapshots
      WHERE race_id = ? AND checkpoint_label = ?
      GROUP BY captured_at
    )
  `);
  const collectionRows = collectionPrograms.map((program) => ({
    candidate: {
      raceId: program.race_id,
      date: program.date,
      venue: program.venue,
      raceNo: program.race_no,
      closeAt: program.close_at,
      source: "official-program",
      selection: [1, 2, 3],
    },
  }));
  const fetchRows = prioritizeRaceRows(collectionRows, (row) => minutesUntilRaceClose(
    row.candidate.date,
    row.candidate.closeAt,
    now,
  ));
  await runWithConcurrency(fetchRows, OFFICIAL_FETCH_CONCURRENCY, async (row) => {
    const { candidate } = row;
    if (candidate.source === "sample") return;
    const currentNow = new Date();
    const minutes = minutesUntilRaceClose(candidate.date, candidate.closeAt, currentNow);
    if (!isWithinOddsFetchWindow(candidate, { minMinutesBeforeClose: COLLECTION_MIN_MINUTES_BEFORE_CLOSE }, currentNow)) {
      skipped += 1;
      return;
    }
    const requestedCheckpointLabel = oddsCheckpointLabel(minutes);
    const requestedCheckpointCount = Number((checkpointSelectionCount.get(candidate.raceId, requestedCheckpointLabel) as { n: number }).n);
    if (!force && isCompleteTrifectaCheckpoint(requestedCheckpointCount)) {
      checkpointCompleteSkipped += 1;
      return;
    }

    if (dryRun) {
      console.log(`[dry-run] ${candidate.raceId} ${candidate.selection.join("-")} closes_in=${Math.round(minutes)}min checkpoint=${requestedCheckpointLabel} existing=${requestedCheckpointCount}`);
      fetched += 1;
      return;
    }

    try {
      const fetchArgs = {
        date: candidate.date,
        venue: candidate.venue,
        raceNo: candidate.raceNo,
        // 前checkpointの5分キャッシュを現在checkpointとして保存すると時点リークになる。
        // 未完成checkpointだけがここへ来るため、収集時は必ず公式応答を取得する。
        forceRefresh: true,
      };
      const result = await fetchWithRetry(fetchArgs);
      let allOddsMap = parseAllTrifectaOdds(result.html);
      let html = result.html;
      let responseCached = result.cached;
      let unavailableCount = countUnavailableTrifectaSelections(html);
      let structurallyComplete = allOddsMap.size + unavailableCount === 120;

      // 欠場等を除く通常レースは120通り。キャッシュ/応答が不完全なら1回だけ強制再取得する。
      if (!structurallyComplete) {
        console.log(`parse-retry: ${candidate.raceId} ${candidate.selection.join("-")} rows=${allOddsMap.size} cached=${result.cached}`);
        await sleep(FETCH_RETRY_DELAY_MS);
        const retried = await fetchWithRetry({ ...fetchArgs, forceRefresh: true }).catch(() => null);
        if (retried) {
          html = retried.html;
          responseCached = retried.cached;
          allOddsMap = parseAllTrifectaOdds(html);
          unavailableCount = countUnavailableTrifectaSelections(html);
          structurallyComplete = allOddsMap.size + unavailableCount === 120;
        }
      }

      if (allOddsMap.size === 0) {
        if (isTrifectaSelectionUnavailable(html, candidate.selection)) {
          console.log(`odds-unavailable: ${candidate.raceId} ${candidate.selection.join("-")}`);
        } else {
          console.warn(`parse-failed: ${candidate.raceId} ${candidate.selection.join("-")}`);
          failed += 1;
        }
        return;
      }

      // ネットワーク取得・再試行後の実時刻で保存区分を確定する。開始時刻を使うと、
      // T-5境界をまたいだ応答を誤ったcheckpoint/minutesで永続化してしまう。
      const capturedNow = new Date();
      const capturedMinutes = minutesUntilRaceClose(candidate.date, candidate.closeAt, capturedNow);
      if (capturedMinutes < 0) {
        console.warn(`odds-too-late: ${candidate.raceId} minutes=${capturedMinutes.toFixed(1)}`);
        skipped += 1;
        return;
      }
      const capturedCheckpointLabel = oddsCheckpointLabel(capturedMinutes);
      const capturedCheckpointCount = Number((checkpointSelectionCount.get(
        candidate.raceId,
        capturedCheckpointLabel,
      ) as { n: number }).n);
      if (!force && isCompleteTrifectaCheckpoint(capturedCheckpointCount)) {
        checkpointCompleteSkipped += 1;
        return;
      }

      if (structurallyComplete && unavailableCount > 0) {
        console.log(`odds-structurally-complete: ${candidate.raceId} available=${allOddsMap.size} unavailable=${unavailableCount}`);
        if (!force && capturedCheckpointCount >= allOddsMap.size) {
          checkpointCompleteSkipped += 1;
          return;
        }
      } else if (allOddsMap.size < 120) {
        console.warn(`odds-incomplete: ${candidate.raceId} rows=${allOddsMap.size}`);
      }

      // 全120通りを保存
      const capturedAt = capturedNow.toISOString();
      const roundedMinutes = Math.round(capturedMinutes);
      const earlySelections = new Set((db.prepare(`
        SELECT selection FROM odds_snapshots
        WHERE race_id = ? AND source = 'official-early'
      `).all(candidate.raceId) as Array<{ selection: string }>).map((entry) => entry.selection));
      db.exec("BEGIN IMMEDIATE");
      try {
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
            checkpointLabel: capturedCheckpointLabel,
          });
          // Late Money Signal: まだofficial-earlyがない出目のみ保存
          if (!earlySelections.has(selStr)) {
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
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }

      console.log(`fetched: ${candidate.raceId} all-120 odds=${allOddsMap.size}件 checkpoint=${capturedCheckpointLabel} minutes=${roundedMinutes} source=${responseCached ? "cache" : "network"}`);
      fetched += 1;
    } catch (err) {
      console.error(`error: ${candidate.raceId}`, err instanceof Error ? err.message : err);
      failed += 1;
    }
  });

  if (!dryRun) {
    const decisionPhaseStartedAt = Date.now();
    // オッズ取得後に再計算して decision_history を保存
    const freshOdds = mergeOddsMaps(getManualOdds(db), listOddsSnapshots(db));
    const freshAllOdds = listAllOddsBySelection(db);
    const programInputs = listProgramInputs(db, today);
    // 現代liveモデルでfilter後に捨てる旧制度40万件をDBから読まない。同値範囲だけをロードする。
    const modelResults = listResultsForModelRange(db, OWNER_PROPELLER_STABLE_START, today);
    const freshRows = buildCandidateRows(
      settings,
      now,
      freshOdds,
      programInputs,
      modelResults,
      listEarlyOddsSnapshots(db),
      freshAllOdds,
      loadRaceWeatherMap(db),
    );
    const persistHistory = today >= LIVE_MONITOR_FROM;
    const selectedCandidates = selectTopModelCandidatePerRace(
      freshRows.filter(row => row.candidate.source !== "sample").map(row => row.candidate),
    );
    // downstream/UI互換用manual_oddsは、取得前の仮候補ではなく取得後の実選択で更新する。
    for (const candidate of selectedCandidates) {
      const selection = candidate.selection.join("-");
      const odds = freshAllOdds.get(`${candidate.raceId}/${selection}`);
      if (odds != null) setOdds(db, candidate.raceId, odds, "official", selection);
    }
    let buyCountToday = 0;
    let reservedBudgetYen = 0;
    for (const candidate of selectedCandidates) {
      const decision = judgeCandidate(candidate, settings, { now, buyCountToday, reservedBudgetYen });
      if (decision.status === "BUY") {
        buyCountToday += 1;
        reservedBudgetYen += decision.recommendedAmount;
      }
      if (persistHistory && shouldPersistDecisionHistory(candidate, settings, LIVE_MONITOR_FROM, now)) {
        insertDecisionHistory(db, candidate, decision, { replaceRace: true });
        saved += 1;
      }
    }

    // 保存後の DB から実際の BUY を取得し、未通知なら即 LINE 通知
    const confirmedBuys = db.prepare(`
      SELECT d.race_id, d.date, d.venue, d.race_no, d.selection, d.bet_type, d.current_odds, d.ev, d.recommended_stake_yen, p.close_at
      FROM decision_history d
      LEFT JOIN official_programs p ON p.race_id=d.race_id
      WHERE d.date = ? AND d.decision = 'BUY' AND d.source = 'history-model' AND d.model_version = ?
    `).all(today, LIVE_MONITOR_MODEL_VERSION) as Array<{
      race_id: string; date: string; venue: string; race_no: number;
      selection: string; bet_type: string; current_odds: number | null;
      ev: number | null; recommended_stake_yen: number; close_at: string | null;
    }>;

    const pendingBuys = confirmedBuys.filter((buy) => {
      const notif = db.prepare(
        "SELECT status FROM notification_log WHERE race_id = ? AND channel = 'line'"
      ).get(buy.race_id) as { status: string } | undefined;
      const latestCheckpoint = db.prepare(`
        SELECT checkpoint_label
        FROM odds_timeseries_snapshots
        WHERE race_id = ? AND selection = ?
        ORDER BY captured_at DESC
        LIMIT 1
      `).get(buy.race_id, buy.selection) as { checkpoint_label: string | null } | undefined;
      return shouldSendRealtimeBuyNotification({
        notificationStatus: notif?.status ?? null,
        latestCheckpointLabel: latestCheckpoint?.checkpoint_label ?? null,
        actualMinutesBeforeClose: buy.close_at == null ? null : minutesUntilRaceClose(buy.date, buy.close_at, new Date()),
      });
    });

    if (pendingBuys.length > 0) {
      try {
        loadEnvFiles([".env"]);
        const envConfig = lineMessagingConfigFromEnv(process.env);
        if (envConfig.enabled && !envConfig.config.dryRun) {
          for (const buy of pendingBuys) {
            const actualMinutesBeforeClose = buy.close_at == null ? null : minutesUntilRaceClose(buy.date, buy.close_at, new Date());
            if (actualMinutesBeforeClose == null || actualMinutesBeforeClose < 5) {
              console.log(`LINE realtime skipped-late: ${buy.race_id} minutes=${actualMinutesBeforeClose?.toFixed(1) ?? "-"}`);
              continue;
            }
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
    console.log(`decision-phase: clockLagMs=${decisionPhaseStartedAt - runStartedAt}`);
  }

  console.log(`auto-fetch-odds done: fetched=${fetched} skipped=${skipped} checkpointCompleteSkipped=${checkpointCompleteSkipped} failed=${failed} saved=${saved} dryRun=${dryRun} elapsedMs=${Date.now() - runStartedAt}`);
} finally {
  db.close();
}
