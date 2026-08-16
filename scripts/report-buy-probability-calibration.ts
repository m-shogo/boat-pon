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
  const settledEconomic = "outcome_result IS NOT NULL AND outcome_payout_yen IS NOT NULL AND outcome_returned = 0";
  const invalidModel = db.prepare(`
    ${source.cte}
    SELECT COUNT(*) AS invalid
    FROM buy_outcomes
    WHERE ${settledEconomic}
      AND estimated_hit_rate IS NOT NULL
      AND (estimated_hit_rate < 0 OR estimated_hit_rate > 1)
  `).get(...source.params) as { invalid: number | bigint | null };
  if (count(invalidModel.invalid) > 0) throw new Error("settled BUY contains estimated_hit_rate outside [0,1]");

  const rows = db.prepare(`
    ${source.cte}
    SELECT
      estimated_hit_rate AS model_predicted,
      ev,
      current_odds,
      CASE WHEN selection = outcome_result THEN 1 ELSE 0 END AS hit
    FROM buy_outcomes
    WHERE ${settledEconomic}
    ORDER BY date DESC, venue DESC, race_no DESC, race_id DESC
  `).all(...source.params) as SourceRow[];

  const decisionRows = rows.map(toDecisionCalibrationRow);
  const modelRows = rows.map((row) => ({ predicted: nullableNumber(row.model_predicted), hit: row.hit }));
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

  const report = {
    schemaVersion: "buy-probability-calibration-public-v3" as const,
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
    note: "Primary calibration uses the effective probability that actually produced the stored BUY EV, reconstructed from stored EV divided by decision-time odds. The stored model estimate is retained separately as pre-calibration context. Official settled outcomes only; descriptive diagnostics cannot change production BUY conditions.",
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
    productionChangeAllowed: false,
  }));
} finally {
  db.close();
}

type SourceRow = {
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
function safeArg(value: string | undefined) { if (!value || !/^[A-Za-z0-9_.-]{1,80}$/.test(value)) throw new Error("invalid filter"); return value; }
function safeJson(value: string | undefined) { if (!value || value.startsWith("/") || value.includes("..") || !/^[A-Za-z0-9_./-]+\.json$/.test(value)) throw new Error("path must be a relative json file"); return value; }
function boundedInt(value: string | undefined, min: number, max: number) { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) throw new Error("invalid integer option"); return n; }
function boundedNumber(value: string | undefined, min: number, max: number) { const n = Number(value); if (!Number.isFinite(n) || n < min || n > max) throw new Error("invalid numeric option"); return n; }
function count(value: number | bigint | null) { const n = Number(value ?? 0); return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0; }
function round4(value: number): number { return Math.round(value * 10000) / 10000; }
async function atomicWrite(path: string, contents: string) { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.tmp-${process.pid}`; await writeFile(temp, contents, { encoding: "utf8", mode: 0o600 }); await rename(temp, path); }
