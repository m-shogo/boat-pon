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
import { minutesUntil } from "../src/domain/decision";
import { mergeOddsMaps } from "../src/domain/oddsSnapshot";
import { parseTrifectaOdds } from "../src/domain/oddsParser";
import { fetchOfficialOdds } from "./fetch-official-odds";

const ODDS_FETCH_WINDOW_MINUTES = 30;
const LIVE_MONITOR_FROM = "2026-01-01";

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

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
    const minutes = minutesUntil(candidate.closeAt, now);
    if (minutes < settings.minMinutesBeforeClose || minutes > ODDS_FETCH_WINDOW_MINUTES) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(`[dry-run] ${candidate.raceId} ${candidate.selection.join("-")} closes_in=${Math.round(minutes)}min`);
      fetched += 1;
      continue;
    }

    try {
      const result = await fetchOfficialOdds({
        date: candidate.date,
        venue: candidate.venue,
        raceNo: candidate.raceNo,
        forceRefresh: force,
      });
      const odds = parseTrifectaOdds(result.html, candidate.selection);
      if (odds == null) {
        console.warn(`parse-failed: ${candidate.raceId} ${candidate.selection.join("-")}`);
        failed += 1;
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
      if (persistHistory) {
        insertDecisionHistory(db, row.candidate, row.decision, { replaceRace: true });
        saved += 1;
      }
    }
  }

  console.log(`auto-fetch-odds done: fetched=${fetched} skipped=${skipped} failed=${failed} saved=${saved} dryRun=${dryRun}`);
} finally {
  db.close();
}
