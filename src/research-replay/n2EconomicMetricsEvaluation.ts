import { canonicalHash } from "./canonical";
import { enumerateBetSelections } from "./n2DatasetContract";
import {
  N2_METRICS_EV_EPSILON,
  N2_METRICS_FIXED_STAKE_YEN,
  N2_METRICS_POSITIVE_EV_THRESHOLD,
  N2_METRICS_REQUIRED_BASELINE_COUNT,
  N2_METRICS_REQUIRED_RACE_COUNT,
  type N2EconomicPolicyId,
} from "./n2MetricsContract";

export const N2_ECONOMIC_METRICS_EVALUATION_VERSION =
  "n2-economic-metrics-evaluation-v1" as const;

export type N2EconomicEvaluationRace = {
  canonicalRaceKey: string;
  decisionCutoff: string;
  winningSelection: string;
  payoutYen: number;
  marketOddsBySelection: Record<string, number>;
  probabilityByBaseline: Record<string, Record<string, number>>;
};

export type N2EconomicPolicyMetrics = {
  policyId: N2EconomicPolicyId;
  evaluableRaceCount: number;
  betRaceCount: number;
  betCoverage: number;
  hitCount: number;
  totalStakeYen: number;
  totalReturnYen: number;
  netProfitYen: number;
  returnRatePct: number | null;
  netRoiPct: number | null;
  maxDrawdownYen: number;
  maxDrawdownStakeUnits: number;
};

export type N2BaselineEconomicMetrics = {
  baselineId: string;
  forcedTop1: N2EconomicPolicyMetrics;
  positiveEvTop1: N2EconomicPolicyMetrics;
};

export type N2EconomicMetricsEvaluation = {
  evaluationVersion: typeof N2_ECONOMIC_METRICS_EVALUATION_VERSION;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  raceCount: number;
  baselineCount: number;
  baselineIds: string[];
  metricsByBaseline: Record<string, N2BaselineEconomicMetrics>;
  fixedStakeYen: number;
  positiveEvThreshold: number;
  positiveEvEpsilon: number;
  payoutUsedOnlyAfterTicketSelection: true;
  marketOddsUsedByForcedTop1: false;
  marketOddsUsedByPositiveEvTop1: true;
  outputDigest: string;
};

const SELECTIONS = enumerateBetSelections("trifecta");
const SELECTION_SET = new Set(SELECTIONS);
const BASELINE_ID_RE = /^[0-9A-Za-z][0-9A-Za-z._:-]{2,127}$/u;
const RACE_KEY_RE = /^(\d{4}-\d{2}-\d{2}):(0[1-9]|1\d|2[0-4]):R([1-9]|1[0-2])$/u;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function isCanonicalCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function isValidRaceKey(value: string): boolean {
  const match = RACE_KEY_RE.exec(value);
  return match !== null && isCanonicalCalendarDate(match[1]);
}

function isValidDecisionCutoff(value: string): boolean {
  const calendar = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (calendar === null || !isCanonicalCalendarDate(calendar[1])) return false;
  if (Number(calendar[2]) > 23 || Number(calendar[3]) > 59 || Number(calendar[4] ?? "0") > 59) return false;
  const offset = /([+-])(\d{2}):(\d{2})$/u.exec(value);
  if (offset !== null && (Number(offset[2]) > 23 || Number(offset[3]) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

function cutoffWithinRaceDate(canonicalRaceKey: string, cutoff: string): boolean {
  const match = RACE_KEY_RE.exec(canonicalRaceKey);
  if (match === null || !isCanonicalCalendarDate(match[1]) || !isValidDecisionCutoff(cutoff)) return false;
  const cutoffMs = Date.parse(cutoff);
  const raceDateStartJstMs = Date.parse(`${match[1]}T00:00:00+09:00`);
  return cutoffMs >= raceDateStartJstMs && cutoffMs < raceDateStartJstMs + 24 * 60 * 60 * 1000;
}

function validateSelectionMap(
  map: Record<string, number>,
  kind: "odds" | "probability",
): string[] {
  const keys = Object.keys(map).sort();
  const blockers: string[] = [];
  if (keys.length !== SELECTIONS.length) {
    blockers.push(`${kind.toUpperCase()}_SELECTION_COUNT:${keys.length}/${SELECTIONS.length}`);
  }
  for (const selection of keys) {
    if (!SELECTION_SET.has(selection)) blockers.push(`${kind.toUpperCase()}_SELECTION_INVALID:${selection}`);
    const value = map[selection];
    if (!Number.isFinite(value)) blockers.push(`${kind.toUpperCase()}_NON_FINITE:${selection}`);
    if (kind === "odds" && value < 1) blockers.push(`ODDS_BELOW_ONE:${selection}`);
    if (kind === "probability" && (value < 0 || value > 1)) blockers.push(`PROBABILITY_OUT_OF_RANGE:${selection}`);
  }
  for (const selection of SELECTIONS) {
    if (!Object.prototype.hasOwnProperty.call(map, selection)) {
      blockers.push(`${kind.toUpperCase()}_SELECTION_MISSING:${selection}`);
    }
  }
  return unique(blockers);
}

function compareCanonicalRaceKeys(left: string, right: string): number {
  const a = RACE_KEY_RE.exec(left);
  const b = RACE_KEY_RE.exec(right);
  if (a === null || b === null) return left.localeCompare(right);
  return a[1].localeCompare(b[1])
    || Number(a[2]) - Number(b[2])
    || Number(a[3]) - Number(b[3]);
}

function compareRaceOrder(left: N2EconomicEvaluationRace, right: N2EconomicEvaluationRace): number {
  return Date.parse(left.decisionCutoff) - Date.parse(right.decisionCutoff)
    || compareCanonicalRaceKeys(left.canonicalRaceKey, right.canonicalRaceKey);
}

function bestBy(
  probabilities: Record<string, number>,
  score: (selection: string, probability: number) => number,
): { selection: string; score: number } {
  let bestSelection = SELECTIONS[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const selection of SELECTIONS) {
    const candidateScore = score(selection, probabilities[selection]);
    if (candidateScore > bestScore
      || (candidateScore === bestScore && selection.localeCompare(bestSelection) < 0)) {
      bestSelection = selection;
      bestScore = candidateScore;
    }
  }
  return { selection: bestSelection, score: bestScore };
}

type TicketDecision = {
  placed: boolean;
  selection: string | null;
};

function decideTicket(input: {
  policyId: N2EconomicPolicyId;
  probabilities: Record<string, number>;
  marketOdds: Record<string, number>;
}): TicketDecision {
  if (input.policyId === "forced_top1") {
    const best = bestBy(input.probabilities, (_selection, probability) => probability);
    return { placed: true, selection: best.selection };
  }
  const best = bestBy(
    input.probabilities,
    (selection, probability) => probability * input.marketOdds[selection],
  );
  return best.score > N2_METRICS_POSITIVE_EV_THRESHOLD + N2_METRICS_EV_EPSILON
    ? { placed: true, selection: best.selection }
    : { placed: false, selection: null };
}

function evaluatePolicy(input: {
  policyId: N2EconomicPolicyId;
  baselineId: string;
  races: N2EconomicEvaluationRace[];
}): N2EconomicPolicyMetrics {
  let betRaceCount = 0;
  let hitCount = 0;
  let totalStakeYen = 0;
  let totalReturnYen = 0;
  let cumulativeNetProfitYen = 0;
  let runningPeakNetProfitYen = 0;
  let maxDrawdownYen = 0;

  for (const race of input.races) {
    const probabilities = race.probabilityByBaseline[input.baselineId];
    const ticket = decideTicket({
      policyId: input.policyId,
      probabilities,
      marketOdds: race.marketOddsBySelection,
    });
    if (ticket.placed && ticket.selection != null) {
      betRaceCount += 1;
      totalStakeYen += N2_METRICS_FIXED_STAKE_YEN;
      const hit = ticket.selection === race.winningSelection;
      if (hit) hitCount += 1;
      const raceReturnYen = hit ? race.payoutYen : 0;
      totalReturnYen += raceReturnYen;
      cumulativeNetProfitYen += raceReturnYen - N2_METRICS_FIXED_STAKE_YEN;
    }
    runningPeakNetProfitYen = Math.max(runningPeakNetProfitYen, cumulativeNetProfitYen);
    maxDrawdownYen = Math.max(
      maxDrawdownYen,
      runningPeakNetProfitYen - cumulativeNetProfitYen,
    );
  }

  const netProfitYen = totalReturnYen - totalStakeYen;
  return {
    policyId: input.policyId,
    evaluableRaceCount: input.races.length,
    betRaceCount,
    betCoverage: input.races.length === 0 ? 0 : betRaceCount / input.races.length,
    hitCount,
    totalStakeYen,
    totalReturnYen,
    netProfitYen,
    returnRatePct: totalStakeYen === 0 ? null : (totalReturnYen / totalStakeYen) * 100,
    netRoiPct: totalStakeYen === 0 ? null : (netProfitYen / totalStakeYen) * 100,
    maxDrawdownYen,
    maxDrawdownStakeUnits: maxDrawdownYen / N2_METRICS_FIXED_STAKE_YEN,
  };
}

function blocked(blockers: string[]): N2EconomicMetricsEvaluation {
  const normalizedBlockers = unique(blockers);
  const core = {
    evaluationVersion: N2_ECONOMIC_METRICS_EVALUATION_VERSION,
    status: "BLOCKED" as const,
    blockers: normalizedBlockers,
    raceCount: 0,
    baselineCount: 0,
    baselineIds: [] as string[],
    metricsByBaseline: {} as Record<string, N2BaselineEconomicMetrics>,
    fixedStakeYen: N2_METRICS_FIXED_STAKE_YEN,
    positiveEvThreshold: N2_METRICS_POSITIVE_EV_THRESHOLD,
    positiveEvEpsilon: N2_METRICS_EV_EPSILON,
    payoutUsedOnlyAfterTicketSelection: true as const,
    marketOddsUsedByForcedTop1: false as const,
    marketOddsUsedByPositiveEvTop1: true as const,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

export function evaluateN2EconomicMetrics(input: {
  races: N2EconomicEvaluationRace[];
}): N2EconomicMetricsEvaluation {
  const blockers: string[] = [];
  if (input.races.length !== N2_METRICS_REQUIRED_RACE_COUNT) {
    blockers.push(`RACE_COUNT:${input.races.length}/${N2_METRICS_REQUIRED_RACE_COUNT}`);
  }
  const raceKeys = input.races.map((race) => race.canonicalRaceKey);
  if (new Set(raceKeys).size !== raceKeys.length) blockers.push("DUPLICATE_RACE_KEY");

  let expectedBaselineIds: string[] | null = null;
  for (const race of input.races) {
    if (!isValidRaceKey(race.canonicalRaceKey)) blockers.push(`${race.canonicalRaceKey}:RACE_KEY_INVALID`);
    if (!isValidDecisionCutoff(race.decisionCutoff)) blockers.push(`${race.canonicalRaceKey}:DECISION_CUTOFF_INVALID`);
    else if (!cutoffWithinRaceDate(race.canonicalRaceKey, race.decisionCutoff)) {
      blockers.push(`${race.canonicalRaceKey}:DECISION_CUTOFF_OUTSIDE_RACE_DATE`);
    }
    if (!SELECTION_SET.has(race.winningSelection)) blockers.push(`${race.canonicalRaceKey}:WINNING_SELECTION_INVALID`);
    if (!Number.isSafeInteger(race.payoutYen) || race.payoutYen < N2_METRICS_FIXED_STAKE_YEN) {
      blockers.push(`${race.canonicalRaceKey}:PAYOUT_INVALID`);
    }
    blockers.push(...validateSelectionMap(race.marketOddsBySelection, "odds")
      .map((blockerCode) => `${race.canonicalRaceKey}:${blockerCode}`));

    const baselineIds = Object.keys(race.probabilityByBaseline).sort();
    if (baselineIds.length !== N2_METRICS_REQUIRED_BASELINE_COUNT) {
      blockers.push(`${race.canonicalRaceKey}:BASELINE_COUNT:${baselineIds.length}/${N2_METRICS_REQUIRED_BASELINE_COUNT}`);
    }
    for (const baselineId of baselineIds) {
      if (!BASELINE_ID_RE.test(baselineId)) {
        blockers.push(`${race.canonicalRaceKey}:BASELINE_ID_INVALID:${baselineId}`);
      }
    }
    if (expectedBaselineIds == null) expectedBaselineIds = baselineIds;
    else if (baselineIds.join("|") !== expectedBaselineIds.join("|")) {
      blockers.push(`${race.canonicalRaceKey}:BASELINE_SET_MISMATCH`);
    }
    for (const baselineId of baselineIds) {
      blockers.push(...validateSelectionMap(race.probabilityByBaseline[baselineId], "probability")
        .map((blockerCode) => `${race.canonicalRaceKey}:${baselineId}:${blockerCode}`));
    }
  }
  if (blockers.length > 0) return blocked(blockers);

  const baselineIds = expectedBaselineIds ?? [];
  const races = [...input.races].sort(compareRaceOrder);
  const metricsByBaseline: Record<string, N2BaselineEconomicMetrics> = {};
  for (const baselineId of baselineIds) {
    metricsByBaseline[baselineId] = {
      baselineId,
      forcedTop1: evaluatePolicy({ policyId: "forced_top1", baselineId, races }),
      positiveEvTop1: evaluatePolicy({ policyId: "positive_ev_top1", baselineId, races }),
    };
  }
  const core = {
    evaluationVersion: N2_ECONOMIC_METRICS_EVALUATION_VERSION,
    status: "PASS" as const,
    blockers: [] as string[],
    raceCount: races.length,
    baselineCount: baselineIds.length,
    baselineIds,
    metricsByBaseline,
    fixedStakeYen: N2_METRICS_FIXED_STAKE_YEN,
    positiveEvThreshold: N2_METRICS_POSITIVE_EV_THRESHOLD,
    positiveEvEpsilon: N2_METRICS_EV_EPSILON,
    payoutUsedOnlyAfterTicketSelection: true as const,
    marketOddsUsedByForcedTop1: false as const,
    marketOddsUsedByPositiveEvTop1: true as const,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}
