import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mineBuyOutcomePatterns, type BuyOutcomeSegment } from "../src/presentation/buyOutcomePatternMiner";
import { replicateBuyOutcomePatterns } from "../src/presentation/buyPatternReplication";
import { buildBuyOutcomeSettlementSource, type BuyOutcomeSettlementSource } from "../src/presentation/buyOutcomeSettlementSource";

const args = parseArgs(process.argv.slice(2));
const dbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
if (!existsSync(dbPath)) throw new Error("BUY pattern replication source DB is unavailable");

const db = new DatabaseSync(dbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON");
db.exec("PRAGMA busy_timeout = 5000");

try {
  const source = buildBuyOutcomeSettlementSource({ runKind: args.runKind });
  assertPaperLiveSettlementConsistency(db, source);
  const settledEconomic = "outcome_result IS NOT NULL AND outcome_payout_yen IS NOT NULL AND outcome_returned = 0";
  assertDecisionEffectiveProbabilityConsistency(db, source, settledEconomic);
  const totalRow = db.prepare(`
    ${source.cte}
    SELECT COUNT(*) AS settled FROM buy_outcomes WHERE ${settledEconomic}
  `).get(...source.params) as { settled: number | bigint | null };
  const totalSettled = count(totalRow.settled);
  const requiredSettled = args.windowSize * 2;

  const prior = totalSettled >= requiredSettled
    ? queryWindow(db, source, settledEconomic, args.windowSize, args.windowSize, args)
    : emptyWindow();
  const recent = totalSettled >= requiredSettled
    ? queryWindow(db, source, settledEconomic, 0, args.windowSize, args)
    : emptyWindow();

  const replication = replicateBuyOutcomePatterns({
    totalSettled,
    windowSize: args.windowSize,
    discovery: prior.patterns,
    confirmation: recent.patterns,
  });
  const generatedAt = new Date().toISOString();
  const privateRecord = {
    schemaVersion: "buy-pattern-replication.0.1",
    generatedAt,
    policy: {
      runKind: args.runKind,
      windowSize: args.windowSize,
      minimumSettledPerSide: args.minSettled,
      minimumAbsoluteRoiDelta: args.minRoiDelta,
      independentNonOverlappingWindows: true,
      confidenceBandProbabilityBasis: "decision-effective-probability-reconstructed-from-stored-ev-and-decision-odds",
      productionChangeAllowed: false,
    },
    totalSettled,
    prior,
    recent,
    replication,
  };
  const publicRecord = {
    schemaVersion: "buy-pattern-replication-public-v1" as const,
    generatedAt,
    status: replication.status,
    totalSettled,
    windowSize: args.windowSize,
    requiredSettled: replication.requiredSettled,
    missingSettledToCompare: replication.missingSettledToCompare,
    discoveryPatternCount: replication.discoveryPatternCount,
    confirmationPatternCount: replication.confirmationPatternCount,
    replicatedPatternCount: replication.replicatedPatternCount,
    signals: replication.signals,
    productionChangeAllowed: false as const,
  };

  const serialized = JSON.stringify(publicRecord);
  for (const forbidden of ["segmentKey", "selection", "currentOdds", "requiredOdds", "recommendedAmount", "stake", "raceId", "decisionId", "/Users/", "/home/"]) {
    if (serialized.toLowerCase().includes(forbidden.toLowerCase())) throw new Error(`private BUY field reached replication report: ${forbidden}`);
  }
  await atomicWrite(args.outputPublic, `${JSON.stringify(publicRecord, null, 2)}\n`);
  const retained = args.retainPrivateDir ? await retain(args.retainPrivateDir, privateRecord) : false;
  console.log(JSON.stringify({
    status: publicRecord.status,
    totalSettled,
    windowSize: publicRecord.windowSize,
    requiredSettled: publicRecord.requiredSettled,
    missingSettledToCompare: publicRecord.missingSettledToCompare,
    discoveryPatternCount: publicRecord.discoveryPatternCount,
    confirmationPatternCount: publicRecord.confirmationPatternCount,
    replicatedPatternCount: publicRecord.replicatedPatternCount,
    publicSignalCount: publicRecord.signals.length,
    retained,
    productionChangeAllowed: false,
  }));
} finally {
  db.close();
}

type WindowResult = {
  baseline: { settled: number; payoutOddsSum: number };
  segments: BuyOutcomeSegment[];
  patterns: ReturnType<typeof mineBuyOutcomePatterns>;
};

type Args = {
  runKind: "paper-live";
  windowSize: number;
  minSettled: number;
  minRoiDelta: number;
  outputPublic: string;
  retainPrivateDir: string | null;
};

function queryWindow(
  db: DatabaseSync,
  source: BuyOutcomeSettlementSource,
  settledEconomic: string,
  offset: number,
  limit: number,
  args: Args,
): WindowResult {
  const cte = windowCte(source, settledEconomic);
  const params = [...source.params, offset, offset + limit];
  const baselineRaw = db.prepare(`
    ${cte}
    SELECT COUNT(*) AS settled, COALESCE(SUM(payout), 0) AS payoutOddsSum FROM window_buy
  `).get(...params) as { settled: number | bigint | null; payoutOddsSum: number | null };
  const raw = db.prepare(`
    ${cte}, segments AS (
      SELECT 'venue' AS dimension, COALESCE(NULLIF(venue,''), 'UNKNOWN') AS segmentKey, hit, payout FROM window_buy
      UNION ALL
      SELECT 'modelVersion', COALESCE(NULLIF(model_version,''), 'UNKNOWN'), hit, payout FROM window_buy
      UNION ALL
      SELECT 'confidenceBand', CASE
        WHEN decision_effective_hit_rate IS NULL THEN 'UNKNOWN'
        WHEN decision_effective_hit_rate < 0.20 THEN '<0.20'
        WHEN decision_effective_hit_rate < 0.35 THEN '0.20-0.35'
        WHEN decision_effective_hit_rate < 0.50 THEN '0.35-0.50'
        ELSE '>=0.50' END, hit, payout FROM window_buy
      UNION ALL
      SELECT 'evBand', CASE
        WHEN ev IS NULL THEN 'UNKNOWN'
        WHEN ev < 1.00 THEN '<1.00'
        WHEN ev < 1.10 THEN '1.00-1.10'
        WHEN ev < 1.20 THEN '1.10-1.20'
        ELSE '>=1.20' END, hit, payout FROM window_buy
      UNION ALL
      SELECT 'oddsBand', CASE
        WHEN current_odds IS NULL THEN 'UNKNOWN'
        WHEN current_odds < 5 THEN '<5'
        WHEN current_odds < 10 THEN '5-10'
        WHEN current_odds < 20 THEN '10-20'
        WHEN current_odds < 40 THEN '20-40'
        ELSE '>=40' END, hit, payout FROM window_buy
      UNION ALL
      SELECT 'sampleBand', CASE
        WHEN sample_size IS NULL THEN 'UNKNOWN'
        WHEN sample_size < 30 THEN '<30'
        WHEN sample_size < 100 THEN '30-99'
        WHEN sample_size < 300 THEN '100-299'
        ELSE '>=300' END, hit, payout FROM window_buy
    )
    SELECT dimension, segmentKey, COUNT(*) AS settled, SUM(hit) AS hits, SUM(payout) AS payoutOddsSum
    FROM segments GROUP BY dimension, segmentKey
  `).all(...params) as Array<Record<string, unknown>>;
  const baseline = { settled: count(baselineRaw.settled), payoutOddsSum: finite(baselineRaw.payoutOddsSum) };
  const segments: BuyOutcomeSegment[] = raw.map((row) => ({
    dimension: dimension(row.dimension),
    segmentKey: String(row.segmentKey),
    settled: count(row.settled),
    hits: count(row.hits),
    payoutOddsSum: finite(row.payoutOddsSum),
  }));
  return {
    baseline,
    segments,
    patterns: mineBuyOutcomePatterns(segments, baseline, {
      minSettled: args.minSettled,
      minComparisonSettled: args.minSettled,
      minRoiDelta: args.minRoiDelta,
    }),
  };
}

function windowCte(source: BuyOutcomeSettlementSource, settledEconomic: string): string {
  return `${source.cte},
ordered_buy AS (
  SELECT venue, model_version, ev, current_odds, sample_size,
    CASE WHEN ev IS NULL OR current_odds IS NULL THEN NULL ELSE ev / current_odds END AS decision_effective_hit_rate,
    CASE WHEN selection = outcome_result THEN 1 ELSE 0 END AS hit,
    CASE WHEN selection = outcome_result THEN outcome_payout_yen / 100.0 ELSE 0 END AS payout,
    ROW_NUMBER() OVER (ORDER BY date DESC, venue DESC, race_no DESC, race_id DESC) AS temporal_row
  FROM buy_outcomes
  WHERE ${settledEconomic}
),
window_buy AS (
  SELECT * FROM ordered_buy WHERE temporal_row > ? AND temporal_row <= ?
)`;
}

function emptyWindow(): WindowResult { return { baseline: { settled: 0, payoutOddsSum: 0 }, segments: [], patterns: [] }; }

function assertPaperLiveSettlementConsistency(db: DatabaseSync, source: BuyOutcomeSettlementSource) {
  if (!source.usesOfficialRaceResults) return;
  const row = db.prepare(`
    ${source.cte}
    SELECT COUNT(*) AS mismatches FROM buy_outcomes
    WHERE decision_result IS NOT NULL AND outcome_result IS NOT NULL AND decision_result != outcome_result
  `).get(...source.params) as { mismatches: number | bigint | null };
  if (count(row.mismatches) > 0) throw new Error("paper-live settlement result conflicts with official race_results");
}

function assertDecisionEffectiveProbabilityConsistency(db: DatabaseSync, source: BuyOutcomeSettlementSource, settledEconomic: string) {
  const row = db.prepare(`
    ${source.cte}
    SELECT COUNT(*) AS invalid
    FROM buy_outcomes
    WHERE ${settledEconomic}
      AND ev IS NOT NULL
      AND current_odds IS NOT NULL
      AND (current_odds <= 0 OR ev < 0 OR ev / current_odds < 0 OR ev / current_odds > 1)
  `).get(...source.params) as { invalid: number | bigint | null };
  if (count(row.invalid) > 0) throw new Error("settled BUY decision-effective hit rate outside [0,1]");
}

function parseArgs(argv: string[]): Args {
  const parsed = { runKind: null as string | null, windowSize: 60, minSettled: 30, minRoiDelta: 0.15, outputPublic: null as string | null, retainPrivateDir: null as string | null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]; const value = argv[i + 1];
    if (key === "--run-kind") { parsed.runKind = safeArg(value); i += 1; }
    else if (key === "--window-size") { parsed.windowSize = boundedInt(value, 20, 500); i += 1; }
    else if (key === "--min-settled") { parsed.minSettled = boundedInt(value, 10, 250); i += 1; }
    else if (key === "--min-roi-delta") { parsed.minRoiDelta = boundedNumber(value, 0.05, 2); i += 1; }
    else if (key === "--output-public") { parsed.outputPublic = safeJson(value); i += 1; }
    else if (key === "--retain-private-dir") { parsed.retainPrivateDir = safePrivateDir(value); i += 1; }
    else if (key === "--") { /* npm separator */ }
    else throw new Error(`unknown option: ${key}`);
  }
  if (parsed.runKind !== "paper-live") throw new Error("Owner BUY pattern replication must stay scoped to paper-live");
  if (!parsed.outputPublic) throw new Error("output-public is required");
  if (parsed.windowSize < parsed.minSettled * 2) throw new Error("window-size must support segment and complement minimums");
  return parsed as Args;
}

function dimension(value: unknown): BuyOutcomeSegment["dimension"] {
  const text = String(value);
  if (["venue", "modelVersion", "confidenceBand", "evBand", "oddsBand", "sampleBand"].includes(text)) return text as BuyOutcomeSegment["dimension"];
  throw new Error(`unexpected pattern dimension: ${text}`);
}
function safeArg(value: string | undefined) { if (!value || !/^[A-Za-z0-9_.-]{1,80}$/.test(value)) throw new Error("invalid filter"); return value; }
function safeJson(value: string | undefined) { if (!value || value.startsWith("/") || value.includes("..") || !/^[A-Za-z0-9_./-]+\.json$/.test(value)) throw new Error("output must be a relative json path"); return value; }
function safePrivateDir(value: string | undefined) { if (!value || !/^data\/private\/[A-Za-z0-9_./-]+$/.test(value) || value.includes("..")) throw new Error("private retention must stay under data/private"); return value.replace(/\/$/, ""); }
function boundedInt(value: string | undefined, min: number, max: number) { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) throw new Error("invalid integer option"); return n; }
function boundedNumber(value: string | undefined, min: number, max: number) { const n = Number(value); if (!Number.isFinite(n) || n < min || n > max) throw new Error("invalid numeric option"); return n; }
function count(value: unknown) { const n = Number(value ?? 0); return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0; }
function finite(value: unknown) { const n = Number(value ?? 0); return Number.isFinite(n) && n >= 0 ? n : 0; }
async function atomicWrite(path: string, contents: string) { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.tmp-${process.pid}`; await writeFile(temp, contents, { encoding: "utf8", mode: 0o600 }); await rename(temp, path); }
async function retain(dir: string, record: unknown): Promise<boolean> {
  const semantic = JSON.parse(JSON.stringify(record)) as Record<string, unknown>; delete semantic.generatedAt;
  const digest = createHash("sha256").update(JSON.stringify(semantic)).digest("hex");
  const envelope = { schemaVersion: "buy-pattern-replication-ledger.0.1", semanticDigest: digest, recordedAt: new Date().toISOString(), record };
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `replication-${digest}.json`);
  try { await writeFile(path, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }); return true; }
  catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    const existing = JSON.parse(await readFile(path, "utf8")) as { semanticDigest?: string };
    if (existing.semanticDigest !== digest) throw new Error("private BUY replication ledger conflict");
    return false;
  }
}
function isNodeError(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error && "code" in error; }
