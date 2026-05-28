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
import { getManualOdds, getSettings, insertDecisionHistory, listAllResultsForModel, listOddsSnapshots, listProgramInputs, openDb, setOdds } from "../server/db";
import { LIVE_MONITOR_FROM } from "../src/domain/liveMonitor";
import { isWithinOddsFetchWindow, minutesUntilRaceClose, shouldPersistDecisionHistory } from "../src/domain/livePersistence";
import { mergeOddsMaps } from "../src/domain/oddsSnapshot";
import { isTrifectaSelectionUnavailable, parseTrifectaOdds } from "../src/domain/oddsParser";
import { fetchOfficialOdds } from "./fetch-official-odds";

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
        console.warn(`fetch-retry: ${args.venue}-${String(args.raceNo).padStart(2, "0")} attempt=${attempt + 1}`);
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

  const rows = buildCandidateRows(
    settings,
    now,
    oddsByRaceId,
    listProgramInputs(db, today),
    listAllResultsForModel(db),
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
      let odds = parseTrifectaOdds(result.html, candidate.selection);
      let html = result.html;

      // parse失敗時: キャッシュが不完全な可能性があるためforceRefreshで再取得
      if (odds == null && !result.cached && !isTrifectaSelectionUnavailable(html, candidate.selection)) {
        console.warn(`parse-retry: ${candidate.raceId} ${candidate.selection.join("-")}`);
        await sleep(FETCH_RETRY_DELAY_MS);
        const retried = await fetchWithRetry({ ...fetchArgs, forceRefresh: true }).catch(() => null);
        if (retried) {
          html = retried.html;
          odds = parseTrifectaOdds(html, candidate.selection);
        }
      }

      if (odds == null) {
        if (isTrifectaSelectionUnavailable(html, candidate.selection)) {
          console.log(`odds-unavailable: ${candidate.raceId} ${candidate.selection.join("-")}`);
        } else {
          console.warn(`parse-failed: ${candidate.raceId} ${candidate.selection.join("-")}`);
          failed += 1;
        }
        continue;
      }
      setOdds(db, candidate.raceId, odds, "official", candidate.selection.join("-"));
      console.log(`fetched: ${candidate.raceId} ${candidate.selection.join("-")} odds=${odds} ${result.cached ? "(cached)" : ""}`);
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
    );
    const persistHistory = today >= LIVE_MONITOR_FROM;
    for (const row of freshRows) {
      if (row.candidate.source === "sample") continue;
      if (persistHistory && shouldPersistDecisionHistory(row.candidate, settings, LIVE_MONITOR_FROM, now)) {
        insertDecisionHistory(db, row.candidate, row.decision, { replaceRace: true });
        saved += 1;
      }
    }
  }

  console.log(`auto-fetch-odds done: fetched=${fetched} skipped=${skipped} failed=${failed} saved=${saved} dryRun=${dryRun}`);
} finally {
  db.close();
}
