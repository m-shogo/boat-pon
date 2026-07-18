/**
 * Read-only candidate selection audit.
 *
 * 全出目候補からモデル最上位1件をpaperで選び、現在DBに残っている1件と比較する。
 * production判定・app_settings・DBは変更しない。
 */
import { DatabaseSync } from "node:sqlite";
import { buildCandidateRows } from "../server/candidates";
import {
  getManualOdds,
  getSettings,
  listAllOddsBySelection,
  listEarlyOddsSnapshots,
  listOddsSnapshots,
  listProgramInputs,
  listResultsForModelRange,
  loadRaceWeatherMap,
} from "../server/db";
import { selectTopModelCandidatePerRace } from "../src/domain/candidateSelection";
import { judgeCandidate } from "../src/domain/decision";
import { LIVE_MONITOR_MODEL_VERSION } from "../src/domain/liveMonitor";
import { mergeOddsMaps } from "../src/domain/oddsSnapshot";
import type { BetCandidate, Decision } from "../src/domain/types";

const DB_PATH = "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;");

try {
  const settings = getSettings(db);
  const now = new Date();
  const raceOdds = mergeOddsMaps(getManualOdds(db), listOddsSnapshots(db));
  const selectionOdds = listAllOddsBySelection(db);
  const rows = buildCandidateRows(
    settings,
    now,
    raceOdds,
    listProgramInputs(db, args.date),
    listResultsForModelRange(db, addDays(args.date, -180), args.date),
    listEarlyOddsSnapshots(db),
    selectionOdds,
    loadRaceWeatherMap(db),
  );
  const attachedOddsMismatches = rows.filter((row) => {
    const key = `${row.candidate.raceId}/${row.candidate.selection.join("-")}`;
    const expected = selectionOdds.get(key);
    return expected != null && row.candidate.currentOdds !== expected;
  });
  const allCandidates = rows.map((row) => {
    const key = `${row.candidate.raceId}/${row.candidate.selection.join("-")}`;
    return { ...row.candidate, currentOdds: selectionOdds.get(key) ?? null };
  });
  const selected = selectTopModelCandidatePerRace(allCandidates);
  const paperRows = evaluateSelected(selected, settings, now);
  const persisted = readPersisted(db, args.date);
  const persistedByRace = new Map(persisted.map((row) => [row.raceId, row]));

  const comparisons = paperRows.map(({ candidate, decision }) => {
    const saved = persistedByRace.get(candidate.raceId) ?? null;
    return {
      raceId: candidate.raceId,
      paperSelection: candidate.selection.join("-"),
      paperScore: candidate.modelSelectionScore ?? null,
      paperOdds: candidate.currentOdds,
      paperDecision: decision.status,
      persistedSelection: saved?.selection ?? null,
      persistedOdds: saved?.currentOdds ?? null,
      persistedDecision: saved?.decision ?? null,
      selectionMatches: saved?.selection === candidate.selection.join("-"),
    };
  });
  const decisionCounts = countDecisions(paperRows.map((row) => row.decision));
  const persistedComparisons = comparisons.filter((row) => row.persistedSelection != null);
  const matched = persistedComparisons.filter((row) => row.selectionMatches).length;
  const report = {
    generatedAt: now.toISOString(),
    date: args.date,
    model: LIVE_MONITOR_MODEL_VERSION,
    safety: { readOnly: true, productionConnected: false, dbWrites: false },
    summary: {
      candidateRows: allCandidates.length,
      racePrograms: selected.length,
      rowsPerRace: selected.length > 0 ? allCandidates.length / selected.length : 0,
      attachedOddsMismatchRows: attachedOddsMismatches.length,
      paperTop1Decisions: decisionCounts,
      persistedRaces: persisted.length,
      persistedComparableRaces: persistedComparisons.length,
      missingPersistedRaces: selected.length - persistedComparisons.length,
      selectionMatches: matched,
      selectionMatchPct: persistedComparisons.length > 0 ? matched / persistedComparisons.length : 0,
    },
    mismatches: persistedComparisons.filter((row) => !row.selectionMatches).slice(0, args.limit),
  };

  if (args.json) console.log(JSON.stringify(report));
  else printReport(report);
} finally {
  db.close();
}

function evaluateSelected(candidates: BetCandidate[], settings: ReturnType<typeof getSettings>, now: Date) {
  let buyCountToday = 0;
  let reservedBudgetYen = 0;
  return candidates.map((candidate) => {
    const decision = judgeCandidate(candidate, settings, { now, buyCountToday, reservedBudgetYen });
    if (decision.status === "BUY") {
      buyCountToday += 1;
      reservedBudgetYen += decision.recommendedAmount;
    }
    return { candidate, decision };
  });
}

function readPersisted(db: DatabaseSync, date: string) {
  const rows = db.prepare(`
    SELECT race_id, selection, current_odds, decision
    FROM decision_history
    WHERE date = ? AND model_version = ? AND run_kind = 'paper-live'
    ORDER BY id DESC
  `).all(date, LIVE_MONITOR_MODEL_VERSION) as Array<{
    race_id: string; selection: string; current_odds: number | null; decision: string;
  }>;
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    if (seen.has(row.race_id)) return [];
    seen.add(row.race_id);
    return [{
      raceId: row.race_id,
      selection: row.selection,
      currentOdds: row.current_odds == null ? null : Number(row.current_odds),
      decision: row.decision,
    }];
  });
}

function countDecisions(decisions: Decision[]) {
  return decisions.reduce((counts, decision) => {
    counts[decision.status] += 1;
    return counts;
  }, { BUY: 0, WATCH: 0, SKIP: 0 });
}

function printReport(report: {
  date: string;
  summary: {
    candidateRows: number; racePrograms: number; rowsPerRace: number; attachedOddsMismatchRows: number;
    paperTop1Decisions: { BUY: number; WATCH: number; SKIP: number };
    persistedRaces: number; persistedComparableRaces: number; missingPersistedRaces: number;
    selectionMatches: number; selectionMatchPct: number;
  };
  mismatches: Array<{
    raceId: string; paperSelection: string; paperOdds: number | null; paperDecision: string;
    persistedSelection: string | null; persistedOdds: number | null; persistedDecision: string | null;
  }>;
}) {
  console.log("=== candidate selection audit (read-only / paper) ===");
  console.log(`date: ${report.date}`);
  console.log(`candidate rows: ${report.summary.candidateRows}`);
  console.log(`race programs: ${report.summary.racePrograms}`);
  console.log(`rows/race: ${report.summary.rowsPerRace.toFixed(1)}`);
  console.log(`selection odds overwritten: ${report.summary.attachedOddsMismatchRows}`);
  console.log(`paper top1: BUY=${report.summary.paperTop1Decisions.BUY} WATCH=${report.summary.paperTop1Decisions.WATCH} SKIP=${report.summary.paperTop1Decisions.SKIP}`);
  console.log(`persisted races: ${report.summary.persistedRaces}`);
  console.log(`missing persisted races: ${report.summary.missingPersistedRaces}`);
  console.log(`selection match: ${report.summary.selectionMatches}/${report.summary.persistedComparableRaces} (${(report.summary.selectionMatchPct * 100).toFixed(1)}%)`);
  console.log("\nfirst mismatches:");
  for (const row of report.mismatches) {
    console.log(`- ${row.raceId}: paper=${row.paperSelection} odds=${row.paperOdds ?? "-"} ${row.paperDecision} / saved=${row.persistedSelection ?? "-"} odds=${row.persistedOdds ?? "-"} ${row.persistedDecision ?? "-"}`);
  }
}

function parseArgs(argv: string[]) {
  let date = todayJst();
  let json = false;
  let limit = 20;
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--json") json = true;
    else if (value === "--date") date = argv[++i] ?? date;
    else if (value.startsWith("--date=")) date = value.slice("--date=".length);
    else if (value === "--limit") limit = Number(argv[++i] ?? limit);
  }
  return { date, json, limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20 };
}

function todayJst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function addDays(date: string, delta: number) {
  const value = new Date(`${date}T00:00:00+09:00`);
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}
