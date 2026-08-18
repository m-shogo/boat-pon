import { canonicalHash, canonicalUtcTimestamp } from "./canonical";

export const N2_TRIFECTA_MARKET_FEATURE_VERSION =
  "n2-trifecta-market-features-v1" as const;

export const N2_TRIFECTA_MARKET_CHECKPOINTS = [
  "T-30",
  "T-20",
  "T-10",
  "T-5",
] as const;

export type N2TrifectaMarketCheckpointLabel =
  (typeof N2_TRIFECTA_MARKET_CHECKPOINTS)[number];

export type N2TrifectaMarketSnapshotInput = {
  raceIdentity: string;
  checkpointLabel: N2TrifectaMarketCheckpointLabel;
  capturedAt: string;
  availableAt: string;
  odds: ReadonlyMap<string, number> | Record<string, number>;
};

export type N2TrifectaSelectionMarketFeature = {
  selection: string;
  odds: number;
  rank: number;
  marketMassShare: number;
};

export type N2TrifectaMarketSnapshotFeatures = {
  featureVersion: typeof N2_TRIFECTA_MARKET_FEATURE_VERSION;
  raceIdentity: string;
  checkpointLabel: N2TrifectaMarketCheckpointLabel;
  capturedAt: string;
  availableAt: string;
  selectionCount: 120;
  inverseOddsMassTotal: number;
  entropyNats: number;
  normalizedEntropy: number;
  effectiveSelectionCount: number;
  herfindahlIndex: number;
  favoriteSelection: string;
  favoriteOdds: number;
  secondFavoriteOdds: number;
  favoriteGapRatio: number;
  top1MassShare: number;
  top3MassShare: number;
  top5MassShare: number;
  top10MassShare: number;
  oddsP10: number;
  oddsMedian: number;
  oddsP90: number;
  oddsSpreadP90P10: number;
  selections: N2TrifectaSelectionMarketFeature[];
  privateResearchOnly: true;
  publicPublishAuthorized: false;
  databaseWriteAuthorized: false;
  outputDigest: string;
};

export type N2TrifectaMarketSnapshotFeatureResult = {
  status: "PASS" | "BLOCKED";
  blockers: string[];
  snapshot: N2TrifectaMarketSnapshotFeatures | null;
};

export type N2TrifectaSelectionMarketMove = {
  selection: string;
  previousRank: number;
  currentRank: number;
  rankImprovement: number;
  logOddsRatio: number;
  marketMassShareDelta: number;
};

export type N2TrifectaMarketTransitionFeatures = {
  featureVersion: typeof N2_TRIFECTA_MARKET_FEATURE_VERSION;
  raceIdentity: string;
  fromCheckpoint: N2TrifectaMarketCheckpointLabel;
  toCheckpoint: N2TrifectaMarketCheckpointLabel;
  checkpointStepsApart: number;
  capturedSecondsApart: number | null;
  jensenShannonDivergenceBits: number;
  totalVariationDistance: number;
  favoriteChanged: boolean;
  top5RetainedCount: number;
  top5ChurnRate: number;
  medianAbsoluteLogOddsMove: number;
  maxAbsoluteLogOddsMove: number;
  massWeightedAbsoluteLogOddsMove: number;
  shorteningSelectionCount: number;
  lengtheningSelectionCount: number;
  unchangedSelectionCount: number;
  moves: N2TrifectaSelectionMarketMove[];
  privateResearchOnly: true;
  publicPublishAuthorized: false;
  databaseWriteAuthorized: false;
  outputDigest: string;
};

export type N2TrifectaMarketRaceFeatureSequence = {
  featureVersion: typeof N2_TRIFECTA_MARKET_FEATURE_VERSION;
  status: "PASS" | "PARTIAL" | "NO_DATA" | "BLOCKED";
  blockers: string[];
  raceIdentity: string | null;
  availableCheckpoints: N2TrifectaMarketCheckpointLabel[];
  missingCheckpoints: N2TrifectaMarketCheckpointLabel[];
  snapshots: N2TrifectaMarketSnapshotFeatures[];
  transitions: N2TrifectaMarketTransitionFeatures[];
  privateResearchOnly: true;
  publicPublishAuthorized: false;
  databaseWriteAuthorized: false;
  outputDigest: string;
};

const EXPECTED_SELECTIONS = buildExpectedSelections();
const EXPECTED_SELECTION_SET = new Set(EXPECTED_SELECTIONS);
const MOVE_EPSILON = 1e-12;

function buildExpectedSelections(): string[] {
  const values: string[] = [];
  for (let first = 1; first <= 6; first += 1) {
    for (let second = 1; second <= 6; second += 1) {
      if (second === first) continue;
      for (let third = 1; third <= 6; third += 1) {
        if (third === first || third === second) continue;
        values.push(`${first}-${second}-${third}`);
      }
    }
  }
  return values.sort(selectionCompare);
}

function selectionCompare(left: string, right: string): number {
  const a = left.split("-").map(Number);
  const b = right.split("-").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function checkpointIndex(label: N2TrifectaMarketCheckpointLabel): number {
  return N2_TRIFECTA_MARKET_CHECKPOINTS.indexOf(label);
}

function instant(value: string): number | null {
  try {
    return Date.parse(canonicalUtcTimestamp(value));
  } catch {
    return null;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function oddsEntries(
  odds: ReadonlyMap<string, number> | Record<string, number>,
): Array<[string, number]> {
  return odds instanceof Map
    ? [...odds.entries()]
    : Object.entries(odds);
}

function quantile(sorted: number[], probability: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function median(values: number[]): number {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

function validateSnapshotInput(input: N2TrifectaMarketSnapshotInput): string[] {
  const blockers: string[] = [];
  if (!input.raceIdentity.trim()) blockers.push("RACE_IDENTITY_EMPTY");
  if (!N2_TRIFECTA_MARKET_CHECKPOINTS.includes(input.checkpointLabel)) {
    blockers.push("CHECKPOINT_LABEL_INVALID");
  }
  const capturedAt = instant(input.capturedAt);
  const availableAt = instant(input.availableAt);
  if (capturedAt == null) blockers.push("CAPTURED_AT_INVALID");
  if (availableAt == null) blockers.push("AVAILABLE_AT_INVALID");
  if (capturedAt != null && availableAt != null && availableAt > capturedAt) {
    blockers.push("AVAILABLE_AT_AFTER_CAPTURED_AT");
  }

  const entries = oddsEntries(input.odds);
  if (entries.length !== 120) blockers.push("SELECTION_COUNT_NOT_120");
  const seen = new Set<string>();
  for (const [selection, odds] of entries) {
    if (!EXPECTED_SELECTION_SET.has(selection)) blockers.push("SELECTION_IDENTITY_INVALID");
    if (seen.has(selection)) blockers.push("DUPLICATE_SELECTION");
    seen.add(selection);
    if (!Number.isFinite(odds) || odds <= 0) blockers.push("ODDS_NOT_POSITIVE_FINITE");
  }
  for (const selection of EXPECTED_SELECTIONS) {
    if (!seen.has(selection)) blockers.push("SELECTION_UNIVERSE_INCOMPLETE");
  }
  return unique(blockers);
}

export function buildN2TrifectaMarketSnapshotFeatures(
  input: N2TrifectaMarketSnapshotInput,
): N2TrifectaMarketSnapshotFeatureResult {
  const blockers = validateSnapshotInput(input);
  if (blockers.length > 0) return { status: "BLOCKED", blockers, snapshot: null };

  const ranked = oddsEntries(input.odds)
    .map(([selection, odds]) => ({ selection, odds }))
    .sort((left, right) => left.odds - right.odds || selectionCompare(left.selection, right.selection));
  const inverseOddsMassTotal = ranked.reduce((sum, row) => sum + 1 / row.odds, 0);
  if (!Number.isFinite(inverseOddsMassTotal) || inverseOddsMassTotal <= 0) {
    return {
      status: "BLOCKED",
      blockers: ["INVERSE_ODDS_MASS_INVALID"],
      snapshot: null,
    };
  }

  const selections: N2TrifectaSelectionMarketFeature[] = ranked.map((row, index) => ({
    selection: row.selection,
    odds: row.odds,
    rank: index + 1,
    marketMassShare: (1 / row.odds) / inverseOddsMassTotal,
  }));
  const shares = selections.map((row) => row.marketMassShare);
  const entropyNats = -shares.reduce(
    (sum, share) => sum + (share > 0 ? share * Math.log(share) : 0),
    0,
  );
  const normalizedEntropy = entropyNats / Math.log(120);
  const herfindahlIndex = shares.reduce((sum, share) => sum + share * share, 0);
  const sortedOdds = selections.map((row) => row.odds).sort((a, b) => a - b);
  const oddsP10 = quantile(sortedOdds, 0.1);
  const oddsMedian = quantile(sortedOdds, 0.5);
  const oddsP90 = quantile(sortedOdds, 0.9);
  const core = {
    featureVersion: N2_TRIFECTA_MARKET_FEATURE_VERSION,
    raceIdentity: input.raceIdentity,
    checkpointLabel: input.checkpointLabel,
    capturedAt: input.capturedAt,
    availableAt: input.availableAt,
    selectionCount: 120 as const,
    inverseOddsMassTotal,
    entropyNats,
    normalizedEntropy,
    effectiveSelectionCount: Math.exp(entropyNats),
    herfindahlIndex,
    favoriteSelection: selections[0].selection,
    favoriteOdds: selections[0].odds,
    secondFavoriteOdds: selections[1].odds,
    favoriteGapRatio: selections[1].odds / selections[0].odds,
    top1MassShare: shares[0],
    top3MassShare: shares.slice(0, 3).reduce((sum, value) => sum + value, 0),
    top5MassShare: shares.slice(0, 5).reduce((sum, value) => sum + value, 0),
    top10MassShare: shares.slice(0, 10).reduce((sum, value) => sum + value, 0),
    oddsP10,
    oddsMedian,
    oddsP90,
    oddsSpreadP90P10: oddsP10 > 0 ? oddsP90 / oddsP10 : Number.NaN,
    selections,
    privateResearchOnly: true as const,
    publicPublishAuthorized: false as const,
    databaseWriteAuthorized: false as const,
  };
  return {
    status: "PASS",
    blockers: [],
    snapshot: { ...core, outputDigest: canonicalHash(core) },
  };
}

function jsTerm(value: number, midpoint: number): number {
  if (value <= 0 || midpoint <= 0) return 0;
  return value * Math.log2(value / midpoint);
}

export function buildN2TrifectaMarketTransitionFeatures(
  previous: N2TrifectaMarketSnapshotFeatures,
  current: N2TrifectaMarketSnapshotFeatures,
): N2TrifectaMarketTransitionFeatures {
  if (previous.raceIdentity !== current.raceIdentity) {
    throw new Error("TRANSITION_RACE_IDENTITY_MISMATCH");
  }
  const fromIndex = checkpointIndex(previous.checkpointLabel);
  const toIndex = checkpointIndex(current.checkpointLabel);
  if (fromIndex < 0 || toIndex <= fromIndex) {
    throw new Error("TRANSITION_CHECKPOINT_ORDER_INVALID");
  }

  const previousBySelection = new Map(previous.selections.map((row) => [row.selection, row]));
  const currentBySelection = new Map(current.selections.map((row) => [row.selection, row]));
  const moves: N2TrifectaSelectionMarketMove[] = [];
  let totalVariation = 0;
  let js = 0;
  let shorteningSelectionCount = 0;
  let lengtheningSelectionCount = 0;
  let unchangedSelectionCount = 0;
  let massWeightedAbsoluteLogOddsMove = 0;

  for (const selection of EXPECTED_SELECTIONS) {
    const before = previousBySelection.get(selection);
    const after = currentBySelection.get(selection);
    if (!before || !after) throw new Error("TRANSITION_SELECTION_UNIVERSE_MISMATCH");
    const midpoint = (before.marketMassShare + after.marketMassShare) / 2;
    js += 0.5 * jsTerm(before.marketMassShare, midpoint)
      + 0.5 * jsTerm(after.marketMassShare, midpoint);
    totalVariation += Math.abs(after.marketMassShare - before.marketMassShare) / 2;
    const logOddsRatio = Math.log(after.odds / before.odds);
    if (logOddsRatio < -MOVE_EPSILON) shorteningSelectionCount += 1;
    else if (logOddsRatio > MOVE_EPSILON) lengtheningSelectionCount += 1;
    else unchangedSelectionCount += 1;
    massWeightedAbsoluteLogOddsMove += after.marketMassShare * Math.abs(logOddsRatio);
    moves.push({
      selection,
      previousRank: before.rank,
      currentRank: after.rank,
      rankImprovement: before.rank - after.rank,
      logOddsRatio,
      marketMassShareDelta: after.marketMassShare - before.marketMassShare,
    });
  }
  moves.sort((left, right) => selectionCompare(left.selection, right.selection));

  const absoluteMoves = moves.map((move) => Math.abs(move.logOddsRatio));
  const previousTop5 = new Set(previous.selections.slice(0, 5).map((row) => row.selection));
  const currentTop5 = new Set(current.selections.slice(0, 5).map((row) => row.selection));
  const top5RetainedCount = [...previousTop5].filter((selection) => currentTop5.has(selection)).length;
  const previousCaptured = instant(previous.capturedAt);
  const currentCaptured = instant(current.capturedAt);
  const core = {
    featureVersion: N2_TRIFECTA_MARKET_FEATURE_VERSION,
    raceIdentity: previous.raceIdentity,
    fromCheckpoint: previous.checkpointLabel,
    toCheckpoint: current.checkpointLabel,
    checkpointStepsApart: toIndex - fromIndex,
    capturedSecondsApart:
      previousCaptured != null && currentCaptured != null
        ? (currentCaptured - previousCaptured) / 1_000
        : null,
    jensenShannonDivergenceBits: js,
    totalVariationDistance: totalVariation,
    favoriteChanged: previous.favoriteSelection !== current.favoriteSelection,
    top5RetainedCount,
    top5ChurnRate: 1 - top5RetainedCount / 5,
    medianAbsoluteLogOddsMove: median(absoluteMoves),
    maxAbsoluteLogOddsMove: Math.max(...absoluteMoves),
    massWeightedAbsoluteLogOddsMove,
    shorteningSelectionCount,
    lengtheningSelectionCount,
    unchangedSelectionCount,
    moves,
    privateResearchOnly: true as const,
    publicPublishAuthorized: false as const,
    databaseWriteAuthorized: false as const,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

export function buildN2TrifectaMarketRaceFeatureSequence(
  inputs: N2TrifectaMarketSnapshotInput[],
): N2TrifectaMarketRaceFeatureSequence {
  if (inputs.length === 0) {
    const core = {
      featureVersion: N2_TRIFECTA_MARKET_FEATURE_VERSION,
      status: "NO_DATA" as const,
      blockers: [] as string[],
      raceIdentity: null,
      availableCheckpoints: [] as N2TrifectaMarketCheckpointLabel[],
      missingCheckpoints: [...N2_TRIFECTA_MARKET_CHECKPOINTS],
      snapshots: [] as N2TrifectaMarketSnapshotFeatures[],
      transitions: [] as N2TrifectaMarketTransitionFeatures[],
      privateResearchOnly: true as const,
      publicPublishAuthorized: false as const,
      databaseWriteAuthorized: false as const,
    };
    return { ...core, outputDigest: canonicalHash(core) };
  }

  const blockers: string[] = [];
  const raceIdentities = unique(inputs.map((input) => input.raceIdentity));
  if (raceIdentities.length !== 1) blockers.push("SEQUENCE_RACE_IDENTITY_MISMATCH");
  const checkpointLabels = inputs.map((input) => input.checkpointLabel);
  if (new Set(checkpointLabels).size !== checkpointLabels.length) {
    blockers.push("SEQUENCE_DUPLICATE_CHECKPOINT");
  }

  const snapshots: N2TrifectaMarketSnapshotFeatures[] = [];
  for (const input of inputs) {
    const result = buildN2TrifectaMarketSnapshotFeatures(input);
    if (result.status !== "PASS" || !result.snapshot) {
      blockers.push(...result.blockers.map((blocker) => `SNAPSHOT_${blocker}`));
    } else {
      snapshots.push(result.snapshot);
    }
  }
  snapshots.sort(
    (left, right) => checkpointIndex(left.checkpointLabel) - checkpointIndex(right.checkpointLabel),
  );
  const normalizedBlockers = unique(blockers);
  if (normalizedBlockers.length > 0) {
    const core = {
      featureVersion: N2_TRIFECTA_MARKET_FEATURE_VERSION,
      status: "BLOCKED" as const,
      blockers: normalizedBlockers,
      raceIdentity: raceIdentities.length === 1 ? raceIdentities[0] : null,
      availableCheckpoints: snapshots.map((snapshot) => snapshot.checkpointLabel),
      missingCheckpoints: N2_TRIFECTA_MARKET_CHECKPOINTS.filter(
        (label) => !snapshots.some((snapshot) => snapshot.checkpointLabel === label),
      ),
      snapshots,
      transitions: [] as N2TrifectaMarketTransitionFeatures[],
      privateResearchOnly: true as const,
      publicPublishAuthorized: false as const,
      databaseWriteAuthorized: false as const,
    };
    return { ...core, outputDigest: canonicalHash(core) };
  }

  const transitions: N2TrifectaMarketTransitionFeatures[] = [];
  for (let index = 1; index < snapshots.length; index += 1) {
    transitions.push(buildN2TrifectaMarketTransitionFeatures(snapshots[index - 1], snapshots[index]));
  }
  const availableCheckpoints = snapshots.map((snapshot) => snapshot.checkpointLabel);
  const missingCheckpoints = N2_TRIFECTA_MARKET_CHECKPOINTS.filter(
    (label) => !availableCheckpoints.includes(label),
  );
  const core = {
    featureVersion: N2_TRIFECTA_MARKET_FEATURE_VERSION,
    status: missingCheckpoints.length === 0 ? "PASS" as const : "PARTIAL" as const,
    blockers: [] as string[],
    raceIdentity: raceIdentities[0],
    availableCheckpoints,
    missingCheckpoints,
    snapshots,
    transitions,
    privateResearchOnly: true as const,
    publicPublishAuthorized: false as const,
    databaseWriteAuthorized: false as const,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}
