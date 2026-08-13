import { canonicalHash } from "./canonical";
import { enumerateBetSelections } from "./n2DatasetContract";
import {
  N2_HISTORICAL_GLOBAL_LAPLACE_ALPHA,
  N2_HISTORICAL_LOOKBACK_DAYS,
  N2_HISTORICAL_MIN_GLOBAL_TRAINING_RACES,
  N2_HISTORICAL_MIN_VENUE_TRAINING_RACES,
  N2_HISTORICAL_ONLY_BASELINE_ID,
  N2_HISTORICAL_VENUE_SHRINKAGE_PSEUDO_RACES,
  type N2HistoricalOutcomeRow,
} from "./n2HistoricalOnlyBaselineDataset";

export const N2_HISTORICAL_ROLLING_BASELINE_VERSION =
  "n2-historical-rolling-baseline-v1" as const;

const RACE_KEY_RE = /^(\d{4}-\d{2}-\d{2}):(0[1-9]|1\d|2[0-4]):R([1-9]|1[0-2])$/u;
const SELECTIONS = enumerateBetSelections("trifecta");
const SELECTION_SET = new Set(SELECTIONS);

export type N2HistoricalRollingSupport = {
  canonicalRaceKey: string;
  supported: boolean;
  globalTrainingRaceCount: number;
  venueTrainingRaceCount: number;
  trainingFromDateInclusive: string;
  trainingToDateExclusive: string;
};

export type N2HistoricalRollingBaselineRace = N2HistoricalRollingSupport & {
  winningSelection: string;
  baselineId: typeof N2_HISTORICAL_ONLY_BASELINE_ID;
  probabilityBySelection: Record<string, number>;
  probabilitySum: number;
  trainingCountStateDigest: string;
};

export type N2HistoricalRollingBaselineReport = {
  rollingVersion: typeof N2_HISTORICAL_ROLLING_BASELINE_VERSION;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  requestedRaceCount: number;
  supportedRaceCount: number;
  unsupportedRaceCount: number;
  baselineRaceCount: number;
  baselineSelectionRowCount: number;
  baselineId: typeof N2_HISTORICAL_ONLY_BASELINE_ID;
  lookbackDays: number;
  minGlobalTrainingRaces: number;
  minVenueTrainingRaces: number;
  sourceOutcomeCount: number;
  supports: N2HistoricalRollingSupport[];
  baselines: N2HistoricalRollingBaselineRace[];
  outputDigest: string;
};

type ParsedOutcome = N2HistoricalOutcomeRow & {
  date: string;
  venueCode: string;
  raceNo: number;
};

type CounterState = {
  total: number;
  hits: Map<string, number>;
};

type RollingState = {
  global: CounterState;
  byVenue: Map<string, CounterState>;
  addIndex: number;
  removeIndex: number;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function parseRaceKey(value: string): { date: string; venueCode: string; raceNo: number } | null {
  const match = RACE_KEY_RE.exec(value);
  if (!match) return null;
  const date = match[1];
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) return null;
  return { date, venueCode: match[2], raceNo: Number(match[3]) };
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) {
    throw new Error(`N2_ROLLING_DATE_INVALID:${date}`);
  }
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function compareRaceKey(left: string, right: string): number {
  const a = parseRaceKey(left);
  const b = parseRaceKey(right);
  if (!a || !b) return left.localeCompare(right);
  return a.date.localeCompare(b.date)
    || Number(a.venueCode) - Number(b.venueCode)
    || a.raceNo - b.raceNo;
}

function emptyCounter(): CounterState {
  return { total: 0, hits: new Map(SELECTIONS.map((selection) => [selection, 0])) };
}

function venueCounter(state: RollingState, venueCode: string): CounterState {
  const existing = state.byVenue.get(venueCode);
  if (existing) return existing;
  const created = emptyCounter();
  state.byVenue.set(venueCode, created);
  return created;
}

function mutateCounter(counter: CounterState, selection: string, delta: 1 | -1): void {
  counter.total += delta;
  counter.hits.set(selection, (counter.hits.get(selection) ?? 0) + delta);
  if (counter.total < 0 || (counter.hits.get(selection) ?? 0) < 0) {
    throw new Error("N2_ROLLING_COUNTER_UNDERFLOW");
  }
}

function mutateOutcome(state: RollingState, outcome: ParsedOutcome, delta: 1 | -1): void {
  mutateCounter(state.global, outcome.winningSelection, delta);
  mutateCounter(venueCounter(state, outcome.venueCode), outcome.winningSelection, delta);
}

function advanceWindow(state: RollingState, outcomes: ParsedOutcome[], evaluationDate: string): string {
  while (state.addIndex < outcomes.length && outcomes[state.addIndex].date < evaluationDate) {
    mutateOutcome(state, outcomes[state.addIndex], 1);
    state.addIndex += 1;
  }
  const fromDate = addDays(evaluationDate, -N2_HISTORICAL_LOOKBACK_DAYS);
  while (state.removeIndex < state.addIndex && outcomes[state.removeIndex].date < fromDate) {
    mutateOutcome(state, outcomes[state.removeIndex], -1);
    state.removeIndex += 1;
  }
  return fromDate;
}

function probabilityMap(global: CounterState, venue: CounterState): Record<string, number> {
  const result: Record<string, number> = {};
  const globalDenominator = global.total
    + N2_HISTORICAL_GLOBAL_LAPLACE_ALPHA * SELECTIONS.length;
  const venueDenominator = venue.total + N2_HISTORICAL_VENUE_SHRINKAGE_PSEUDO_RACES;
  for (const selection of SELECTIONS) {
    const globalProbability = (
      (global.hits.get(selection) ?? 0) + N2_HISTORICAL_GLOBAL_LAPLACE_ALPHA
    ) / globalDenominator;
    result[selection] = (
      (venue.hits.get(selection) ?? 0)
      + N2_HISTORICAL_VENUE_SHRINKAGE_PSEUDO_RACES * globalProbability
    ) / venueDenominator;
  }
  return result;
}

function countStateDigest(global: CounterState, venue: CounterState): string {
  return canonicalHash({
    globalTrainingRaceCount: global.total,
    venueTrainingRaceCount: venue.total,
    globalHits: SELECTIONS.map((selection) => [selection, global.hits.get(selection) ?? 0]),
    venueHits: SELECTIONS.map((selection) => [selection, venue.hits.get(selection) ?? 0]),
  });
}

function blocked(blockers: string[], requestedRaceCount: number, sourceOutcomeCount: number): N2HistoricalRollingBaselineReport {
  const core = {
    rollingVersion: N2_HISTORICAL_ROLLING_BASELINE_VERSION,
    status: "BLOCKED" as const,
    blockers: unique(blockers),
    requestedRaceCount,
    supportedRaceCount: 0,
    unsupportedRaceCount: 0,
    baselineRaceCount: 0,
    baselineSelectionRowCount: 0,
    baselineId: N2_HISTORICAL_ONLY_BASELINE_ID,
    lookbackDays: N2_HISTORICAL_LOOKBACK_DAYS,
    minGlobalTrainingRaces: N2_HISTORICAL_MIN_GLOBAL_TRAINING_RACES,
    minVenueTrainingRaces: N2_HISTORICAL_MIN_VENUE_TRAINING_RACES,
    sourceOutcomeCount,
    supports: [] as N2HistoricalRollingSupport[],
    baselines: [] as N2HistoricalRollingBaselineRace[],
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

export function buildN2HistoricalRollingBaseline(input: {
  outcomes: N2HistoricalOutcomeRow[];
  requestedRaceKeys: string[];
  includeProbabilities?: boolean;
}): N2HistoricalRollingBaselineReport {
  const blockers: string[] = [];
  const parsedOutcomes: ParsedOutcome[] = [];
  const outcomeByRace = new Map<string, ParsedOutcome>();
  for (const row of input.outcomes) {
    const parsed = parseRaceKey(row.canonicalRaceKey);
    if (!parsed) blockers.push(`${row.canonicalRaceKey}:OUTCOME_RACE_KEY_INVALID`);
    if (!SELECTION_SET.has(row.winningSelection)) blockers.push(`${row.canonicalRaceKey}:OUTCOME_SELECTION_INVALID`);
    if (outcomeByRace.has(row.canonicalRaceKey)) blockers.push(`${row.canonicalRaceKey}:DUPLICATE_OUTCOME_RACE`);
    if (parsed && SELECTION_SET.has(row.winningSelection)) {
      const built = { ...row, ...parsed };
      parsedOutcomes.push(built);
      outcomeByRace.set(row.canonicalRaceKey, built);
    }
  }
  const requestedSet = new Set<string>();
  const parsedRequested: Array<{ canonicalRaceKey: string; date: string; venueCode: string; raceNo: number }> = [];
  for (const canonicalRaceKey of input.requestedRaceKeys) {
    const parsed = parseRaceKey(canonicalRaceKey);
    if (!parsed) blockers.push(`${canonicalRaceKey}:REQUEST_RACE_KEY_INVALID`);
    if (requestedSet.has(canonicalRaceKey)) blockers.push(`${canonicalRaceKey}:DUPLICATE_REQUEST_RACE`);
    requestedSet.add(canonicalRaceKey);
    if (parsed) parsedRequested.push({ canonicalRaceKey, ...parsed });
  }
  if (blockers.length > 0) return blocked(blockers, input.requestedRaceKeys.length, input.outcomes.length);

  parsedOutcomes.sort((left, right) => compareRaceKey(left.canonicalRaceKey, right.canonicalRaceKey));
  parsedRequested.sort((left, right) => compareRaceKey(left.canonicalRaceKey, right.canonicalRaceKey));
  const state: RollingState = {
    global: emptyCounter(),
    byVenue: new Map(),
    addIndex: 0,
    removeIndex: 0,
  };
  const supports: N2HistoricalRollingSupport[] = [];
  const baselines: N2HistoricalRollingBaselineRace[] = [];
  let currentDate: string | null = null;
  let currentFromDate = "";

  for (const requested of parsedRequested) {
    if (requested.date !== currentDate) {
      currentFromDate = advanceWindow(state, parsedOutcomes, requested.date);
      currentDate = requested.date;
    }
    const venue = venueCounter(state, requested.venueCode);
    const supported = state.global.total >= N2_HISTORICAL_MIN_GLOBAL_TRAINING_RACES
      && venue.total >= N2_HISTORICAL_MIN_VENUE_TRAINING_RACES;
    const support: N2HistoricalRollingSupport = {
      canonicalRaceKey: requested.canonicalRaceKey,
      supported,
      globalTrainingRaceCount: state.global.total,
      venueTrainingRaceCount: venue.total,
      trainingFromDateInclusive: currentFromDate,
      trainingToDateExclusive: requested.date,
    };
    supports.push(support);
    if (!supported || input.includeProbabilities === false) continue;
    const outcome = outcomeByRace.get(requested.canonicalRaceKey);
    if (!outcome) {
      blockers.push(`${requested.canonicalRaceKey}:REQUEST_OUTCOME_MISSING`);
      continue;
    }
    const probabilities = probabilityMap(state.global, venue);
    const probabilitySum = Object.values(probabilities).reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(probabilitySum) || Math.abs(probabilitySum - 1) > 1e-12) {
      blockers.push(`${requested.canonicalRaceKey}:PROBABILITY_SUM_INVALID:${probabilitySum}`);
      continue;
    }
    baselines.push({
      ...support,
      winningSelection: outcome.winningSelection,
      baselineId: N2_HISTORICAL_ONLY_BASELINE_ID,
      probabilityBySelection: probabilities,
      probabilitySum,
      trainingCountStateDigest: countStateDigest(state.global, venue),
    });
  }
  if (blockers.length > 0) return blocked(blockers, input.requestedRaceKeys.length, input.outcomes.length);

  const supportedRaceCount = supports.filter((support) => support.supported).length;
  const core = {
    rollingVersion: N2_HISTORICAL_ROLLING_BASELINE_VERSION,
    status: "PASS" as const,
    blockers: [] as string[],
    requestedRaceCount: parsedRequested.length,
    supportedRaceCount,
    unsupportedRaceCount: parsedRequested.length - supportedRaceCount,
    baselineRaceCount: baselines.length,
    baselineSelectionRowCount: baselines.length * SELECTIONS.length,
    baselineId: N2_HISTORICAL_ONLY_BASELINE_ID,
    lookbackDays: N2_HISTORICAL_LOOKBACK_DAYS,
    minGlobalTrainingRaces: N2_HISTORICAL_MIN_GLOBAL_TRAINING_RACES,
    minVenueTrainingRaces: N2_HISTORICAL_MIN_VENUE_TRAINING_RACES,
    sourceOutcomeCount: parsedOutcomes.length,
    supports,
    baselines,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}
