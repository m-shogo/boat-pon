import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mineBuyOutcomePatterns, toPublicOutcomePatternSignals, type BuyOutcomeSegment } from "../src/presentation/buyOutcomePatternMiner";
import { buildBuyOutcomeSettlementSource, type BuyOutcomeSettlementSource } from "../src/presentation/buyOutcomeSettlementSource";

const args = parseArgs(process.argv.slice(2));
const dbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
if (!existsSync(dbPath)) throw new Error("BUY pattern source DB is unavailable");

const db = new DatabaseSync(dbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON");
db.exec("PRAGMA busy_timeout = 5000");

try {
  const source = buildBuyOutcomeSettlementSource({ runKind: args.runKind });
  assertPaperLiveSettlementConsistency(db, source);
  const settledEconomic = "outcome_result IS NOT NULL AND outcome_payout_yen IS NOT NULL AND outcome_returned = 0";

  const baseline = db.prepare(`
    ${source.cte}
    SELECT COUNT(*) AS settled,
      COALESCE(SUM(CASE WHEN selection = outcome_result THEN outcome_payout_yen / 100.0 ELSE 0 END), 0) AS payoutOddsSum
    FROM buy_outcomes
    WHERE ${settledEconomic}
  `).get(...source.params) as { settled: number | bigint | null; payoutOddsSum: number | null };

  const raw = db.prepare(`
    ${source.cte},
    settled_buy AS (
      SELECT venue, model_version, estimated_hit_rate, ev, current_odds, sample_size,
        CASE WHEN selection = outcome_result THEN 1 ELSE 0 END AS hit,
        CASE WHEN selection = outcome_result THEN outcome_payout_yen / 100.0 ELSE 0 END AS payout
      FROM buy_outcomes
      WHERE ${settledEconomic}
    ), segments AS (
      SELECT 'venue' AS dimension, COALESCE(NULLIF(venue,''), 'UNKNOWN') AS segmentKey, hit, payout FROM settled_buy
      UNION ALL
      SELECT 'modelVersion', COALESCE(NULLIF(model_version,''), 'UNKNOWN'), hit, payout FROM settled_buy
      UNION ALL
      SELECT 'confidenceBand', CASE
        WHEN estimated_hit_rate IS NULL THEN 'UNKNOWN'
        WHEN estimated_hit_rate < 0.20 THEN '<0.20'
        WHEN estimated_hit_rate < 0.35 THEN '0.20-0.35'
        WHEN estimated_hit_rate < 0.50 THEN '0.35-0.50'
        ELSE '>=0.50' END, hit, payout FROM settled_buy
      UNION ALL
      SELECT 'evBand', CASE
        WHEN ev IS NULL THEN 'UNKNOWN'
        WHEN ev < 1.00 THEN '<1.00'
        WHEN ev < 1.10 THEN '1.00-1.10'
        WHEN ev < 1.20 THEN '1.10-1.20'
        ELSE '>=1.20' END, hit, payout FROM settled_buy
      UNION ALL
      SELECT 'oddsBand', CASE
        WHEN current_odds IS NULL THEN 'UNKNOWN'
        WHEN current_odds < 5 THEN '<5'
        WHEN current_odds < 10 THEN '5-10'
        WHEN current_odds < 20 THEN '10-20'
        WHEN current_odds < 40 THEN '20-40'
        ELSE '>=40' END, hit, payout FROM settled_buy
      UNION ALL
      SELECT 'sampleBand', CASE
        WHEN sample_size IS NULL THEN 'UNKNOWN'
        WHEN sample_size < 30 THEN '<30'
        WHEN sample_size < 100 THEN '30-99'
        WHEN sample_size < 300 THEN '100-299'
        ELSE '>=300' END, hit, payout FROM settled_buy
    )
    SELECT dimension, segmentKey, COUNT(*) AS settled, SUM(hit) AS hits, SUM(payout) AS payoutOddsSum
    FROM segments
    GROUP BY dimension, segmentKey
  `).all(...source.params) as Array<Record<string, unknown>>;

  const segments: BuyOutcomeSegment[] = raw.map((row) => ({
    dimension: dimension(row.dimension),
    segmentKey: String(row.segmentKey),
    settled: count(row.settled),
    hits: count(row.hits),
    payoutOddsSum: finite(row.payoutOddsSum),
  }));
  const patterns = mineBuyOutcomePatterns(segments, {
    settled: count(baseline.settled),
    payoutOddsSum: finite(baseline.payoutOddsSum),
  }, { minSettled: args.minSettled, minRoiDelta: args.minRoiDelta });

  const privateRecord = {
    schemaVersion: "buy-outcome-pattern-mining.0.1",
    generatedAt: new Date().toISOString(),
    policy: {
      minimumSettledPerSegment: args.minSettled,
      minimumAbsoluteRoiDelta: args.minRoiDelta,
      runKind: args.runKind,
      settlementEconomics: source.usesOfficialRaceResults
        ? "official-race-results-payout-yen-per-100"
        : "decision-history-payout-yen-per-100",
      productionChangeAllowed: false,
      note: "Exploratory pattern mining only; multiple-comparison risk requires governed validation before promotion.",
    },
    baseline: { settled: count(baseline.settled), roiProxy: ratio(finite(baseline.payoutOddsSum), count(baseline.settled)) },
    patterns,
  };
  const publicRecord = {
    schemaVersion: "buy-outcome-pattern-public-v1",
    generatedAt: privateRecord.generatedAt,
    status: patterns.length ? "SIGNALS_FOUND" : "NO_SIGNAL",
    analyzedSettled: privateRecord.baseline.settled,
    signals: toPublicOutcomePatternSignals(patterns),
    productionChangeAllowed: false,
  };

  if (args.outputPublic) await atomicWrite(args.outputPublic, `${JSON.stringify(publicRecord, null, 2)}\n`);
  const retained = args.retainPrivateDir ? await retain(args.retainPrivateDir, privateRecord) : false;
  console.log(JSON.stringify({
    status: publicRecord.status,
    analyzedSettled: publicRecord.analyzedSettled,
    privatePatternCount: patterns.length,
    publicSignalCount: publicRecord.signals.length,
    retained,
    productionChangeAllowed: false,
  }));
} finally {
  db.close();
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
  if (count(row.mismatches) > 0) {
    throw new Error("paper-live settlement result conflicts with official race_results");
  }
}

function parseArgs(argv: string[]) {
  const parsed = { minSettled: 30, minRoiDelta: 0.15, runKind: null as string | null, outputPublic: null as string | null, retainPrivateDir: null as string | null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]; const value = argv[i + 1];
    if (key === "--min-settled") { parsed.minSettled = boundedInt(value, 20, 1000); i += 1; }
    else if (key === "--min-roi-delta") { parsed.minRoiDelta = boundedNumber(value, 0.05, 2); i += 1; }
    else if (key === "--run-kind") { parsed.runKind = safeArg(value); i += 1; }
    else if (key === "--output-public") { parsed.outputPublic = safeOutput(value); i += 1; }
    else if (key === "--retain-private-dir") { parsed.retainPrivateDir = safePrivateDir(value); i += 1; }
    else if (key === "--") { /* npm separator */ }
    else throw new Error(`unknown option: ${key}`);
  }
  return parsed;
}

function dimension(value: unknown): BuyOutcomeSegment["dimension"] {
  const text = String(value);
  if (["venue", "modelVersion", "confidenceBand", "evBand", "oddsBand", "sampleBand"].includes(text)) return text as BuyOutcomeSegment["dimension"];
  throw new Error(`unexpected pattern dimension: ${text}`);
}
function boundedInt(value: string | undefined, min: number, max: number) { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) throw new Error("invalid integer option"); return n; }
function boundedNumber(value: string | undefined, min: number, max: number) { const n = Number(value); if (!Number.isFinite(n) || n < min || n > max) throw new Error("invalid numeric option"); return n; }
function safeArg(value: string | undefined) { if (!value || !/^[A-Za-z0-9_.-]{1,80}$/.test(value)) throw new Error("invalid filter"); return value; }
function safeOutput(value: string | undefined) { if (!value || value.startsWith("/") || value.includes("..") || !/^[A-Za-z0-9_./-]+\.json$/.test(value)) throw new Error("output must be a relative json path"); return value; }
function safePrivateDir(value: string | undefined) { if (!value || !/^data\/private\/[A-Za-z0-9_./-]+$/.test(value) || value.includes("..")) throw new Error("private retention must stay under data/private"); return value.replace(/\/$/, ""); }
function count(value: unknown) { const n = Number(value ?? 0); return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0; }
function finite(value: unknown) { const n = Number(value ?? 0); return Number.isFinite(n) && n >= 0 ? n : 0; }
function ratio(numerator: number, denominator: number) { return denominator > 0 ? Math.round((numerator / denominator) * 10000) / 10000 : null; }
async function atomicWrite(path: string, contents: string) { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.tmp-${process.pid}`; await writeFile(temp, contents, { encoding: "utf8", mode: 0o600 }); await rename(temp, path); }
async function retain(dir: string, record: unknown): Promise<boolean> {
  const semantic = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
  delete semantic.generatedAt;
  const digest = createHash("sha256").update(JSON.stringify(semantic)).digest("hex");
  const envelope = { schemaVersion: "buy-outcome-pattern-ledger.0.1", semanticDigest: digest, recordedAt: new Date().toISOString(), record };
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `pattern-${digest}.json`);
  try {
    await writeFile(path, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return true;
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    const existing = JSON.parse(await readFile(path, "utf8")) as { semanticDigest?: string };
    if (existing.semanticDigest !== digest) throw new Error("private BUY pattern ledger conflict");
    return false;
  }
}
function isNodeError(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error && "code" in error; }
