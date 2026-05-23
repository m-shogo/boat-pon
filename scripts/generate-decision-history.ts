import { judgeCandidate } from "../src/domain/decision";
import { buildCandidatesFromModel, buildVenueModel, type ModelCandidateInput } from "../src/domain/model";
import { filterComparableResultsForDate } from "../src/domain/raceRegime";
import { mergeOddsMaps } from "../src/domain/oddsSnapshot";
import { getManualOdds, getSettings, insertDecisionHistory, listOddsSnapshots, listProgramInputsRange, listResultsForModelRange, openDb } from "../server/db";
import type { DatabaseSync } from "node:sqlite";

type Args = {
  from: string | null;
  to: string | null;
  limit: number | null;
  dryRun: boolean;
  includeSkips: boolean;
  includeRequiredOddsCandidates: boolean;
  minTrainRaceCount: number | null;
  trainDays: number;
  alpha: number;
};

const args = parseArgs(process.argv.slice(2));
if (!args.from || !args.to || args.limit == null || args.limit <= 0) {
  throw new Error("usage: tsx scripts/generate-decision-history.ts --from YYYY-MM-DD --to YYYY-MM-DD --limit N [--dry-run] [--include-skips]");
}

const db = openDb();
try {
  const settings = getSettings(db);
  const minTrainRaceCount = args.minTrainRaceCount ?? settings.minSampleSize;
  const oddsByRaceId = mergeOddsMaps(getManualOdds(db), listOddsSnapshots(db));
  const trainFrom = addDays(args.from, -args.trainDays);
  const allResults = listResultsForModelRange(db, trainFrom, args.to);
  const programs = listProgramInputsRange(db, args.from, args.to, args.limit);
  const existingKeys = loadExistingDecisionKeys(db, args.from, args.to);

  let generated = 0;
  let written = 0;
  let skippedExisting = 0;
  const modelCache = new Map<string, ReturnType<typeof buildVenueModel>>();

  for (const program of programs) {
    const trainResults = getTrainResults(allResults, program.date, modelCache, minTrainRaceCount, args.alpha);
    const candidates = buildCandidatesFromModel(
      [program as ModelCandidateInput],
      trainResults,
      settings.targetEv,
      program.date + "T00:00:00+09:00",
      oddsByRaceId,
    );
    const candidate = candidates[0];
    if (!candidate) continue;
    const decision = judgeCandidate(candidate, settings, {
      now: beforeCloseTime(program.date, program.closeAt, settings.minMinutesBeforeClose + 10),
      buyCountToday: 0,
      reservedBudgetYen: 0,
    });
    const isRequiredOddsCandidate = args.includeRequiredOddsCandidates &&
      candidate.currentOdds == null &&
      candidate.sampleSize >= settings.minSampleSize &&
      decision.requiredOdds <= 80;
    if (!args.includeSkips && decision.status === "SKIP" && !isRequiredOddsCandidate) continue;
    const key = decisionKey(candidate.raceId, candidate.selection.join("-"));
    if (existingKeys.has(key)) {
      skippedExisting += 1;
      continue;
    }
    generated += 1;
    if (args.dryRun) {
      console.log(`[dry-run] ${candidate.raceId} ${candidate.selection.join("-")} ${decision.status} odds=${candidate.currentOdds ?? "-"} ev=${decision.ev?.toFixed(2) ?? "-"}`);
      continue;
    }
    insertDecisionHistory(db, candidate, decision);
    existingKeys.add(key);
    written += 1;
  }

  console.log(`decision history generated=${generated} written=${written} skippedExisting=${skippedExisting} dryRun=${args.dryRun} programs=${programs.length}`);
} finally {
  db.close();
}

function loadExistingDecisionKeys(db: DatabaseSync, from: string, to: string) {
  const rows = db.prepare(`
SELECT race_id, selection
FROM decision_history
WHERE date >= ? AND date <= ?
`).all(from, to) as Array<Record<string, unknown>>;
  return new Set(rows.map((row) => decisionKey(String(row.race_id), String(row.selection))));
}

function decisionKey(raceId: string, selection: string) {
  return `${raceId}|${selection}`;
}

function getTrainResults(
  allResults: ReturnType<typeof listResultsForModelRange>,
  date: string,
  cache: Map<string, ReturnType<typeof buildVenueModel>>,
  minTrainRaceCount: number,
  alpha: number,
) {
  const key = `${date}|${minTrainRaceCount}|${alpha}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const comparable = filterComparableResultsForDate(allResults.filter((row) => row.date < date), date);
  const model = buildVenueModel(comparable, minTrainRaceCount, alpha);
  cache.set(key, model);
  return model;
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00+09:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function beforeCloseTime(date: string, closeAt: string, minutesBeforeClose: number) {
  const [hour, minute] = closeAt.split(":").map(Number);
  const base = new Date(`${date}T00:00:00+09:00`);
  base.setHours(hour, minute, 0, 0);
  return new Date(base.getTime() - minutesBeforeClose * 60_000);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { from: null, to: null, limit: null, dryRun: false, includeSkips: false, includeRequiredOddsCandidates: false, minTrainRaceCount: null, trainDays: 180, alpha: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--dry-run") args.dryRun = true;
    else if (key === "--include-skips") args.includeSkips = true;
    else if (key === "--include-required-odds-candidates") args.includeRequiredOddsCandidates = true;
    else if (key === "--from") { args.from = normalizeDate(value); i += 1; }
    else if (key === "--to") { args.to = normalizeDate(value); i += 1; }
    else if (key === "--limit") { args.limit = Number(value); i += 1; }
    else if (key === "--min-train") { args.minTrainRaceCount = Number(value); i += 1; }
    else if (key === "--train-days") { args.trainDays = Number(value); i += 1; }
    else if (key === "--alpha") { args.alpha = Number(value); i += 1; }
    else throw new Error(`unknown option: ${key}`);
  }
  return args;
}

function normalizeDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`date must be YYYY-MM-DD: ${value}`);
  return value;
}
