import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { classifyBuyCalibrationStability, type BuyCalibrationWindow } from "../src/presentation/buyCalibrationStability";
import { calculateBuyProbabilityCalibration, type BuyCalibrationMetrics, type BuyCalibrationObservation } from "../src/presentation/buyProbabilityCalibration";
import { buildBuyOutcomeSettlementSource, type BuyOutcomeSettlementSource } from "../src/presentation/buyOutcomeSettlementSource";

const args = parseArgs(process.argv.slice(2));
const dbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
if (!existsSync(dbPath)) throw new Error("BUY probability calibration source DB is unavailable");

const db = new DatabaseSync(dbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON");
db.exec("PRAGMA busy_timeout = 5000");

try {
  const source = buildBuyOutcomeSettlementSource({ runKind: args.runKind });
  assertPaperLiveSettlementConsistency(db, source);
  const rows = db.prepare(`
    ${source.cte}
    SELECT
      dh.raw_estimated_hit_rate AS raw_predicted,
      dh.conservative_hit_rate AS conservative_predicted,
      bo.estimated_hit_rate AS model_predicted,
      bo.ev,
      bo.current_odds,
      CASE WHEN bo.selection = bo.outcome_result THEN 1 ELSE 0 END AS hit
    FROM buy_outcomes bo
    JOIN ranked_buy dh
      ON dh.race_id = bo.race_id
      AND dh.bet_type = bo.bet_type
      AND dh.selection = bo.selection
      AND dh.outcome_row_num = 1
    WHERE bo.outcome_result IS NOT NULL
      AND bo.outcome_payout_yen IS NOT NULL
      AND bo.outcome_returned = 0
    ORDER BY bo.date DESC, bo.venue DESC, bo.race_no DESC, bo.race_id DESC
  `).all(...source.params) as SourceRow[];

  validateStoredProbabilityStages(rows);
  const decisionRows = rows.map(toDecisionCalibrationRow);
  const modelRows = rows.map((row) => ({ predicted: nullableNumber(row.model_predicted), hit: row.hit }));
  const recentRows = rows.slice(0, args.recent);
  const priorRows = rows.slice(args.recent, args.recent * 2);
  const recentDecisionRows = decisionRows.slice(0, args.recent);
  const priorDecisionRows = decisionRows.slice(args.recent, args.recent * 2);
  const recentModelRows = modelRows.slice(0, args.recent);
  const priorModelRows = modelRows.slice(args.recent, args.recent * 2);
  const highEvIndexes = rows.flatMap((row, index) => isHighEv(row.ev, args.highEvThreshold) ? [index] : []);

  const overall = scope(decisionRows, args.minimumTrials);
  const recent = scope(recentDecisionRows, args.minimumTrials);
  const prior = scope(priorDecisionRows, args.minimumTrials);
  const highEv = scope(highEvIndexes.map((index) => decisionRows[index]), args.minimumTrials);
  const stability = classifyBuyCalibrationStability({
    totalSettled: rows.length,
    windowSize: args.recent,
    minimumEligible: args.minimumTrials,
    recent: calibrationWindow(recent),
    prior: calibrationWindow(prior),
  });
  const preCalibration = {
    overall: scope(modelRows, args.minimumTrials),
    recent: scope(recentModelRows, args.minimumTrials),
    prior: scope(priorModelRows, args.minimumTrials),
    highEv: scope(highEvIndexes.map((index) => modelRows[index]), args.minimumTrials),
  };
  const probabilityPipeline = {
    overall: buildProbabilityPipeline(rows),
    recent: buildProbabilityPipeline(recentRows),
    prior: buildProbabilityPipeline(priorRows),
  };

  const report = {
    schemaVersion: "buy-probability-calibration-public-v4" as const,
    generatedAt: new Date().toISOString(),
    status: overall.status,
    probabilityBasis: "decision_effective_probability_reconstructed_from_stored_ev_and_decision_odds" as const,
    preCalibrationBasis: "stored_model_estimate_before_decision_empirical_calibration" as const,
    minimumTrials: args.minimumTrials,
    materialBiasThreshold: 0.05,
    highEvThreshold: args.highEvThreshold,
    overall,
    recent,
    prior,
    highEv,
    stability,
    preCalibration,
    probabilityPipeline,
    note: "Primary calibration uses the effective probability that actually produced the stored BUY EV. The probability pipeline shows aggregate raw-model, conservative-model, feature-adjusted, and decision-effective stages from the same settled BUY cohort. Official settled outcomes only; descriptive diagnostics cannot change production BUY conditions.",
    productionChangeAllowed: false as const,
  };

  const serialized = JSON.stringify(report);
  for (const forbidden of ["selection", "currentOdds", "requiredOdds", "recommendedAmount", "stake", "raceId", "decisionId", "segmentKey", "venue", "/Users/", "/home/"]) {
    if (serialized.toLowerCase().includes(forbidden.toLowerCase())) throw new Error(`private BUY field reached probability calibration report: ${forbidden}`);
  }
  await atomicWrite(args.output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    status: report.status,
    probabilityBasis: report.probabilityBasis,
    overall: report.overall,
    recent: report.recent,
    prior: report.prior,
    highEv: report.highEv,
    stability: report.stability,
    preCalibration: report.preCalibration,
    probabilityPipeline: report.probabilityPipeline,
    productionChangeAllowed: false,
  }));
} finally {
  db.close();
}

type SourceRow = {
  raw_predicted: number | null;
  conservative_predicted: number | null;
  model_predicted: number | null;
  ev: number | null;
  current_odds: number | null;
  hit: number | bigint;
};

type CalibrationRow = { predicted: number | null; hit: number | bigint };

type ScopeResult = {
  status: "AVAILABLE" | "INSUFFICIENT_SUPPORT";
  settled: number;
  probabilityEligible: number;
  missingProbability: number;
  probabilityCoverage: number | null;
  minimumTrials: number;
  missingEligibleToEvaluate: number;
  metrics: BuyCalibrationMetrics | null;
};

type PipelineStageKey = "rawModel" | "conservativeModel" | "featureAdjusted" | "decisionEffective";
type PipelineValueRow = Record<PipelineStageKey, number | null> & { hit: 0 | 1 };

function toDecisionCalibrationRow(row: SourceRow): CalibrationRow {
  if (row.ev === null || row.current_odds === null) return { predicted: null, hit: row.hit };
  const ev = Number(row.ev);
  const odds = Number(row.current_odds);
  if (!Number.isFinite(ev) || !Number.isFinite(odds) || odds <= 0) {
    throw new Error("settled BUY decision-effective probability basis is invalid");
  }
  const predicted = ev / odds;
  if (!Number.isFinite(predicted) || predicted < 0 || predicted > 1) {
    throw new Error("settled BUY decision-effective hit rate outside [0,1]");
  }
  return { predicted, hit: row.hit };
}

function scope(rows: CalibrationRow[], minimumTrials: number): ScopeResult {
  const settled = rows.length;
  const observations: BuyCalibrationObservation[] = rows.flatMap((row) => {
    if (row.predicted === null) return [];
    const predicted = Number(row.predicted);
    const hit = Number(row.hit);
    if (!Number.isFinite(predicted) || predicted < 0 || predicted > 1) throw new Error("BUY predicted hit rate must be within [0,1]");
    if (hit !== 0 && hit !== 1) throw new Error("BUY calibration outcome must be binary");
    return [{ predicted, hit: hit as 0 | 1 }];
  });
  const probabilityEligible = observations.length;
  const missingProbability = settled - probabilityEligible;
  const probabilityCoverage = settled > 0 ? round4(probabilityEligible / settled) : null;
  const missingEligibleToEvaluate = Math.max(0, minimumTrials - probabilityEligible);
  return {
    status: probabilityEligible >= minimumTrials ? "AVAILABLE" : "INSUFFICIENT_SUPPORT",
    settled,
    probabilityEligible,
    missingProbability,
    probabilityCoverage,
    minimumTrials,
    missingEligibleToEvaluate,
    metrics: probabilityEligible >= minimumTrials ? calculateBuyProbabilityCalibration(observations) : null,
  };
}

function buildProbabilityPipeline(rows: SourceRow[]) {
  const values: PipelineValueRow[] = rows.map((row) => {
    const hit = Number(row.hit);
    if (hit !== 0 && hit !== 1) throw new Error("BUY probability pipeline outcome must be binary");
    return {
      rawModel: nullableNumber(row.raw_predicted),
      conservativeModel: nullableNumber(row.conservative_predicted),
      featureAdjusted: nullableNumber(row.model_predicted),
      decisionEffective: nullableNumber(toDecisionCalibrationRow(row).predicted),
      hit: hit as 0 | 1,
    };
  });
  const observedHits = values.reduce((sum, row) => sum + row.hit, 0);
  const settled = values.length;
  return {
    settled,
    observedHits,
    observedHitRate: settled > 0 ? round4(observedHits / settled) : null,
    stages: {
      rawModel: pipelineStage(values, "rawModel"),
      conservativeModel: pipelineStage(values, "conservativeModel"),
      featureAdjusted: pipelineStage(values, "featureAdjusted"),
      decisionEffective: pipelineStage(values, "decisionEffective"),
    },
    transitions: {
      rawToConservative: pipelineTransition(values, "rawModel", "conservativeModel"),
      conservativeToFeatureAdjusted: pipelineTransition(values, "conservativeModel", "featureAdjusted"),
      featureAdjustedToDecisionEffective: pipelineTransition(values, "featureAdjusted", "decisionEffective"),
    },
  };
}

function pipelineStage(rows: PipelineValueRow[], key: PipelineStageKey) {
  const values = rows.flatMap((row) => row[key] === null ? [] : [row[key] as number]);
  const eligible = values.length;
  const settled = rows.length;
  const averageProbability = eligible > 0 ? mean(values) : null;
  return {
    eligible,
    missing: settled - eligible,
    coverage: settled > 0 ? round4(eligible / settled) : null,
    averageProbability: averageProbability === null ? null : round4(averageProbability),
    expectedHits: averageProbability === null ? null : round4(averageProbability * eligible),
  };
}

function pipelineTransition(rows: PipelineValueRow[], from: PipelineStageKey, to: PipelineStageKey) {
  const pairs = rows.flatMap((row) => row[from] === null || row[to] === null ? [] : [[row[from] as number, row[to] as number] as const]);
  if (!pairs.length) return { paired: 0, fromAverage: null, toAverage: null, delta: null, retentionRatio: null };
  const fromAverage = mean(pairs.map(([value]) => value));
  const toAverage = mean(pairs.map(([, value]) => value));
  return {
    paired: pairs.length,
    fromAverage: round4(fromAverage),
    toAverage: round4(toAverage),
    delta: round4(toAverage - fromAverage),
    retentionRatio: fromAverage > 0 ? round4(toAverage / fromAverage) : null,
  };
}

function validateStoredProbabilityStages(rows: SourceRow[]) {
  for (const row of rows) {
    validateNullableProbability(row.raw_predicted, "raw_estimated_hit_rate");
    validateNullableProbability(row.conservative_predicted, "conservative_hit_rate");
    validateNullableProbability(row.model_predicted, "estimated_hit_rate");
  }
}

function validateNullableProbability(value: number | null, label: string) {
  if (value === null) return;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`settled BUY contains ${label} outside [0,1]`);
}

function calibrationWindow(scopeResult: ScopeResult): BuyCalibrationWindow {
  return {
    settled: scopeResult.settled,
    probabilityEligible: scopeResult.probabilityEligible,
    missingProbability: scopeResult.missingProbability,
    metrics: scopeResult.metrics,
  };
}

function assertPaperLiveSettlementConsistency(db: DatabaseSync, source: BuyOutcomeSettlementSource) {
  if (!source.usesOfficialRaceResults) return;
  const row = db.prepare(`
    ${source.cte}
    SELECT COUNT(*) AS mismatches
    FROM buy_outcomes
    WHERE decision_result IS NOT NULL
      AND outcome_result IS NOT NULL
      AND decision_result != outcome_result
  `).get(...source.params) as { mismatches: number | bigint | null };
  if (count(row.mismatches) > 0) throw new Error("paper-live settlement result conflicts with official race_results");
}

function parseArgs(argv: string[]) {
  const parsed = {
    runKind: null as string | null,
    recent: 30,
    minimumTrials: 30,
    highEvThreshold: 1.2,
    output: null as string | null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]; const value = argv[i + 1];
    if (key === "--run-kind") { parsed.runKind = safeArg(value); i += 1; }
    else if (key === "--recent") { parsed.recent = boundedInt(value, 10, 200); i += 1; }
    else if (key === "--minimum-trials") { parsed.minimumTrials = boundedInt(value, 20, 500); i += 1; }
    else if (key === "--high-ev-threshold") { parsed.highEvThreshold = boundedNumber(value, 1, 10); i += 1; }
    else if (key === "--output") { parsed.output = safeJson(value); i += 1; }
    else if (key === "--") { /* npm separator */ }
    else throw new Error(`unknown option: ${key}`);
  }
  if (parsed.runKind !== "paper-live") throw new Error("Owner BUY probability calibration must stay scoped to paper-live");
  if (parsed.minimumTrials > parsed.recent) throw new Error("minimum-trials cannot exceed recent window size");
  if (!parsed.output) throw new Error("output is required");
  return parsed as { runKind: "paper-live"; recent: number; minimumTrials: number; highEvThreshold: number; output: string };
}

function nullableNumber(value: number | null): number | null { return value === null ? null : Number(value); }
function isHighEv(value: number | null, threshold: number): boolean { return value !== null && Number.isFinite(Number(value)) && Number(value) >= threshold; }
function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function safeArg(value: string | undefined) { if (!value || !/^[A-Za-z0-9_.-]{1,80}$/.test(value)) throw new Error("invalid filter"); return value; }
function safeJson(value: string | undefined) { if (!value || value.startsWith("/") || value.includes("..") || !/^[A-Za-z0-9_./-]+\.json$/.test(value)) throw new Error("path must be a relative json file"); return value; }
function boundedInt(value: string | undefined, min: number, max: number) { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) throw new Error("invalid integer option"); return n; }
function boundedNumber(value: string | undefined, min: number, max: number) { const n = Number(value); if (!Number.isFinite(n) || n < min || n > max) throw new Error("invalid numeric option"); return n; }
function count(value: number | bigint | null) { const n = Number(value ?? 0); return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0; }
function round4(value: number): number { return Math.round(value * 10000) / 10000; }
async function atomicWrite(path: string, contents: string) { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.tmp-${process.pid}`; await writeFile(temp, contents, { encoding: "utf8", mode: 0o600 }); await rename(temp, path); }
