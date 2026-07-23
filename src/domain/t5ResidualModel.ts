export type MarketOutcome = {
  selection: string;
  marketProbability: number;
  odds: number;
};

export type ResidualRace = {
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
  winner: string;
  payoutYen: number;
  outcomes: MarketOutcome[];
};

export type ProbabilityModel = (race: ResidualRace) => Map<string, number>;

export type ProbabilityMetrics = {
  n: number;
  hits: number;
  hitRate: number | null;
  payoutRoi: number | null;
  payoutRoiExTop1: number | null;
  payoutRoiExTop2: number | null;
  logLoss: number | null;
  brier: number | null;
};

export function marketModel(race: ResidualRace) {
  return new Map(race.outcomes.map((row) => [row.selection, row.marketProbability]));
}

export function temperatureModel(temperature: number): ProbabilityModel {
  return (race) => normalizeWeights(race.outcomes.map((row) => [row.selection, Math.pow(row.marketProbability, 1 / temperature)]));
}

export function fitTemperature(races: ResidualRace[], grid = [0.6, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2]) {
  return grid.map((temperature) => ({ temperature, metrics: evaluateProbabilityModel(races, temperatureModel(temperature)) }))
    .sort((a, b) => (a.metrics.logLoss ?? Infinity) - (b.metrics.logLoss ?? Infinity))[0];
}

export function fitSelectionFactors(races: ResidualRace[], priorStrength: number) {
  const expected = new Map<string, number>();
  const actual = new Map<string, number>();
  const selections = new Set<string>();
  for (const race of races) {
    actual.set(race.winner, (actual.get(race.winner) ?? 0) + 1);
    for (const row of race.outcomes) {
      selections.add(row.selection);
      expected.set(row.selection, (expected.get(row.selection) ?? 0) + row.marketProbability);
    }
  }
  const priorPerSelection = priorStrength / Math.max(1, selections.size);
  return new Map([...selections].map((selection) => [
    selection,
    ((actual.get(selection) ?? 0) + priorPerSelection) / ((expected.get(selection) ?? 0) + priorPerSelection),
  ]));
}

export function selectionResidualModel(factors: Map<string, number>, temperature = 1): ProbabilityModel {
  return (race) => normalizeWeights(race.outcomes.map((row) => [
    row.selection,
    Math.pow(row.marketProbability, 1 / temperature) * (factors.get(row.selection) ?? 1),
  ]));
}

export function fitSelectionResidual(
  races: ResidualRace[],
  temperatures = [0.75, 0.9, 1, 1.1, 1.25],
  priorStrengths = [30, 60, 120, 240, 480, 960],
) {
  return temperatures.flatMap((temperature) => priorStrengths.map((priorStrength) => {
    const factors = fitSelectionFactors(races, priorStrength);
    const model = selectionResidualModel(factors, temperature);
    return { temperature, priorStrength, factors, metrics: evaluateProbabilityModel(races, model) };
  })).sort((a, b) => (a.metrics.logLoss ?? Infinity) - (b.metrics.logLoss ?? Infinity))[0];
}

export function evaluateProbabilityModel(races: ResidualRace[], model: ProbabilityModel): ProbabilityMetrics {
  if (!races.length) {
    return {
      n: 0,
      hits: 0,
      hitRate: null,
      payoutRoi: null,
      payoutRoiExTop1: null,
      payoutRoiExTop2: null,
      logLoss: null,
      brier: null,
    };
  }
  let hits = 0;
  let totalPayout = 0;
  let logLoss = 0;
  let brier = 0;
  const hitPayouts: number[] = [];
  for (const race of races) {
    const probabilities = model(race);
    const ranked = [...probabilities.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (ranked[0]?.[0] === race.winner) {
      hits += 1;
      totalPayout += race.payoutYen;
      hitPayouts.push(race.payoutYen);
    }
    const winnerProbability = Math.max(probabilities.get(race.winner) ?? 0, 1e-12);
    logLoss += -Math.log(winnerProbability);
    for (const [selection, probability] of probabilities) {
      const actual = selection === race.winner ? 1 : 0;
      brier += (probability - actual) ** 2;
    }
  }
  hitPayouts.sort((a, b) => b - a);
  const excludeHitPayouts = (count: number) => {
    const removed = Math.min(count, hitPayouts.length);
    const remainingRaces = races.length - removed;
    if (remainingRaces <= 0) return null;
    const removedPayout = hitPayouts.slice(0, removed).reduce((sum, value) => sum + value, 0);
    return (totalPayout - removedPayout) / (remainingRaces * 100);
  };
  return {
    n: races.length,
    hits,
    hitRate: hits / races.length,
    payoutRoi: totalPayout / (races.length * 100),
    payoutRoiExTop1: excludeHitPayouts(1),
    payoutRoiExTop2: excludeHitPayouts(2),
    logLoss: logLoss / races.length,
    brier: brier / races.length,
  };
}

function normalizeWeights(rows: Array<[string, number]>) {
  const total = rows.reduce((sum, [, value]) => sum + value, 0);
  if (!(total > 0)) return new Map<string, number>();
  return new Map(rows.map(([selection, value]) => [selection, value / total]));
}
