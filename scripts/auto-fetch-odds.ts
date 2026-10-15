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
import { getManualOdds, getSettings, hasBeforeInfoData, insertDecisionHistory, listAllOddsBySelection, listEarlyOddsSnapshots, listLatestOddsSnapshotsForDate, listProgramInputs, listResultsForModelRange, loadRaceWeatherMap, openDb, recordOddsSnapshot, recordOddsTimeseriesSnapshot, setOdds } from "../server/db";
import { LIVE_MONITOR_FROM, LIVE_MONITOR_MODEL_VERSION } from "../src/domain/liveMonitor";
import { isPastActionDeadline, isWithinOddsFetchWindow, minutesUntilRaceClose, oddsCheckpointLabel, shouldPersistDecisionHistory } from "../src/domain/livePersistence";
import { mergeOddsMaps } from "../src/domain/oddsSnapshot";
import { isCompleteTrifectaCheckpoint, isScheduledCollectionHour, prioritizeRaceRows, runWithConcurrency } from "../src/domain/liveOddsFetch";
import { countUnavailableTrifectaSelections, isTrifectaSelectionUnavailable, parseAllTrifectaOdds, parseTrifectaOdds } from "../src/domain/oddsParser";
import { fetchOfficialOdds } from "./fetch-official-odds";
import { loadEnvFiles } from "../src/domain/envFile";
import { buildLineText, lineMessagingConfigFromEnv, sendLinePushTextToRecipients } from "../src/domain/lineMessaging";
import { officialOddsUrl, teleBoatUrl } from "../src/domain/officialLinks";
import { selectTopModelCandidatePerRace } from "../src/domain/candidateSelection";
import { judgeCandidate } from "../src/domain/decision";
import { realtimeBuyNotSentReason, shouldSendRealtimeBuyNotification } from "../src/domain/buyNotification";
import { calibratedSelectionProbability } from "../src/domain/accuracyScorecard";
import { formatBuyAlert } from "../src/domain/lineMessages";
import { loadChampionCalibration, loadLatestCapturesForRace } from "./lib/marketCaptures";
import { fetchAndSaveBeforeInfo } from "./lib/beforeInfo";
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
  // 直前情報が無いと BUY にならない（requireBeforeInfoForBuy）。30分おきの auto-exhibition を待つと、
  // 締切後に届くことが多かった（2026-10-08: BUY の 94件）。行動の締め切り前（締切 5〜25 分前）で
  // 直前情報がまだ無いレースだけ、ここで取りに行く（締切が近い順に1回最大 6 件）。
  // 2026-10-15: オッズの取得とは互いに関係しないので、並行して進める。以前は順番に待っていて、判定までの遅れが
  // 両方の合計（10/15 朝は直前情報 21〜53 秒＋オッズ 10〜35 秒で 40〜79 秒）になっていた。公式サイトへの同時接続は最大 3。
  // 保存はどちらも同期の処理で、オッズの保存（BEGIN〜COMMIT）の途中に await は無いので、トランザクションは混ざらない。
  const fetchBeforeInfoInline = async () => {
    const startedAt = Date.now();
    const beforeInfoTargets = collectionPrograms
      .map((program) => ({
        program: { raceId: program.race_id, date: program.date, venue: program.venue, raceNo: program.race_no },
        minutes: minutesUntilRaceClose(program.date, program.close_at, new Date()),
      }))
      .filter(({ program, minutes }) => minutes >= settings.minMinutesBeforeClose && minutes <= 25 && !hasBeforeInfoData(db, program.raceId))
      .sort((a, b) => a.minutes - b.minutes)
      .slice(0, 6);
    const beforeInfoCounts = { saved: 0, empty: 0, failed: 0 };
    for (const { program } of beforeInfoTargets) {
      try {
        const result = await fetchAndSaveBeforeInfo(db, program);
        if (result.status === "saved") beforeInfoCounts.saved += 1;
        else beforeInfoCounts.empty += 1;
      } catch (err) {
        beforeInfoCounts.failed += 1;
        console.error(`beforeinfo-inline error: ${program.raceId}`, err instanceof Error ? err.message : err);
      }
      await sleep(1000);
    }
    if (beforeInfoTargets.length > 0) {
      console.log(`beforeinfo-inline: targets=${beforeInfoTargets.length} saved=${beforeInfoCounts.saved} empty=${beforeInfoCounts.empty} failed=${beforeInfoCounts.failed} ms=${Date.now() - startedAt}`);
    }
  };
  // 後で await するまでの間に失敗しても、未処理の reject で落ちないように catch を付けておく。
  const beforeInfoDone = (dryRun ? Promise.resolve() : fetchBeforeInfoInline()).catch((err) => {
    console.error("beforeinfo-inline failed:", err instanceof Error ? err.message : err);
  });
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

  // 区間ごとの所要時間（判定までの遅れが通知の間に合わなさに直結するので、どこで時間を使っているかを残す）
  const fetchPhaseEndedAt = Date.now();
  if (!dryRun) {
    await beforeInfoDone;
    const beforeInfoWaitEndedAt = Date.now();
    const decisionPhaseStartedAt = Date.now();
    // 判定にはこの時点の時刻を使う。実行開始時の時刻を使うと、取得に時間がかかった回（スリープをまたいだ回など）で
    // 締切後なのに「締め切り前」と判定してしまう（2026-10-13 浜名湖3R は締切の 18 分後に BUY の行が作られた）。
    const decisionNow = new Date(decisionPhaseStartedAt);
    // オッズ取得後に再計算して decision_history を保存
    // オッズは当日のレースだけ読む（判定は当日のレースしか見ない。全期間を読むと約40秒かかっていた）。
    const freshOdds = mergeOddsMaps(getManualOdds(db), listLatestOddsSnapshotsForDate(db, today));
    const freshAllOdds = listAllOddsBySelection(db, today);
    const programInputs = listProgramInputs(db, today);
    // 現代liveモデルでfilter後に捨てる旧制度40万件をDBから読まない。同値範囲だけをロードする。
    const modelResults = listResultsForModelRange(db, OWNER_PROPELLER_STABLE_START, today);
    const freshRows = buildCandidateRows(
      settings,
      decisionNow,
      freshOdds,
      programInputs,
      modelResults,
      listEarlyOddsSnapshots(db, today),
      freshAllOdds,
      loadRaceWeatherMap(db),
    );
    const candidatesBuiltAt = Date.now();
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
    // 行動の締め切り（締切の minMinutesBeforeClose 分前）を過ぎたレースは判定し直さず、記録をその時点で固定する。
    // 以前は締切後も判定し直していたため、締切後に BUY のラベルが付き（decision.ts の minutesUntil は締切後に
    // 翌日へ繰り越す）、その「幻の BUY」が1日の BUY 上限を食って、締切前のレースが BUY になれなかった。
    // 1日の上限には、固定済みの BUY を先に数える。
    const frozenBuyStakes = new Map((db.prepare(`
      SELECT race_id, recommended_stake_yen FROM decision_history
      WHERE date = ? AND decision = 'BUY' AND run_kind = 'paper-live' AND model_version = ?
    `).all(today, LIVE_MONITOR_MODEL_VERSION) as Array<{ race_id: string; recommended_stake_yen: number | null }>)
      .map((row) => [row.race_id, row.recommended_stake_yen ?? settings.stakePerBetYen]));
    // リアルタイム通知を送ったレースも、そこで固定する（通知した内容がそのまま記録になる）。
    const notifiedRaceIds = new Set((db.prepare(`
      SELECT race_id FROM notification_log WHERE channel = 'line' AND status = 'SENT' AND race_id LIKE ?
    `).all(`${today.replaceAll("-", "")}-%`) as Array<{ race_id: string }>).map((row) => row.race_id));
    const isFrozen = (candidate: (typeof selectedCandidates)[number]) =>
      persistHistory && candidate.date === today && (isPastActionDeadline(candidate, settings, decisionNow) || notifiedRaceIds.has(candidate.raceId));
    let buyCountToday = 0;
    let reservedBudgetYen = 0;
    let frozenCount = 0;
    for (const candidate of selectedCandidates) {
      if (!isFrozen(candidate)) continue;
      frozenCount += 1;
      const stake = frozenBuyStakes.get(candidate.raceId);
      if (stake != null) {
        buyCountToday += 1;
        reservedBudgetYen += stake;
      }
    }
    const frozenBuyCount = buyCountToday;
    for (const candidate of selectedCandidates) {
      if (isFrozen(candidate)) continue;
      const decision = judgeCandidate(candidate, settings, { now: decisionNow, buyCountToday, reservedBudgetYen });
      if (decision.status === "BUY") {
        buyCountToday += 1;
        reservedBudgetYen += decision.recommendedAmount;
      }
      if (persistHistory && shouldPersistDecisionHistory(candidate, settings, LIVE_MONITOR_FROM, decisionNow)) {
        insertDecisionHistory(db, candidate, decision, { replaceRace: true });
        saved += 1;
      }
    }

    const judgedAt = Date.now();
    // 保存後の DB から実際の BUY を取得し、未通知なら即 LINE 通知
    const confirmedBuys = db.prepare(`
      SELECT d.race_id, d.date, d.venue, d.race_no, d.selection, d.bet_type, d.current_odds, d.ev, d.estimated_hit_rate, d.recommended_stake_yen, p.close_at
      FROM decision_history d
      LEFT JOIN official_programs p ON p.race_id=d.race_id
      WHERE d.date = ? AND d.decision = 'BUY' AND d.source = 'history-model' AND d.model_version = ?
    `).all(today, LIVE_MONITOR_MODEL_VERSION) as Array<{
      race_id: string; date: string; venue: string; race_no: number;
      selection: string; bet_type: string; current_odds: number | null;
      ev: number | null; estimated_hit_rate: number | null; recommended_stake_yen: number; close_at: string | null;
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
      const gate = {
        notificationStatus: notif?.status ?? null,
        latestCheckpointLabel: latestCheckpoint?.checkpoint_label ?? null,
        actualMinutesBeforeClose: buy.close_at == null ? null : minutesUntilRaceClose(buy.date, buy.close_at, new Date()),
      };
      // 送らなかった BUY は、締切前のものだけ理由をログに出す（以前は黙って落ちていて、5日間気づかなかった）。
      const reason = realtimeBuyNotSentReason(gate);
      if (reason && reason !== "already-sent" && gate.actualMinutesBeforeClose != null && gate.actualMinutesBeforeClose >= 0) {
        console.log(`LINE realtime not-sent: ${buy.race_id} ${reason}`);
      }
      return shouldSendRealtimeBuyNotification(gate);
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
            const voteUrl = teleBoatUrl(buy.date, buy.venue, buy.race_no);
            const oddsUrl = officialOddsUrl(buy.date, buy.venue, buy.race_no);
            // v3 の推定的中率は BUY 行で約3倍の過大評価だった（2026-10-07 の精度スコアカード）。
            // いちばん正確な市場補正の確率を主に出す。計算できなければ v3 の予想だけを出す（通知は止めない）。
            let calibratedProbability: number | null = null;
            try {
              const captures = loadLatestCapturesForRace(db, buy.race_id);
              if (captures.latest) {
                calibratedProbability = calibratedSelectionProbability({
                  selection: buy.selection,
                  latestOdds: captures.latest,
                  earlierOdds: captures.earlier,
                  params: loadChampionCalibration(),
                });
              }
            } catch (err) {
              console.error("LINE realtime probability skipped:", err instanceof Error ? err.message : err);
            }
            const { title, body } = formatBuyAlert({
              venue: buy.venue,
              raceNo: buy.race_no,
              selection: buy.selection,
              closeAt: buy.close_at,
              quoteOdds: buy.current_odds,
              calibratedProbability,
              v3Probability: buy.estimated_hit_rate,
              voteUrl,
            });
            const text = buildLineText(title, body, oddsUrl);

            try {
              await sendLinePushTextToRecipients({
                channelAccessToken: envConfig.config.channelAccessToken,
                recipients: envConfig.config.recipients,
                text,
                endpoint: envConfig.config.endpoint,
              });
            } catch (err) {
              // 送れなかったことを記録に残す（スコアカードが「送れていない LINE 通知」として数える）。
              // 次の実行で締切5分以上前なら送り直す。送信済み（SENT）は書き換えない。1件の失敗で残りの BUY を止めない。
              console.error(`LINE realtime send failed: ${buy.race_id}`, err instanceof Error ? err.message : err);
              db.prepare(`
                INSERT INTO notification_log (race_id, channel, status, title, body, official_url)
                VALUES (?, 'line', 'FAILED', ?, ?, ?)
                ON CONFLICT(race_id, channel) DO UPDATE SET status='FAILED', title=excluded.title, body=excluded.body, official_url=excluded.official_url
                WHERE notification_log.status <> 'SENT'
              `).run(buy.race_id, title, body, oddsUrl);
              continue;
            }

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
    console.log(`decision-phase: clockLagMs=${decisionPhaseStartedAt - runStartedAt} frozen=${frozenCount} frozenBuys=${frozenBuyCount} buysToday=${buyCountToday} phaseMs=fetch:${fetchPhaseEndedAt - runStartedAt},beforeinfoWait:${beforeInfoWaitEndedAt - fetchPhaseEndedAt},build:${candidatesBuiltAt - decisionPhaseStartedAt},judge:${judgedAt - candidatesBuiltAt},notify:${Date.now() - judgedAt}`);
  }

  console.log(`auto-fetch-odds done: fetched=${fetched} skipped=${skipped} checkpointCompleteSkipped=${checkpointCompleteSkipped} failed=${failed} saved=${saved} dryRun=${dryRun} elapsedMs=${Date.now() - runStartedAt}`);
} finally {
  db.close();
}
