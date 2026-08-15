import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { classifyBuyCalibrationStability, type BuyCalibrationWindow } from "../src/presentation/buyCalibrationStability";
import { calculateBuyProbabilityCalibration, type BuyCalibrationObservation } from "../src/presentation/buyProbabilityCalibration";
import { buildBuyOutcomeSettlementSource, type BuyOutcomeSettlementSource } from "../src/presentation/buyOutcomeSettlementSource";

const args = parseArgs(process.argv.slice(2));
const dbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
if (!existsSync(dbPath)) throw new Error("BUY calibration stability source DB is unavailable");

const db = new DatabaseSync(dbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON");
db.exec("PRAGMA busy_timeout = 5000");

try {
  const source = buildBuyOutcomeSettlementSource({ runKind: args.runKind });
  assertPaperLiveSettlementConsistency(db, source);
  const settledEconomic = "outcome_result IS NOT NULL AND outcome_payout_yen IS NOT NULL AND outcome_returned = 0";
  const rows = db.prepare(`
    ${source.cte}
    SELECT
      estimated_hit_rate AS predicted,
      CASE WHEN selection = outcome_result THEN 1 ELSE 0 END AS hit
    FROM buy_outcomes
    WHERE ${settledEconomic}
    ORDER BY date DESC, venue DESC, race_no DESC, race_id DESC
  `).all(...source.params) as Array<{ predicted: number | null; hit: number | bigint }>;

  for (const row of rows) {
    if (row.predicted !== null && (!Number.isFinite(Number(row.predicted)) || Number(row.predicted) < 0 || Number(row.predicted) > 1)) {
      throw new Error("settled BUY contains estimated_hit_rate outside [0,1]");
    }
  }

  const recent = buildWindow(rows.slice(0, args.windowSize), args.minimumEligible);
  const prior = buildWindow(rows.slice(args.windowSize, args.windowSize * 2), args.minimumEligible);
  const stability = classifyBuyCalibrationStability({
    totalSettled: rows.length,
    windowSize: args.windowSize,
    minimumEligible: args.minimumEligible,
    recent,
    prior,
  });
  const report = {
    schemaVersion: "buy-calibration-stability-public-v1" as const,
    generatedAt: new Date().toISOString(),
    ...stability,
    minimumEligiblePerWindow: args.minimumEligible,
    materialBiasThreshold: 0.05,
    note: "Calibration stability requires two non-overlapping settled windows. It is descriptive and cannot change production BUY conditions.",
  };
  const serialized = JSON.stringify(report);
  for (const forbidden of ["selection", "currentOdds", "requiredOdds", "recommendedAmount", "stake", "raceId", "decisionId", "segmentKey", "venue", "/Users/", "/home/"]) {
    if (serialized.toLowerCase().includes(forbidden.toLowerCase())) throw new Error(`private BUY field reached calibration stability report: ${forbidden}`);
  }
  await atomicWrite(args.output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    status: report.status,
    totalSettled: report.totalSettled,
    requiredSettled: report.requiredSettled,
    missingSettledToCompare: report.missingSettledToCompare,
    recent: report.recent,
    prior: report.prior,
    productionChangeAllowed: false,
  }));
} finally {
  db.close();
}

function buildWindow(rows: Array<{ predicted: number | null; hit: number | bigint }>, minimumEligible: number): BuyCalibrationWindow {
  const observations: BuyCalibrationObservation[] = rows.flatMap((row) => {
    if (row.predicted === null) return [];
    const predicted = Number(row.predicted);
    const hit = Number(row.hit);
    if (!Number.isFinite(predicted) || predicted < 0 || predicted > 1) throw new Error("BUY predicted hit rate must be within [0,1]");
    if (hit !== 0 && hit !== 1) throw new Error("BUY calibration outcome must be binary");
    return [{ predicted, hit: hit as 0 | 1 }];
  });
  return {
    settled: rows.length,
    probabilityEligible: observations.length,
    missingProbability: rows.length - observations.length,
    metrics: observations.length >= minimumEligible ? calculateBuyProbabilityCalibration(observations) : null,
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
  const parsed = { runKind: null as string | null, windowSize: 30, minimumEligible: 30, output: null as string | null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]; const value = argv[i + 1];
    if (key === "--run-kind") { parsed.runKind = safeArg(value); i += 1; }
    else if (key === "--window-size") { parsed.windowSize = boundedInt(value, 10, 200); i += 1; }
    else if (key === "--minimum-eligible") { parsed.minimumEligible = boundedInt(value, 10, 200); i += 1; }
    else if (key === "--output") { parsed.output = safeJson(value); i += 1; }
    else if (key === "--") { /* npm separator */ }
    else throw new Error(`unknown option: ${key}`);
  }
  if (parsed.runKind !== "paper-live") throw new Error("Owner BUY calibration stability must stay scoped to paper-live");
  if (parsed.minimumEligible > parsed.windowSize) throw new Error("minimum-eligible cannot exceed window-size");
  if (!parsed.output) throw new Error("output is required");
  return parsed as { runKind: "paper-live"; windowSize: number; minimumEligible: number; output: string };
}
function safeArg(value: string | undefined) { if (!value || !/^[A-Za-z0-9_.-]{1,80}$/.test(value)) throw new Error("invalid filter"); return value; }
function safeJson(value: string | undefined) { if (!value || value.startsWith("/") || value.includes("..") || !/^[A-Za-z0-9_./-]+\.json$/.test(value)) throw new Error("path must be a relative json file"); return value; }
function boundedInt(value: string | undefined, min: number, max: number) { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) throw new Error("invalid integer option"); return n; }
function count(value: number | bigint | null) { const n = Number(value ?? 0); return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0; }
async function atomicWrite(path: string, contents: string) { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.tmp-${process.pid}`; await writeFile(temp, contents, { encoding: "utf8", mode: 0o600 }); await rename(temp, path); }
