import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildBuyLearningSummary, unavailableBuyLearningSummary, validateBuyLearningSummary, type BuyLearningSummary } from "../src/presentation/buyLearningSummary";
import { buildBuyOutcomeSettlementSource, type BuyOutcomeSettlementSource } from "../src/presentation/buyOutcomeSettlementSource";

const args = parseArgs(process.argv.slice(2));
const dbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
if (!existsSync(dbPath)) throw new Error("BUY learning source DB is unavailable");

const db = new DatabaseSync(dbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON");
db.exec("PRAGMA busy_timeout = 5000");

try {
  const source = buildBuyOutcomeSettlementSource({
    from: args.from,
    to: args.to,
    runKind: args.runKind,
    modelVersion: args.modelVersion,
  });
  assertPaperLiveSettlementConsistency(db, source);
  const settledEconomic = "outcome_result IS NOT NULL AND outcome_payout_yen IS NOT NULL AND outcome_returned = 0";

  const all = db.prepare(`
    ${source.cte}
    SELECT
      COUNT(*) AS totalDecisions,
      COALESCE(SUM(CASE WHEN ${settledEconomic} THEN 1 ELSE 0 END), 0) AS settled,
      COALESCE(SUM(CASE WHEN ${settledEconomic} AND selection = outcome_result THEN 1 ELSE 0 END), 0) AS hits,
      COALESCE(SUM(CASE WHEN ${settledEconomic} AND selection = outcome_result THEN outcome_payout_yen / 100.0 ELSE 0 END), 0) AS payoutOddsSum,
      COALESCE(MAX(CASE WHEN ${settledEconomic} AND selection = outcome_result THEN outcome_payout_yen / 100.0 ELSE 0 END), 0) AS maxPayoutOdds,
      AVG(CASE WHEN ${settledEconomic} THEN estimated_hit_rate ELSE NULL END) AS avgEstimatedHitRate,
      COALESCE(SUM(CASE WHEN ${settledEconomic} AND selection != outcome_result AND sample_size IS NOT NULL AND sample_size < 30 THEN 1 ELSE 0 END), 0) AS smallSampleMisses,
      COALESCE(SUM(CASE WHEN ${settledEconomic} AND selection != outcome_result AND estimated_hit_rate IS NOT NULL AND estimated_hit_rate >= 0.5 THEN 1 ELSE 0 END), 0) AS highConfidenceMisses,
      COALESCE(SUM(CASE WHEN ${settledEconomic} AND selection != outcome_result AND ev IS NOT NULL AND ev >= 1.2 THEN 1 ELSE 0 END), 0) AS highEvMisses
    FROM buy_outcomes
  `).get(...source.params) as AggregateRow;

  const recentParams = [...source.params, args.recent];
  const recent = db.prepare(`
    ${source.cte},
    recent_buy AS (
      SELECT selection, outcome_result, outcome_payout_yen
      FROM buy_outcomes
      WHERE ${settledEconomic}
      ORDER BY date DESC, venue DESC, race_no DESC
      LIMIT ?
    )
    SELECT
      COUNT(*) AS settled,
      COALESCE(SUM(CASE WHEN selection = outcome_result THEN 1 ELSE 0 END), 0) AS hits,
      COALESCE(SUM(CASE WHEN selection = outcome_result THEN outcome_payout_yen / 100.0 ELSE 0 END), 0) AS payoutOddsSum
    FROM recent_buy
  `).get(...recentParams) as RecentRow;

  const generatedAt = new Date().toISOString();
  const settled = number(all.settled);
  let summary = settled === 0
    ? unavailableBuyLearningSummary(generatedAt)
    : buildBuyLearningSummary({
      generatedAt,
      from: args.from,
      to: args.to,
      totalDecisions: number(all.totalDecisions),
      settled,
      hits: number(all.hits),
      payoutOddsSum: finite(all.payoutOddsSum),
      maxPayoutOdds: finite(all.maxPayoutOdds),
      avgEstimatedHitRate: nullableFinite(all.avgEstimatedHitRate),
      recentSettled: number(recent.settled),
      recentHits: number(recent.hits),
      recentPayoutOddsSum: finite(recent.payoutOddsSum),
      smallSampleMisses: number(all.smallSampleMisses),
      highConfidenceMisses: number(all.highConfidenceMisses),
      highEvMisses: number(all.highEvMisses),
    });

  if (args.patternSignals && summary.status === "AVAILABLE") summary = await mergePatternSignals(summary, args.patternSignals);
  const validationErrors = validateBuyLearningSummary(summary);
  if (validationErrors.length) throw new Error(`enriched BUY learning summary invalid: ${validationErrors.join("; ")}`);

  if (args.output) await atomicWrite(args.output, `${JSON.stringify(summary, null, 2)}\n`);
  const retained = args.retainPrivateDir ? await retainPrivateLearning(args.retainPrivateDir, summary) : false;
  console.log(JSON.stringify({
    status: summary.status,
    output: args.output ?? null,
    settled: summary.performance.settled,
    hits: summary.performance.hits,
    misses: summary.performance.misses,
    learningCount: summary.learnings.length,
    researchCandidateCount: summary.researchCandidates.length,
    privateLearningRetained: retained,
    productionChangeAllowed: false,
  }));
} finally {
  db.close();
}

type AggregateRow = Record<"totalDecisions" | "settled" | "hits" | "payoutOddsSum" | "maxPayoutOdds" | "smallSampleMisses" | "highConfidenceMisses" | "highEvMisses", number | bigint | null> & { avgEstimatedHitRate: number | null };
type RecentRow = { settled: number | bigint | null; hits: number | bigint | null; payoutOddsSum: number | null };
type PatternSignal = { id: string; direction: "SUCCESS_EDGE" | "FAILURE_REGIME"; dimension: string; evidenceCount: number; roiDelta: number; confidence: "WATCH" | "STRONG"; productionChangeAllowed: false };

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
  if (number(row.mismatches) > 0) {
    throw new Error("paper-live settlement result conflicts with official race_results");
  }
}

function parseArgs(argv: string[]) {
  const parsed = { from: null as string | null, to: null as string | null, runKind: null as string | null, modelVersion: null as string | null, recent: 30, output: null as string | null, retainPrivateDir: null as string | null, patternSignals: null as string | null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]; const value = argv[i + 1];
    if (key === "--from") { parsed.from = date(value); i += 1; }
    else if (key === "--to") { parsed.to = date(value); i += 1; }
    else if (key === "--run-kind") { parsed.runKind = safeArg(value); i += 1; }
    else if (key === "--model-version") { parsed.modelVersion = safeArg(value); i += 1; }
    else if (key === "--recent") { parsed.recent = boundedInt(value, 10, 200); i += 1; }
    else if (key === "--output") { parsed.output = safeOutput(value); i += 1; }
    else if (key === "--retain-private-dir") { parsed.retainPrivateDir = safePrivateDir(value); i += 1; }
    else if (key === "--pattern-signals") { parsed.patternSignals = safeOutput(value); i += 1; }
    else if (key === "--") { /* npm separator */ }
    else throw new Error(`unknown option: ${key}`);
  }
  return parsed;
}

async function mergePatternSignals(summary: BuyLearningSummary, path: string): Promise<BuyLearningSummary> {
  if (!existsSync(path)) return summary;
  const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  if (value.schemaVersion !== "buy-outcome-pattern-public-v1" || value.productionChangeAllowed !== false || !Array.isArray(value.signals)) throw new Error("invalid pattern public summary");
  const signals = value.signals.slice(0, 6).map(validatePatternSignal);
  const learnings = [...summary.learnings];
  const researchCandidates = [...summary.researchCandidates];
  for (const signal of signals) {
    const success = signal.direction === "SUCCESS_EDGE";
    learnings.push({
      id: signal.id,
      severity: signal.confidence === "STRONG" ? "ACTION" : "WATCH",
      title: success ? "反復する成功edge候補を検出" : "反復する失敗regime候補を検出",
      summary: `${publicDimension(signal.dimension)}軸で全体baselineとの差が継続しています。具体segment値はprivate evidenceに保持し、holdout/forward確認前にはproductionへ反映しません。`,
      evidenceCount: signal.evidenceCount,
    });
    researchCandidates.push({
      id: `RESEARCH_${signal.id}`.slice(0, 80),
      title: success ? `${publicDimension(signal.dimension)}軸の成功edge再現性検証` : `${publicDimension(signal.dimension)}軸の失敗regime原因分解`,
      reason: `pattern minerがbaseline比ROI proxy差 ${signal.roiDelta >= 0 ? "+" : ""}${Math.round(signal.roiDelta * 100)}pt を検出`,
      status: "PROPOSED",
      productionChangeAllowed: false,
    });
  }
  return {
    ...summary,
    learnings: dedupeById(learnings).slice(0, 6),
    researchCandidates: dedupeById(researchCandidates).slice(0, 6),
  };
}

function validatePatternSignal(raw: unknown): PatternSignal {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid pattern signal");
  const signal = raw as Record<string, unknown>;
  const allowed = new Set(["id", "direction", "dimension", "evidenceCount", "roiDelta", "confidence", "productionChangeAllowed"]);
  for (const key of Object.keys(signal)) if (!allowed.has(key)) throw new Error(`unknown pattern signal key: ${key}`);
  if (typeof signal.id !== "string" || !/^[A-Z0-9_.-]{2,80}$/.test(signal.id)) throw new Error("invalid pattern signal id");
  if (!["SUCCESS_EDGE", "FAILURE_REGIME"].includes(String(signal.direction))) throw new Error("invalid pattern direction");
  if (!["venue", "modelVersion", "confidenceBand", "evBand", "oddsBand", "sampleBand"].includes(String(signal.dimension))) throw new Error("invalid pattern dimension");
  if (!Number.isInteger(signal.evidenceCount) || Number(signal.evidenceCount) < 20) throw new Error("invalid pattern evidence count");
  if (typeof signal.roiDelta !== "number" || !Number.isFinite(signal.roiDelta) || Math.abs(signal.roiDelta) > 100) throw new Error("invalid pattern ROI delta");
  if (!["WATCH", "STRONG"].includes(String(signal.confidence))) throw new Error("invalid pattern confidence");
  if (signal.productionChangeAllowed !== false) throw new Error("pattern signal cannot allow production change");
  return signal as unknown as PatternSignal;
}
function publicDimension(value: string) { return ({ venue: "会場", modelVersion: "モデルversion", confidenceBand: "予測confidence帯", evBand: "EV帯", oddsBand: "odds帯", sampleBand: "sample-size帯" } as Record<string, string>)[value] ?? "集計"; }
function dedupeById<T extends { id: string }>(items: T[]): T[] { return [...new Map(items.map((item) => [item.id, item])).values()]; }
function date(value: string | undefined) { if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("date must be YYYY-MM-DD"); return value; }
function safeArg(value: string | undefined) { if (!value || !/^[A-Za-z0-9_.-]{1,80}$/.test(value)) throw new Error("invalid filter"); return value; }
function boundedInt(value: string | undefined, min: number, max: number) { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) throw new Error("invalid integer option"); return n; }
function safeOutput(value: string | undefined) { if (!value || value.startsWith("/") || value.includes("..") || !/^[A-Za-z0-9_./-]+\.json$/.test(value)) throw new Error("output must be a relative json path"); return value; }
function safePrivateDir(value: string | undefined) { if (!value || !/^data\/private\/[A-Za-z0-9_./-]+$/.test(value) || value.includes("..")) throw new Error("private retention must stay under data/private"); return value.replace(/\/$/, ""); }
function number(value: number | bigint | null) { const n = Number(value ?? 0); return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0; }
function finite(value: number | bigint | null) { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0; }
function nullableFinite(value: number | null) { return value == null || !Number.isFinite(Number(value)) ? null : Number(value); }
async function atomicWrite(path: string, contents: string) { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.tmp-${process.pid}`; await writeFile(temp, contents, { encoding: "utf8", mode: 0o600 }); await rename(temp, path); }
async function retainPrivateLearning(dir: string, summary: unknown): Promise<boolean> {
  const value = summary as Record<string, unknown>;
  const semantic = { ...value, generatedAt: undefined };
  const digest = createHash("sha256").update(JSON.stringify(semantic)).digest("hex");
  const record = { schemaVersion: "buy-outcome-learning-ledger.0.1", semanticDigest: digest, recordedAt: new Date().toISOString(), summary };
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `buy-learning-${digest}.json`);
  try {
    await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return true;
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    const existing = JSON.parse(await readFile(path, "utf8")) as { semanticDigest?: string };
    if (existing.semanticDigest !== digest) throw new Error("private BUY learning ledger conflict");
    return false;
  }
}
function isNodeError(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error && "code" in error; }
