import { DatabaseSync } from "node:sqlite";
import { judgeCandidate, DEFAULT_APP_RULE, DEFAULT_RULE } from "../src/domain/decision";
import { buildCandidatesFromModel, buildVenueModel, type ModelCandidateInput } from "../src/domain/model";
import { filterComparableResultsForDate } from "../src/domain/raceRegime";
import { summarizeEvaluation, type EvaluationReport, type V4EvaluationRow } from "../src/domain/v4Evaluation";
import { listProgramInputsRange, listResultsForModelRange } from "../server/db";
import type { BudgetRule, RaceResult } from "../src/domain/types";

type Args = {
  from: string | null;
  to: string | null;
  limit: number | null;
  trainDays: number;
  json: boolean;
  b1LiveRule: boolean;
};

const DB_PATH = "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));

if (!args.from || !args.to || !args.limit) {
  printUsage();
  process.exit(1);
}

const evalArgs: Args & { from: string; to: string; limit: number } = {
  ...args,
  from: args.from,
  to: args.to,
  limit: args.limit,
};
const db = new DatabaseSync(DB_PATH, { readOnly: true });

try {
  const rows = evaluate(db, evalArgs);
  const report = summarizeEvaluation(rows);
  const historyComparison = compareExistingHistory(db, evalArgs.from, evalArgs.to);
  const payload = {
    generatedAt: new Date().toISOString(),
    mode: "read-only",
    warning: touchesLivePeriod(args.from, args.to)
      ? "2026年を含む読み取り専用評価です。live判断やdecision_history書き込みには使っていません。"
      : null,
    args: evalArgs,
    report,
    historyComparison,
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printReport(payload);
  }
} finally {
  db.close();
}

function evaluate(db: DatabaseSync, args: Args & { from: string; to: string; limit: number }): V4EvaluationRow[] {
  const programs = listProgramInputsRange(db, args.from, args.to, args.limit) as Array<ModelCandidateInput & { raceId?: string }>;
  const trainFrom = addDays(args.from, -args.trainDays);
  const allResults = listResultsForModelRange(db, trainFrom, args.to);
  const resultByRaceId = new Map(allResults.map((row) => [row.raceId, row]));
  const oddsByRaceSelection = latestOddsByRaceSelection(db, args.from, args.to);
  const modelCache = new Map<string, ReturnType<typeof buildVenueModel>>();
  const settings = args.b1LiveRule ? DEFAULT_APP_RULE : DEFAULT_RULE;

  return programs.map((program) => {
    const raceId = program.raceId ?? makeRaceId(program);
    const result = resultByRaceId.get(raceId);
    const model = modelForDate(allResults, program.date, args.trainDays, modelCache, settings);
    const candidate = buildCandidatesFromModel([program], model, settings.targetEv, `${program.date}T00:00:00+09:00`)[0];
    if (!candidate) {
      return {
        raceId,
        date: program.date,
        venue: program.venue,
        raceNo: program.raceNo,
        selection: null,
        className: null,
        decision: "NO_MODEL",
        hit: false,
        returned: Boolean(result?.returned),
        requiredOdds: null,
        currentOdds: null,
        ev: null,
        rawEstimatedHitRate: null,
        conservativeHitRate: null,
        estimatedHitRate: null,
      };
    }

    const selection = candidate.selection.join("-");
    const currentOdds = oddsByRaceSelection.get(`${raceId}|${selection}`) ?? null;
    const withOdds = { ...candidate, currentOdds };
    const decision = judgeCandidate(withOdds, settings, {
      now: beforeCloseTime(program.date, program.closeAt, settings.minMinutesBeforeClose + 10),
      buyCountToday: 0,
      reservedBudgetYen: 0,
    });

    return {
      raceId,
      date: program.date,
      venue: program.venue,
      raceNo: program.raceNo,
      selection,
      className: withOdds.candidateClassName ?? withOdds.firstBoatFeature?.className ?? null,
      decision: decision.status,
      hit: result?.trifecta === selection,
      returned: Boolean(result?.returned),
      requiredOdds: decision.requiredOdds,
      currentOdds,
      ev: decision.ev,
      rawEstimatedHitRate: withOdds.rawEstimatedHitRate ?? null,
      conservativeHitRate: withOdds.conservativeHitRate ?? null,
      estimatedHitRate: withOdds.estimatedHitRate,
    };
  });
}

function modelForDate(
  allResults: RaceResult[],
  date: string,
  trainDays: number,
  cache: Map<string, ReturnType<typeof buildVenueModel>>,
  settings: BudgetRule,
) {
  const key = `${date}|${trainDays}|${settings.minSampleSize}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const trainFrom = addDays(date, -trainDays);
  const comparable = filterComparableResultsForDate(
    allResults.filter((row) => row.date < date && row.date >= trainFrom),
    date,
  );
  const model = buildVenueModel(comparable, settings.minSampleSize);
  cache.set(key, model);
  return model;
}

function latestOddsByRaceSelection(db: DatabaseSync, from: string, to: string) {
  const rows = db.prepare(`
SELECT os.race_id, os.selection, os.odds
FROM odds_snapshots os
JOIN (
  SELECT os2.race_id, os2.selection, MAX(os2.id) AS id
  FROM odds_snapshots os2
  JOIN official_programs p ON p.race_id = os2.race_id
  WHERE p.date >= ? AND p.date <= ?
  GROUP BY os2.race_id, os2.selection
) latest ON latest.id = os.id
`).all(from, to) as Array<{ race_id: string; selection: string; odds: number }>;
  return new Map(rows.map((row) => [`${row.race_id}|${row.selection}`, Number(row.odds)]));
}

function compareExistingHistory(db: DatabaseSync, from: string, to: string) {
  const rows = db.prepare(`
SELECT
  COALESCE(model_version, '(null)') AS model_version,
  decision,
  COUNT(*) AS n,
  SUM(CASE WHEN decision='BUY' AND selection = result AND returned = 0 THEN 1 ELSE 0 END) AS hits,
  ROUND(SUM(CASE WHEN decision='BUY' AND selection = result AND returned = 0 THEN current_odds ELSE 0 END) * 1.0 /
    NULLIF(SUM(CASE WHEN decision='BUY' AND returned = 0 THEN 1 ELSE 0 END), 0), 3) AS roi
FROM decision_history
WHERE date >= ? AND date <= ?
GROUP BY model_version, decision
ORDER BY model_version, decision
`).all(from, to) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    modelVersion: String(row.model_version),
    decision: String(row.decision),
    n: Number(row.n),
    hits: Number(row.hits ?? 0),
    roi: row.roi == null ? null : Number(row.roi),
    note: "既存decision_historyの参考値。v4読み取り評価とは混ぜない。",
  }));
}

function printReport(payload: { warning: string | null; args: Args; report: EvaluationReport; historyComparison: ReturnType<typeof compareExistingHistory> }) {
  console.log("Boat Pon v4-conservative read-only evaluation");
  console.log(`period: ${payload.args.from}..${payload.args.to} limit=${payload.args.limit} trainDays=${payload.args.trainDays}`);
  if (payload.warning) console.log(`warning: ${payload.warning}`);
  printSummary("overall", payload.report.overall);
  printGroups("byYear", payload.report.byYear);
  printGroups("byMonth", payload.report.byMonth);
  printGroups("byVenue", payload.report.byVenue.slice(0, 24));
  printGroups("byRequiredOddsBand", payload.report.byRequiredOddsBand);
  printGroups("byOddsRatioBand", payload.report.byOddsRatioBand);
  printGroups("byClassName", payload.report.byClassName);
  if (payload.historyComparison.length > 0) {
    console.log("historyComparison(reference only):");
    for (const row of payload.historyComparison) {
      console.log(`  ${row.modelVersion}\t${row.decision}\tn=${row.n}\thits=${row.hits}\troi=${format(row.roi)}`);
    }
  }
}

function printSummary(label: string, row: EvaluationReport["overall"]) {
  console.log(`${label}: races=${row.races} modeled=${row.modeled} BUY=${row.buy} WATCH=${row.watch} SKIP=${row.skip} NO_MODEL=${row.noModel} hits=${row.hits} roi=${format(row.roi)} roiExMax=${format(row.roiExMax)} avgReq=${format(row.avgRequiredOdds)} avgCur=${format(row.avgCurrentOdds)} avgRatio=${format(row.avgOddsRatio)} discount=${formatPercent(row.avgConservativeDiscount)}`);
}

function printGroups(label: string, rows: EvaluationReport["byYear"]) {
  console.log(`${label}:`);
  for (const row of rows) {
    console.log(`  ${row.key}\tn=${row.races}\tBUY=${row.buy}\thits=${row.hits}\troi=${format(row.roi)}\tdiscount=${formatPercent(row.avgConservativeDiscount)}`);
  }
}

function format(value: number | null) {
  return value == null ? "-" : value.toFixed(3);
}

function formatPercent(value: number | null) {
  return value == null ? "-" : `${(value * 100).toFixed(1)}%`;
}

function makeRaceId(input: ModelCandidateInput) {
  return input.date.replaceAll("-", "") + "-" + input.venue + "-" + String(input.raceNo).padStart(2, "0");
}

function beforeCloseTime(date: string, closeAt: string, minutesBeforeClose: number) {
  const [hour, minute] = closeAt.split(":").map(Number);
  const base = new Date(`${date}T00:00:00+09:00`);
  base.setHours(hour, minute, 0, 0);
  return new Date(base.getTime() - minutesBeforeClose * 60_000);
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00+09:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function touchesLivePeriod(from: string, to: string) {
  return from >= "2026-01-01" || to >= "2026-01-01";
}

function parseArgs(argv: string[]): Args {
  const args: Args = { from: null, to: null, limit: null, trainDays: 180, json: false, b1LiveRule: true };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--from") { args.from = normalizeDate(value); i += 1; }
    else if (key === "--to") { args.to = normalizeDate(value); i += 1; }
    else if (key === "--limit") { args.limit = Number(value); i += 1; }
    else if (key === "--train-days") { args.trainDays = Number(value); i += 1; }
    else if (key === "--json") args.json = true;
    else if (key === "--no-b1-live-rule") args.b1LiveRule = false;
    else if (key === "--help" || key === "-h") { printUsage(); process.exit(0); }
    else throw new Error(`unknown option: ${key}`);
  }
  if (!Number.isInteger(args.limit) || (args.limit ?? 0) <= 0) args.limit = null;
  if (!Number.isInteger(args.trainDays) || args.trainDays <= 0) args.trainDays = 180;
  return args;
}

function normalizeDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`invalid date: ${value ?? ""}`);
  return value;
}

function printUsage() {
  console.log(`Usage:
  npm run evaluate:v4 -- --from YYYY-MM-DD --to YYYY-MM-DD --limit N [--json] [--train-days N]

This command is read-only. It does not write decision_history.`);
}
