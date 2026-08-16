import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { bootstrapRoi95, type BuyRoiBootstrapInterval } from "../src/presentation/buyRoiBootstrap";
import { buildBuyOutcomeSettlementSource, type BuyOutcomeSettlementSource } from "../src/presentation/buyOutcomeSettlementSource";

const MINIMUM_PRICE_HITS = 5;

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
      CASE WHEN selection = outcome_result THEN outcome_payout_yen / 100.0 ELSE 0 END AS payout,
      ev AS stored_ev,
      current_odds AS decision_price_proxy,
      CASE WHEN selection = outcome_result THEN 1 ELSE 0 END AS hit
    FROM buy_outcomes
    WHERE ${settledEconomic}
    ORDER BY date DESC, venue DESC, race_no DESC, race_id DESC
  `).all(...source.params) as SourceRow[];

  const normalized = rows.map(normalizeRow);
  const payouts = normalized.map((row) => row.payout);
  const recentRows = normalized.slice(0, args.recent);
  const recentPayouts = recentRows.map((row) => row.payout);
  const performance = scope(payouts, args.minimumTrials, args.iterations);
  const recent = scope(recentPayouts, args.minimumTrials, args.iterations);
  const generatedAt = new Date().toISOString();
  const report = {
    schemaVersion: "buy-roi-uncertainty-public-v1" as const,
    generatedAt,
    status: payouts.length >= args.minimumTrials ? "AVAILABLE" as const : "INSUFFICIENT_SUPPORT" as const,
    minimumTrials: args.minimumTrials,
    performance,
    recent,
    expectationRealization: {
      performance: expectationScope(normalized, performance, args.minimumTrials),
      recent: expectationScope(recentRows, recent, args.minimumTrials),
    },
    priceRealization: {
      minimumHits: MINIMUM_PRICE_HITS,
      performance: priceScope(normalized, MINIMUM_PRICE_HITS),
      recent: priceScope(recentRows, MINIMUM_PRICE_HITS),
    },
    note: "95% deterministic percentile bootstrap describes uncertainty in observed 100-yen normalized realized ROI. Stored EV is compared only as an aggregate decision-time benchmark. Price realization remains hidden until at least five hit observations are available, preventing disclosure from tiny hit cohorts. These diagnostics are descriptive, tail-sensitive, and cannot change production BUY conditions.",
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
    expectationRealization: report.expectationRealization,
    priceRealization: report.priceRealization,
    productionChangeAllowed: false,
  }));
} finally {
  db.close();
}

type SourceRow = {
  payout: number | null;
  stored_ev: number | null;
  decision_price_proxy: number | null;
  hit: number | bigint;
};

type NormalizedRow = {
  payout: number;
  storedEv: number | null;
  decisionPriceProxy: number | null;
  hit: 0 | 1;
};

type Scope = {
  status: "AVAILABLE" | "INSUFFICIENT_SUPPORT";
  trials: number;
  minimumTrials: number;
  missingTrials: number;
  interval: BuyRoiBootstrapInterval | null;
};

type ExpectationClassification = "BELOW_EXPECTED" | "CROSSES_EXPECTED" | "ABOVE_EXPECTED";

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

function expectationScope(rows: NormalizedRow[], roiScope: Scope, minimumTrials: number) {
  const storedEvs = rows.flatMap((row) => row.storedEv === null ? [] : [row.storedEv]);
  const eligible = storedEvs.length;
  const missing = rows.length - eligible;
  const fullCoverage = eligible === rows.length;
  if (!fullCoverage || eligible < minimumTrials || roiScope.interval === null) {
    return {
      status: "INSUFFICIENT_SUPPORT" as const,
      trials: rows.length,
      expectedEvEligible: eligible,
      missingExpectedEv: missing,
      minimumTrials,
      averageStoredEv: null,
      realizedRoi: roiScope.interval?.pointEstimate ?? null,
      realizedToExpectedRatio: null,
      classification: null,
    };
  }
  const averageStoredEv = round4(mean(storedEvs));
  const interval = roiScope.interval;
  const classification: ExpectationClassification = interval.upper < averageStoredEv
    ? "BELOW_EXPECTED"
    : interval.lower > averageStoredEv
      ? "ABOVE_EXPECTED"
      : "CROSSES_EXPECTED";
  return {
    status: "AVAILABLE" as const,
    trials: rows.length,
    expectedEvEligible: eligible,
    missingExpectedEv: 0,
    minimumTrials,
    averageStoredEv,
    realizedRoi: interval.pointEstimate,
    realizedToExpectedRatio: averageStoredEv > 0 ? round4(interval.pointEstimate / averageStoredEv) : null,
    classification,
  };
}

function priceScope(rows: NormalizedRow[], minimumHits: number) {
  const hits = rows.filter((row) => row.hit === 1);
  const pairs = hits.flatMap((row) => {
    if (row.decisionPriceProxy === null) return [];
    if (row.payout <= 0) throw new Error("hit BUY must have a positive realized payout multiple");
    return [{ decision: row.decisionPriceProxy, realized: row.payout }];
  });
  const eligibleHits = pairs.length;
  const missingHits = Math.max(0, minimumHits - eligibleHits);
  if (eligibleHits < minimumHits) {
    return {
      status: "INSUFFICIENT_HIT_SUPPORT" as const,
      hits: hits.length,
      priceEligibleHits: eligibleHits,
      minimumHits,
      missingHits,
      averageDecisionPriceProxy: null,
      averageRealizedPriceProxy: null,
      realizedToDecisionRatio: null,
      averagePriceGap: null,
    };
  }
  const averageDecisionPriceProxy = round4(mean(pairs.map((pair) => pair.decision)));
  const averageRealizedPriceProxy = round4(mean(pairs.map((pair) => pair.realized)));
  return {
    status: "AVAILABLE" as const,
    hits: hits.length,
    priceEligibleHits: eligibleHits,
    minimumHits,
    missingHits: 0,
    averageDecisionPriceProxy,
    averageRealizedPriceProxy,
    realizedToDecisionRatio: averageDecisionPriceProxy > 0 ? round4(averageRealizedPriceProxy / averageDecisionPriceProxy) : null,
    averagePriceGap: round4(averageRealizedPriceProxy - averageDecisionPriceProxy),
  };
}

function normalizeRow(row: SourceRow): NormalizedRow {
  const hit = Number(row.hit);
  if (hit !== 0 && hit !== 1) throw new Error("BUY ROI hit flag must be binary");
  return {
    payout: finiteNonNegative(row.payout),
    storedEv: nullableNonNegative(row.stored_ev, "stored BUY EV"),
    decisionPriceProxy: nullablePositive(row.decision_price_proxy, "decision price proxy"),
    hit: hit as 0 | 1,
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
function nullableNonNegative(value: number | null, label: string): number | null {
  if (value === null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid ${label}`);
  return n;
}
function nullablePositive(value: number | null, label: string): number | null {
  if (value === null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid ${label}`);
  return n;
}
function mean(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function round4(value: number): number { return Math.round(value * 10000) / 10000; }
async function atomicWrite(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, contents, { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
}
