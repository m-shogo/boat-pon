import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { bootstrapRoi95, type BuyRoiBootstrapInterval } from "../src/presentation/buyRoiBootstrap";
import { buildBuyOutcomeSettlementSource, type BuyOutcomeSettlementSource } from "../src/presentation/buyOutcomeSettlementSource";

const args = parseArgs(process.argv.slice(2));
const dbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
if (!existsSync(dbPath)) throw new Error("BUY ROI uncertainty source DB is unavailable");

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
      CASE WHEN selection = outcome_result THEN outcome_payout_yen / 100.0 ELSE 0 END AS payout
    FROM buy_outcomes
    WHERE ${settledEconomic}
    ORDER BY date DESC, venue DESC, race_no DESC, race_id DESC
  `).all(...source.params) as Array<{ payout: number | null }>;

  const payouts = rows.map((row) => finiteNonNegative(row.payout));
  const recent = payouts.slice(0, args.recent);
  const generatedAt = new Date().toISOString();
  const report = {
    schemaVersion: "buy-roi-uncertainty-public-v1" as const,
    generatedAt,
    status: payouts.length >= args.minimumTrials ? "AVAILABLE" as const : "INSUFFICIENT_SUPPORT" as const,
    minimumTrials: args.minimumTrials,
    performance: scope(payouts, args.minimumTrials, args.iterations),
    recent: scope(recent, args.minimumTrials, args.iterations),
    note: "95% deterministic percentile bootstrap describes uncertainty in observed unit-stake realized ROI. It is descriptive, tail-sensitive, and does not justify production BUY changes.",
    productionChangeAllowed: false as const,
  };

  const serialized = JSON.stringify(report);
  for (const forbidden of ["selection", "currentOdds", "requiredOdds", "recommendedAmount", "stake", "raceId", "decisionId", "segmentKey", "/Users/", "/home/"]) {
    if (serialized.toLowerCase().includes(forbidden.toLowerCase())) throw new Error(`private BUY field reached ROI uncertainty report: ${forbidden}`);
  }
  await atomicWrite(args.output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    status: report.status,
    performance: report.performance,
    recent: report.recent,
    productionChangeAllowed: false,
  }));
} finally {
  db.close();
}

type Scope = {
  status: "AVAILABLE" | "INSUFFICIENT_SUPPORT";
  trials: number;
  minimumTrials: number;
  missingTrials: number;
  interval: BuyRoiBootstrapInterval | null;
};

function scope(values: number[], minimumTrials: number, iterations: number): Scope {
  if (values.length < minimumTrials) {
    return {
      status: "INSUFFICIENT_SUPPORT",
      trials: values.length,
      minimumTrials,
      missingTrials: minimumTrials - values.length,
      interval: null,
    };
  }
  return {
    status: "AVAILABLE",
    trials: values.length,
    minimumTrials,
    missingTrials: 0,
    interval: bootstrapRoi95(values, iterations),
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
    iterations: 5000,
    output: null as string | null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]; const value = argv[i + 1];
    if (key === "--run-kind") { parsed.runKind = safeArg(value); i += 1; }
    else if (key === "--recent") { parsed.recent = boundedInt(value, 10, 200); i += 1; }
    else if (key === "--minimum-trials") { parsed.minimumTrials = boundedInt(value, 20, 500); i += 1; }
    else if (key === "--iterations") { parsed.iterations = boundedInt(value, 1000, 50000); i += 1; }
    else if (key === "--output") { parsed.output = safeJson(value); i += 1; }
    else if (key === "--") { /* npm separator */ }
    else throw new Error(`unknown option: ${key}`);
  }
  if (parsed.runKind !== "paper-live") throw new Error("Owner BUY ROI uncertainty must stay scoped to paper-live");
  if (!parsed.output) throw new Error("output is required");
  return parsed as { runKind: "paper-live"; recent: number; minimumTrials: number; iterations: number; output: string };
}

function safeArg(value: string | undefined) {
  if (!value || !/^[A-Za-z0-9_.-]{1,80}$/.test(value)) throw new Error("invalid filter");
  return value;
}
function boundedInt(value: string | undefined, min: number, max: number) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error("invalid integer option");
  return n;
}
function safeJson(value: string | undefined) {
  if (!value || value.startsWith("/") || value.includes("..") || !/^[A-Za-z0-9_./-]+\.json$/.test(value)) throw new Error("path must be a relative json file");
  return value;
}
function count(value: number | bigint | null) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}
function finiteNonNegative(value: number | null) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new Error("invalid realized BUY payout");
  return n;
}
async function atomicWrite(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, contents, { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
}
